import { useCallback, useEffect, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { QuickActions } from './QuickActions'
import type { ActionContext, QuickAction, QuickActionGroup } from '../quick-actions/types'
import { buildSurfaceActions, type SurfaceRegistration } from '../quick-actions/surface-actions'
import {
  buildExtensionActions,
  type RegisteredCommand,
  type DeclaredCommand,
  type RendererCommand,
} from '../quick-actions/extension-actions'
import { CORE_GROUPS } from '../quick-actions/groups'
import { promptAgentTab } from '../terminal/agent-tab'
import { buildCustomQuickActions } from '../quick-actions/custom-runtime'
import type { CustomRunEnv } from '../quick-actions/custom-actions'
import type { TerminalSession } from '../../shared/types/index'
import { rankFirstScreen } from '../quick-actions/rank'
import { recordUsage, pruneUsage, togglePin, shouldShowHint } from '../quick-actions/usage'
import {
  useActiveScope,
  useQuickActionTarget,
  type QuickActionTarget,
} from '../quick-actions/use-active-scope'
import { useCoreQuickActions, type ShellCommands } from '../quick-actions/use-core-quick-actions'
import { useSettingsStore } from '../stores/settings.store'
import { useIntegrationsStore } from '../stores/integrations.store'
import { useSessionStore } from '../stores/session.store'
import { useWorkspaceStore } from '../stores/workspace.store'
import { useToastStore } from '../stores/toast.store'
import { useExtensionCommandsStore } from '../stores/extension-commands.store'
import { useExtensionRegistry } from '../extensions/registry'
import { useTerminalSession } from '../hooks/useTerminalSession'
import { agentStateOf } from '../sidebar/agent-state'

export interface QuickActionsHostProps {
  openedAt: number
  searchSignal: number
  surfaces: SurfaceRegistration[]
  activateSurface: (surface: SurfaceRegistration) => void
  shell: ShellCommands
  onClose: () => void
}

/** The extension commands as last read, read again each time the palette opens. */
function useDeclaredCommands(): { registered: RegisteredCommand[]; declared: DeclaredCommand[] } {
  const { registered, declared, refresh } = useExtensionCommandsStore(
    useShallow((s) => ({ registered: s.registered, declared: s.declared, refresh: s.refresh }))
  )
  useEffect(() => {
    refresh().catch((error: unknown) => console.warn('Could not read extension commands', error))
  }, [refresh])
  return { registered, declared }
}

function useSurfaceOwner(): string | null {
  const { activeGlobalTabId, activeWorkspaceTabId, activeProjectTabId } = useExtensionRegistry(
    useShallow((s) => ({
      activeGlobalTabId: s.activeGlobalTabId,
      activeWorkspaceTabId: s.activeWorkspaceTabId,
      activeProjectTabId: s.activeProjectTabId,
    }))
  )
  const owner = [activeGlobalTabId, activeWorkspaceTabId, activeProjectTabId].find(
    (id): id is string => !!id && !id.startsWith('core.')
  )
  return owner ?? null
}

/** Where an extension command would run: the branch, the focused terminal, the repo. */
function useActionContext(target: QuickActionTarget, surfaceOwner: string | null): ActionContext {
  const { repoRoot } = useActiveScope()
  const { projectId, focusedSessionId, focusedSession } = target
  return useMemo(
    () => ({
      projectId,
      sessionId: focusedSessionId,
      repoRoot,
      agentState: focusedSession ? agentStateOf(focusedSession) : null,
      isAgentSession: focusedSession?.type === 'agent',
      surfaceOwner,
    }),
    [projectId, focusedSessionId, repoRoot, focusedSession, surfaceOwner]
  )
}

function useExtensionQuickActions(
  target: QuickActionTarget,
  groups: QuickActionGroup[],
  surfaceOwner: string | null
): QuickAction[] {
  const { registered, declared } = useDeclaredCommands()
  const commands = useExtensionRegistry((s) => s.commands)
  const ctx = useActionContext(target, surfaceOwner)
  return useMemo(
    () =>
      buildExtensionActions(
        { registered, declared, renderer: commands.map(rendererCommand) },
        groups,
        {
          ctx,
          execute: (key, context) => void window.electronAPI.extension.executeCommand(key, context),
        }
      ),
    [registered, declared, groups, ctx, commands]
  )
}

type CommandRegistration = ReturnType<typeof useExtensionRegistry.getState>['commands'][number]

/** A command the renderer registered, as the palette lists it. */
function rendererCommand(c: CommandRegistration): RendererCommand {
  return {
    id: c.id,
    label: c.label,
    description: c.description,
    shortcut: c.shortcut,
    action: c.action,
  }
}

/** What a custom action needs to know about the focused tab. */
function focusedFacts(session: TerminalSession): NonNullable<CustomRunEnv['focused']> {
  return {
    sessionId: session.id,
    isAgent: session.type === 'agent',
    isAgentTab: session.surface === 'agent',
    agentState: agentStateOf(session),
  }
}

/** What a custom action runs against: the focused terminal, and the variables its body can use. */
function useCustomEnv(target: QuickActionTarget): CustomRunEnv {
  const { activeWorkspace, activeProject } = useActiveScope()
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId)
  const issueKey = useIntegrationsStore((s) =>
    activeProjectId ? (s.linkFor(activeProjectId)?.key ?? null) : null
  )
  const { projectId, focusedSessionId, focusedSession } = target
  return useMemo(
    () => ({
      focused: focusedSession ? focusedFacts(focusedSession) : null,
      projectId,
      vars: {
        cwd: useWorkspaceStore.getState().resolveActiveCwd(),
        branch: activeProject?.gitBranch ?? null,
        worktree: activeProject?.worktreePath ?? null,
        repo: activeWorkspace?.folderPath ?? null,
        issue: issueKey,
        selection: focusedSessionId ? selectionOf(focusedSessionId) : null,
      },
    }),
    [focusedSession, projectId, focusedSessionId, activeProject, activeWorkspace, issueKey]
  )
}

