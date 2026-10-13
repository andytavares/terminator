import { useEffect, useState } from 'react'
import { SCRATCH_PROJECT_ID } from '../../shared/types/index'
import { useWorkspaceStore } from '../stores/workspace.store'
import { useSettingsStore } from '../stores/settings.store'
import { useSessionStore } from '../stores/session.store'
import { useTerminalOpenErrorStore } from '../stores/terminal-open-error.store'
import { useTerminalSession } from '../hooks/useTerminalSession'

// Opening terminals from the shell: a new tab where the operator is, a scratch
// terminal, and a branch's first terminal when it has none.

/** A tab waiting for the name the operator is asked for. */
export interface PendingTab {
  projectId: string
  cwd: string
  scrollbackLimit: number
  defaultName: string
}

/** Where a new terminal opens: the active folder, with the active workspace's scrollback. */
function terminalPlace(): { cwd: string; scrollbackLimit: number; promptForName: boolean } {
  const workspaces = useWorkspaceStore.getState()
  const settings = useSettingsStore.getState().resolveSettings(workspaces.activeWorkspaceId)
  return {
    cwd: workspaces.resolveActiveCwd(),
    scrollbackLimit: settings.terminal.scrollbackLimit,
    promptForName: settings.terminal.promptForName,
  }
}

type CreateSession = ReturnType<typeof useTerminalSession>['createSession']

/** Where a new tab goes: scratch while it is showing, else the active branch. */
function newTabProject(): string | null {
  const { scratchActive, activeProjectId } = useWorkspaceStore.getState()
  return scratchActive ? SCRATCH_PROJECT_ID : activeProjectId
}

/** The name prompt for the next tab in a project, numbered after the ones it has had. */
function pendingTabFor(projectId: string, cwd: string, scrollbackLimit: number): PendingTab {
  const next = (useSessionStore.getState().projectViews.get(projectId)?.terminalCounter ?? 0) + 1
  return { projectId, cwd, scrollbackLimit, defaultName: `Terminal ${next}` }
}

/** Opens a human terminal; a failure is left to the session store to report. */
function openPendingTab(createSession: CreateSession, tab: PendingTab, title: string): void {
  const { projectId, cwd, scrollbackLimit } = tab
  void createSession({ projectId, type: 'human', title, cwd, scrollbackLimit }).catch(() => {})
}

/** A scratch terminal, and the scratch view once it is up. */
function openScratch(createSession: CreateSession): void {
  const { cwd, scrollbackLimit } = terminalPlace()
  createSession({
    projectId: SCRATCH_PROJECT_ID,
    type: 'human',
    title: 'Scratch',
    cwd,
    scrollbackLimit,
  })
    .then(() => useWorkspaceStore.getState().setScratchActive(true))
    .catch(() => {})
}

/** The shell's two ways to open a terminal, and the name prompt one of them may raise. */
export function useTerminalLaunch() {
  const { createSession } = useTerminalSession()
  const [pendingTab, setPendingTab] = useState<PendingTab | null>(null)

  /** A tab in scratch while scratch is showing, else in the active branch. */
  function newTab(): void {
    const projectId = newTabProject()
    if (!projectId) return
    const { cwd, scrollbackLimit, promptForName } = terminalPlace()
    const tab = pendingTabFor(projectId, cwd, scrollbackLimit)
    if (promptForName) setPendingTab(tab)
    else openPendingTab(createSession, tab, '')
  }

  /** Opens the tab the name prompt was for, under the name given. */
  function confirmPendingTab(title: string): void {
    if (!pendingTab) return
    setPendingTab(null)
    openPendingTab(createSession, pendingTab, title)
  }

  return {
    newTab,
    newScratch: () => openScratch(createSession),
    pendingTab,
    confirmPendingTab,
    cancelPendingTab: () => setPendingTab(null),
  }
}

/** Opens a terminal whenever the Terminal tab is active and has none. Covers the first selection
 * of a branch, coming back from an extension tab, and the last terminal closing. A failure is
 * kept for the branch to show, and a retry from there runs this again. */
export function useAutoOpenTerminal(activeProjectTabId: string | null): void {
  const { createSession } = useTerminalSession()
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId)
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const openRetry = useTerminalOpenErrorStore((s) =>
    activeProjectId ? (s.retries[activeProjectId] ?? 0) : 0
  )
  useEffect(() => {
    if (!activeProjectId || activeProjectTabId !== null) return
    if (useSessionStore.getState().getSessionsForProject(activeProjectId).length > 0) return
    const { cwd, scrollbackLimit } = terminalPlace()
    const projectId = activeProjectId
    const errors = useTerminalOpenErrorStore.getState()
    createSession({ projectId, type: 'human', title: '', cwd, scrollbackLimit }).then(
      () => errors.clearError(projectId),
      (err: unknown) => errors.setError(projectId, err instanceof Error ? err.message : String(err))
    )
  }, [activeProjectId, openRetry, activeProjectTabId, activeWorkspaceId, createSession])
}
