import { useEffect } from 'react'
import type { Project, TerminalSession, Workspace } from '../../../shared/types/index'
import { useExtensionRegistry } from '../../extensions/registry'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useSessionStore } from '../../stores/session.store'
import { useSettingsStore } from '../../stores/settings.store'
import { useToastStore } from '../../stores/toast.store'
import { useTerminalSession } from '../../hooks/useTerminalSession'
import { revealSession } from '../../terminal/navigate-to-session'
import { qualifiedBranchLabel } from '../../sidebar/branch-display'
import type { SidebarData } from './useSidebarRows'

// What the sidebar's rows do: select a branch or a terminal, start or close a
// terminal, and open a folder in the editor.

/** What each failure means, said in the user's terms rather than the code's. */
const EDITOR_ERRORS: Record<string, string> = {
  FOLDER_NOT_FOUND: 'That folder is no longer on disk.',
  NO_EDITOR_FOUND: 'No supported editor found. Install one, or set ui.editor in settings.',
  VALIDATION_ERROR: 'That folder could not be opened.',
}

/** Opening reports back. The first version discarded the result, so a folder that had moved, or
 * a machine with no editor, produced exactly nothing on screen — indistinguishable from the
 * action not being wired up at all. */
export function openFolderInEditor(folderPath: string | undefined): void {
  const say = (message: string): void =>
    useToastStore.getState().addToast({ type: 'error', message })

  if (folderPath === undefined) {
    say('That branch has no folder on disk yet.')
    return
  }
  // `?.then`, not `.then`: optional chaining stops at the call, so when the
  // editor API is absent — the browser remote omits it entirely — `open?.()`
  // yields undefined and a bare `.then` throws.
  void window.electronAPI?.editor
    ?.open?.(folderPath)
    ?.then((result) => {
      if ('error' in result) say(EDITOR_ERRORS[result.error] ?? `Could not open: ${result.error}`)
    })
    ?.catch(() => say('Could not open that folder in your editor.'))
}

type CreateSession = ReturnType<typeof useTerminalSession>['createSession']

/** A new terminal on the branch, in the active folder, with its repo's scrollback. */
function startTerminal(project: Project, createSession: CreateSession): void {
  const settings = useSettingsStore.getState().resolveSettings(project.workspaceId)
  void createSession({
    projectId: project.id,
    type: 'human',
    title: '',
    cwd: useWorkspaceStore.getState().resolveActiveCwd(),
    scrollbackLimit: settings.terminal.scrollbackLimit,
  }).catch(() => {})
}

/** The terminal a branch opens on (FR-047): one waiting on you (why you clicked), else the one you
 * last had open here, else the most recently active. With none, the caller offers to start one. */
function terminalToFocus(sessionList: TerminalSession[], projectId: string): string | undefined {
  const own = sessionList.filter((s) => s.projectId === projectId)
  if (own.length === 0) return undefined
  const waiting = own.find((s) => s.agentState === 'awaiting-input')
  if (waiting) return waiting.id
  const last = useSessionStore.getState().projectViews.get(projectId)?.activeSessionId
  if (last !== undefined && own.some((s) => s.id === last)) return last
  return [...own].sort((a, b) => b.lastActivityAt - a.lastActivityAt)[0].id
}

interface ActionsInput {
  data: SidebarData
  sessionList: TerminalSession[]
  onSelectProject?: () => void
}

/** The row actions, bound to the branches listed and the host's selection callback. */
export function useBranchActions({ data, sessionList, onSelectProject }: ActionsInput) {
  const { projectById } = data
  const { createSession } = useTerminalSession()
  useNewTerminalCommands(data, createSession)

  const selectProjectScope = (project: Project): void => selectProjectRow(project, onSelectProject)

  /** Selecting a session sets activeProjectId as well as the project's active session. Leaving
   * activeProjectId undefined under a non-project grouping would break per-project auto-open
   * and the project tab bar (invariant I4). */
  function selectSession(sessionId: string): void {
    revealSession(sessionId)
    onSelectProject?.()
  }

  return {
    selectSession,
    selectBranch: (projectId: string): void => {
      const focus = terminalToFocus(sessionList, projectId)
      const project = projectById.get(projectId)
      if (project) selectProjectScope(project)
      // Nothing running on it: selecting the branch is enough. App's auto-open
      // effect gives a branch with no terminals its first one, so starting one
      // here as well would open two.
      if (focus !== undefined) selectSession(focus)
    },
    addTerminal: (projectId: string): void => {
      const project = projectById.get(projectId)
      if (!project) return
      // Starting a terminal in a project selects it, the way clicking the tree's
      // project row used to. Without this the session appears in the sidebar
      // while the main area still shows whatever was there before.
      selectProjectScope(project)
      startTerminal(project, createSession)
    },
    closeTerminal,
    folderForBranch: (projectId: string) => folderForBranch(data, projectId),
  }
}

/** Selecting a project is what the tree's project row did on click, and what the per-project
 * auto-open effect keys off: a project with no sessions gets its first terminal from this. */
function selectProjectRow(project: Project, onSelectProject: (() => void) | undefined): void {
  useWorkspaceStore.getState().setActiveWorkspace(project.workspaceId)
  useWorkspaceStore.getState().setActiveProject(project.id)
  onSelectProject?.()
}

/** Leaves the split layout first, then ends the session — as Cmd+W does. */
function closeTerminal(projectId: string, sessionId: string): void {
  useSessionStore.getState().closeSplitLeaf(projectId, sessionId)
  void useSessionStore.getState().closeSession(sessionId)
}

/** The folder a branch's work happens in: its own working copy when it has one, else the repo it
 * was checked out from. Same resolution the terminal and the change statistics use. */
function folderForBranch(
  { projectById, workspaceById }: SidebarData,
  projectId: string
): string | undefined {
  const project = projectById.get(projectId)
  if (project === undefined) return undefined
  return project.worktreePath ?? workspaceById.get(project.workspaceId)?.folderPath
}

export type BranchActions = ReturnType<typeof useBranchActions>

/** FR-027 lists three ways to reach a scope action: the group header, the row scope menu, and
 * the command palette. This is the third. */
function useNewTerminalCommands(
  { allProjects, workspaceById }: SidebarData,
  createSession: CreateSession
): void {
  const registerCommand = useExtensionRegistry((s) => s.registerCommand)
  useEffect(() => {
    const disposers = allProjects.map((project) =>
      registerCommand({
        id: `core.scope.new-terminal.${project.id}`,
        label: `New terminal — ${commandBranchLabel(project, workspaceById)}`,
        category: 'Sessions',
        action: () => startTerminal(project, createSession),
      })
    )
    return () => disposers.forEach((dispose) => dispose())
  }, [allProjects, workspaceById, registerCommand, createSession])
}

/** Qualified by repo: every repo's default branch is called main, so an unqualified label lists
 * the same words once per repo. */
function commandBranchLabel(project: Project, workspaceById: Map<string, Workspace>): string {
  return qualifiedBranchLabel(project, workspaceById.get(project.workspaceId)?.name)
}