/** What is selected in a terminal, or null when nothing is. */
function selectionOf(sessionId: string): string | null {
  return useSessionStore.getState().getTerminalInstance?.(sessionId)?.getSelection() || null
}

function useCustomQuickActions(target: QuickActionTarget): QuickAction[] {
  const env = useCustomEnv(target)
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const globalCustom = useSettingsStore((s) => s.globalSettings?.quickActions?.custom)
  const workspaceCustom = useSettingsStore((s) =>
    activeWorkspaceId
      ? s.workspaceSettings.get(activeWorkspaceId)?.overrides.quickActions?.custom
      : undefined
  )
  const { createSession } = useTerminalSession()
  return useMemo(
    () =>
      buildCustomQuickActions([...(globalCustom ?? []), ...(workspaceCustom ?? [])], env, {
        input: (sessionId, data) => window.electronAPI.terminal.input(sessionId, data),
        prompt: promptAgentTab,
        openTab: (tabProjectId) => openProjectTab(tabProjectId, activeWorkspaceId, createSession),
        notify: (message) => useToastStore.getState().addToast({ type: 'error', message }),
      }),
    [globalCustom, workspaceCustom, env, activeWorkspaceId, createSession]
  )
}

type CreateSession = ReturnType<typeof useTerminalSession>['createSession']

/** A new terminal on the branch, for a custom action that types into one. */
async function openProjectTab(
  projectId: string,
  workspaceId: string | null,
  createSession: CreateSession
): Promise<string> {
  const settings = useSettingsStore.getState().resolveSettings(workspaceId)
  const id = await createSession({
    projectId,
    type: 'human',
    title: '',
    cwd: useWorkspaceStore.getState().resolveActiveCwd(),
    scrollbackLimit: settings.terminal.scrollbackLimit,
  })
  return id as string
}

