import { useEffect, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useWorkspaceStore } from '../stores/workspace.store'
import { useSettingsStore } from '../stores/settings.store'
import { useSessionStore } from '../stores/session.store'
import { useSessionRecordsStore } from '../stores/session-records.store'
import { useExtensionCommandsStore } from '../stores/extension-commands.store'
import { useHomeFeedStore } from '../stores/home-feed.store'
import { useMetricsStore } from '../stores/metrics.store'
import { useActiveScope } from '../quick-actions/use-active-scope'
import { useBranchSync } from '../hooks/useBranchSync'
import { useAgentAttention } from './agent-attention'

// What the window loads when it opens, and what it keeps in step with the
// stores for as long as it is open.

/** What extensions publish for Home, read now and kept current for the badge and the Desk. */
function useHomeFeed(): void {
  useEffect(() => {
    void useHomeFeedStore.getState().load()
    return useHomeFeedStore.getState().subscribe()
  }, [])
}

/** Workspaces, settings, session records and extension commands, read from main. */
export function useInitialLoad(): void {
  useEffect(() => {
    void useWorkspaceStore.getState().loadWorkspaces()
    void useSettingsStore.getState().loadSettings()
  }, [])

  useAgentAttention()

  useEffect(() => {
    const records = useSessionRecordsStore.getState()
    void records.load()
    return records.subscribe()
  }, [])

  useHomeFeed()

  // Read before the first ⌘P, so the keys typed straight after it find them,
  // and again whenever a backend registers or drops a command.
  useEffect(() => {
    const refreshCommands = (): void => {
      useExtensionCommandsStore
        .getState()
        .refresh()
        .catch((error: unknown) => console.warn('Could not read extension commands', error))
    }
    refreshCommands()
    return window.electronAPI.extension?.onCommandsChanged?.(refreshCommands)
  }, [])

  useEffect(() => {
    return window.electronAPI.terminal.onProcessExit((sessionId, exitCode) => {
      useSessionStore.getState().handleProcessExit(sessionId, exitCode)
    })
  }, [])
}

/** Keeps the window in step with what is selected: main told what is on screen, the workspace's
 * own settings loaded, scratch left once a branch is chosen, and the welcome marked seen once
 * one is. */
export function useSelectionEffects(): void {
  const { activeWorkspaceId, activeProjectId } = useWorkspaceStore(
    useShallow((s) => ({
      activeWorkspaceId: s.activeWorkspaceId,
      activeProjectId: s.activeProjectId,
    }))
  )
  const { repoRoot } = useActiveScope()

  // Tells main what is on screen, for an extension asking workspace.getActive.
  useEffect(() => {
    window.electronAPI.workspace?.setActive?.({
      workspaceId: activeWorkspaceId,
      projectId: activeProjectId,
      repoRoot,
    })
  }, [activeWorkspaceId, activeProjectId, repoRoot])

  useEffect(() => {
    if (activeWorkspaceId) void useSettingsStore.getState().loadSettings(activeWorkspaceId)
  }, [activeWorkspaceId])

  // A branch chosen leaves the scratch view.
  useEffect(() => {
    if (activeProjectId) useWorkspaceStore.getState().setScratchActive(false)
  }, [activeProjectId])

  useWelcomeSeen(activeProjectId)
}

function useWelcomeSeen(activeProjectId: string | null): void {
  const globalSettings = useSettingsStore((s) => s.globalSettings)
  useEffect(() => {
    if (activeProjectId && globalSettings && !globalSettings.ui?.hasSeenWelcome) {
      useSettingsStore.getState().markWelcomeSeen()
    }
  }, [activeProjectId, globalSettings])
}

/** Polls system metrics only while the metrics bar is on. */
export function useGlobalMetrics(showMetricsBar: boolean): void {
  useEffect(() => {
    const metrics = useMetricsStore.getState()
    if (showMetricsBar) metrics.enableGlobalMetrics()
    else metrics.disableGlobalMetrics()
  }, [showMetricsBar])
}

/** A card is named by its branch, so the branch it names has to be the one its tree is on.
 * Worktree cards are fixed at creation and are left out; the rest follow whatever the operator
 * checks out in their own terminal. */
export function useBranchSyncTargets(): void {
  const { workspaces, projectsByWorkspaceId } = useWorkspaceStore(
    useShallow((s) => ({
      workspaces: s.workspaces,
      projectsByWorkspaceId: s.projectsByWorkspaceId,
    }))
  )
  const targets = useMemo(() => {
    const folderById = new Map(workspaces.map((w) => [w.id, w.folderPath]))
    return [...projectsByWorkspaceId.values()]
      .flat()
      .filter((p) => !p.isWorktree)
      .map((p) => ({
        id: p.id,
        cwd: p.worktreePath ?? folderById.get(p.workspaceId) ?? '',
        gitBranch: p.gitBranch,
      }))
      .filter((t) => t.cwd !== '')
  }, [projectsByWorkspaceId, workspaces])
  useBranchSync(targets)
}
