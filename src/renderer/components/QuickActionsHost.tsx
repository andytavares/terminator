import { useCallback, useEffect, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { QuickActions } from './QuickActions'
import type { QuickAction, QuickActionGroup } from '../quick-actions/types'
import { buildSurfaceActions, type SurfaceRegistration } from '../quick-actions/surface-actions'
import {
  buildExtensionActions,
  type RegisteredCommand,
  type DeclaredCommand,
} from '../quick-actions/extension-actions'
import { CORE_GROUPS } from '../quick-actions/groups'
import { buildCustomQuickActions } from '../quick-actions/custom-runtime'
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

function useExtensionQuickActions(
  target: QuickActionTarget,
  groups: QuickActionGroup[],
  surfaceOwner: string | null
): QuickAction[] {
  const { registered, declared } = useDeclaredCommands()
  const { repoRoot } = useActiveScope()
  const { commands } = useExtensionRegistry(useShallow((s) => ({ commands: s.commands })))
  const { projectId, focusedSessionId, focusedSession } = target
  const context = useMemo(
    () => ({
      projectId,
      sessionId: focusedSessionId,
      repoRoot,
      agentState: focusedSession?.agentState ?? null,
      isAgentSession: focusedSession?.type === 'agent',
      surfaceOwner,
    }),
    [projectId, focusedSessionId, repoRoot, focusedSession, surfaceOwner]
  )
  return useMemo(
    () =>
      buildExtensionActions(
        registered,
        declared,
        groups,
        context,
        (key, ctx) => void window.electronAPI.extension.executeCommand(key, ctx),
        commands.map((c) => ({
          id: c.id,
          label: c.label,
          description: c.description,
          shortcut: c.shortcut,
          action: c.action,
        }))
      ),
    [registered, declared, groups, context, commands]
  )
}

function useCustomQuickActions(target: QuickActionTarget): QuickAction[] {
  const { activeWorkspace, activeProject } = useActiveScope()
  const { activeWorkspaceId, activeProjectId, resolveActiveCwd } = useWorkspaceStore(
    useShallow((s) => ({
      activeWorkspaceId: s.activeWorkspaceId,
      activeProjectId: s.activeProjectId,
      resolveActiveCwd: s.resolveActiveCwd,
    }))
  )
  const { globalSettings, resolveSettings } = useSettingsStore(
    useShallow((s) => ({
      globalSettings: s.globalSettings,
      resolveSettings: s.resolveSettings,
      workspaceSettings: s.workspaceSettings,
    }))
  )
  const { linkFor } = useIntegrationsStore(
    useShallow((s) => ({ linkFor: s.linkFor, links: s.links }))
  )
  const { getTerminalInstance } = useSessionStore(
    useShallow((s) => ({
      getTerminalInstance: s.getTerminalInstance,
      terminalInstances: s.terminalInstances,
    }))
  )
  const { addToast } = useToastStore(useShallow((s) => ({ addToast: s.addToast })))
  const { createSession } = useTerminalSession()
  const { projectId, focusedSessionId, focusedSession } = target
  const issueKey = activeProjectId ? (linkFor(activeProjectId)?.key ?? null) : null

  return useMemo(() => {
    const env = {
      focused: focusedSession
        ? {
            sessionId: focusedSession.id,
            isAgent: focusedSession.type === 'agent',
            agentState: focusedSession.agentState,
          }
        : null,
      projectId,
      vars: {
        cwd: resolveActiveCwd(),
        branch: activeProject?.gitBranch ?? null,
        worktree: activeProject?.worktreePath ?? null,
        repo: activeWorkspace?.folderPath ?? null,
        issue: issueKey,
        selection: focusedSessionId
          ? getTerminalInstance?.(focusedSessionId)?.getSelection() || null
          : null,
      },
    }
    const global = globalSettings?.quickActions?.custom ?? []
    const workspaceCustom = activeWorkspaceId
      ? (useSettingsStore.getState().workspaceSettings.get(activeWorkspaceId)?.overrides
          .quickActions?.custom ?? [])
      : []
    return buildCustomQuickActions([...global, ...workspaceCustom], env, {
      input: (sessionId, data) => window.electronAPI.terminal.input(sessionId, data),
      openTab: async (tabProjectId) => {
        const settings = resolveSettings(activeWorkspaceId)
        const id = await createSession(
          tabProjectId,
          'human',
          '',
          resolveActiveCwd(),
          settings.terminal.scrollbackLimit
        )
        return id as string
      },
      notify: (message) => addToast({ type: 'error', message }),
    })
  }, [
    focusedSession,
    projectId,
    focusedSessionId,
    activeProject,
    activeWorkspace,
    issueKey,
    globalSettings,
    activeWorkspaceId,
    resolveSettings,
    resolveActiveCwd,
    getTerminalInstance,
    createSession,
    addToast,
  ])
}

/** Records the run, offers the shortcut hint, then runs the action and reports a failure. */
function runQuickAction(
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

/**
 * The palette and everything it offers, mounted only while it is open: the
 * actions read every session, so building them is work the closed palette
 * should not cost the rest of the app.
 */
export function QuickActionsHost(props: QuickActionsHostProps): JSX.Element {
  const target = useQuickActionTarget()
  const { quickActionGroups } = useExtensionRegistry(
    useShallow((s) => ({ quickActionGroups: s.quickActionGroups }))
  )
  const groups = useMemo(() => [...CORE_GROUPS, ...quickActionGroups], [quickActionGroups])
  const surfaceOwner = useSurfaceOwner()
  const coreActions = useCoreQuickActions(target, props.shell)
  const extActions = useExtensionQuickActions(target, groups, surfaceOwner)
  const customActions = useCustomQuickActions(target)
  const { surfaces, activateSurface } = props
  const surfaceActions = useMemo(
    () => buildSurfaceActions(surfaces, groups, activateSurface, [...coreActions, ...extActions]),
    [surfaces, groups, activateSurface, coreActions, extActions]
  )
  const actions = useMemo(
    () => [...coreActions, ...surfaceActions, ...extActions, ...customActions],
    [coreActions, surfaceActions, extActions, customActions]
  )
  const { globalSettings } = useSettingsStore(
    useShallow((s) => ({ globalSettings: s.globalSettings }))
  )
  const settings = globalSettings?.quickActions
  const { pinned, recent } = useMemo(
    () =>
      rankFirstScreen(actions, {
        pins: settings?.pins ?? [],
        usage: settings?.usage ?? [],
        now: props.openedAt,
      }),
    [actions, settings, props.openedAt]
  )
  const { addToast } = useToastStore(useShallow((s) => ({ addToast: s.addToast })))
  const { onClose } = props
  const handleRun = useCallback(
    (action: QuickAction) => {
      onClose()
      runQuickAction(action, new Set(actions.map((a) => a.id)), addToast)
    },
    [actions, onClose, addToast]
  )
  const contextGroup = surfaceOwner ? groups.find((g) => g.owner === surfaceOwner) : undefined

  return (
    <QuickActions
      groups={groups}
      actions={actions}
      pinned={pinned}
      recent={recent}
      pins={settings?.pins ?? []}
      contextGroupId={contextGroup?.id ?? null}
      contextLabel={contextLabelFor(contextGroup, target)}
      searchSignal={props.searchSignal}
      onRun={handleRun}
      onTogglePin={toggleQuickActionPin}
      onClose={onClose}
    />
  )
}