/** Records the run, offers the shortcut hint, then runs the action and reports a failure. */
function dispatchQuickAction(
  action: QuickAction,
  liveIds: Set<string>,
  addToast: (toast: { type: 'info' | 'error'; message: string }) => void
): void {
  const settings = useSettingsStore.getState().globalSettings?.quickActions ?? {
    pins: [],
    usage: [],
    directUse: [],
    custom: [],
  }
  const usage = pruneUsage(recordUsage(settings.usage, action.id, Date.now()), liveIds)
  const pins = pruneUsage(
    settings.pins.map((id) => ({ id })),
    liveIds
  ).map((p) => p.id)
  const directUse = pruneUsage(settings.directUse, liveIds)
  void useSettingsStore.getState().updateQuickActions({ usage, pins, directUse })
  if (shouldShowHint(action, settings.directUse)) {
    addToast({ type: 'info', message: `Next time: ${action.shortcut}` })
  }
  // `action.run()` can throw synchronously (most core actions are sync) or
  // return a rejected promise (custom/extension actions). Only wrapping the
  // call in an async function catches both.
  void (async () => {
    try {
      await action.run()
    } catch (error: unknown) {
      addToast({ type: 'error', message: error instanceof Error ? error.message : 'Action failed' })
    }
  })()
}

function toggleQuickActionPin(id: string): void {
  const settings = useSettingsStore.getState().globalSettings?.quickActions
  void useSettingsStore.getState().updateQuickActions({ pins: togglePin(settings?.pins ?? [], id) })
}

/** Where the palette says it is acting: the surface on screen, else the focused terminal. */
function contextLabelFor(
  contextGroup: QuickActionGroup | undefined,
  target: QuickActionTarget
): string | undefined {
  if (contextGroup) return `in ${contextGroup.label}`
  return target.focusedSession ? `in terminal · ${target.focusedSession.tabTitle}` : undefined
}

/** The palette and everything it offers, mounted only while it is open: the actions read every
 * session, so building them is work the closed palette should not cost the rest of the app. */
export function QuickActionsHost(props: QuickActionsHostProps): JSX.Element {
  const target = useQuickActionTarget()
  const quickActionGroups = useExtensionRegistry((s) => s.quickActionGroups)
  const groups = useMemo(() => [...CORE_GROUPS, ...quickActionGroups], [quickActionGroups])
  const surfaceOwner = useSurfaceOwner()
  const actions = usePaletteActions({ target, groups, surfaceOwner, props })
  const { pinned, recent, pins } = useFirstScreen(actions, props.openedAt)
  const { onClose } = props
  const handleRun = useCallback(
    (action: QuickAction) => {
      onClose()
      const liveIds = new Set(actions.map((a) => a.id))
      dispatchQuickAction(action, liveIds, useToastStore.getState().addToast)
    },
    [actions, onClose]
  )
  const contextGroup = surfaceOwner ? groups.find((g) => g.owner === surfaceOwner) : undefined

  return (
    <QuickActions
      {...{ groups, actions, pinned, recent, onClose }}
      pins={pins}
      contextGroupId={contextGroup?.id ?? null}
      contextLabel={contextLabelFor(contextGroup, target)}
      searchSignal={props.searchSignal}
      onRun={handleRun}
      onTogglePin={toggleQuickActionPin}
    />
  )
}

/** The pinned and recently used actions the palette opens on, ranked as of `openedAt`. */
function useFirstScreen(actions: QuickAction[], openedAt: number) {
  const settings = useSettingsStore((s) => s.globalSettings?.quickActions)
  const pins = useMemo(() => settings?.pins ?? [], [settings])
  const firstScreen = useMemo(
    () => rankFirstScreen(actions, { pins, usage: settings?.usage ?? [], now: openedAt }),
    [actions, settings, pins, openedAt]
  )
  return { ...firstScreen, pins }
}

interface PaletteInput {
  target: QuickActionTarget
  groups: QuickActionGroup[]
  surfaceOwner: string | null
  props: QuickActionsHostProps
}

/** Core actions, the open surfaces, extension commands and custom actions, in that order. */
function usePaletteActions({ target, groups, surfaceOwner, props }: PaletteInput): QuickAction[] {
  const coreActions = useCoreQuickActions(target, props.shell)
  const extActions = useExtensionQuickActions(target, groups, surfaceOwner)
  const customActions = useCustomQuickActions(target)
  const { surfaces, activateSurface } = props
  const surfaceActions = useMemo(
    () =>
      buildSurfaceActions(surfaces, activateSurface, {
        groups,
        taken: [...coreActions, ...extActions],
      }),
    [surfaces, groups, activateSurface, coreActions, extActions]
  )
  return useMemo(
    () => [...coreActions, ...surfaceActions, ...extActions, ...customActions],
    [coreActions, surfaceActions, extActions, customActions]
  )
}
