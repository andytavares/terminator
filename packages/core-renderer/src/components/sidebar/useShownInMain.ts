import { useShallow } from 'zustand/react/shallow'
import { useExtensionRegistry } from '../../extensions/registry'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useSessionStore } from '../../stores/session.store'
import { shownInMain, type ShownInMain } from '../../sidebar/shown-in-main'

/** The branch and terminal the main area draws right now, the only session the sidebar marks. */
export function useShownInMain(): ShownInMain | null {
  const tabs = useExtensionRegistry(
    useShallow((s) => ({
      surfaceTabOpen: Boolean(s.activeGlobalTabId || s.activeWorkspaceTabId),
      projectTabOpen: Boolean(s.activeProjectTabId),
    }))
  )
  const { scratchActive, activeProjectId } = useWorkspaceStore(
    useShallow((s) => ({ scratchActive: s.scratchActive, activeProjectId: s.activeProjectId }))
  )
  // Selects the result, not the map: every row calls this, and the map changes on any terminal.
  return useSessionStore(
    useShallow((s) =>
      shownInMain({
        ...tabs,
        scratchActive,
        activeProjectId,
        activeSessionOf: (projectId) => s.projectViews.get(projectId)?.activeSessionId ?? null,
      })
    )
  )
}
