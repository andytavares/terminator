import React, { Suspense } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Hexagon, Option } from 'lucide-react'
import { EmptyState } from '@terminator/extension-ui'
import { SCRATCH_PROJECT_ID } from '../../shared/types/index'
import { useExtensionRegistry } from '../extensions/registry'
import { useWorkspaceStore } from '../stores/workspace.store'
import { useSettingsStore } from '../stores/settings.store'
import { useActiveScope } from '../quick-actions/use-active-scope'
import { TabBar } from '../components/terminal/TabBar'
import { TerminalPane } from '../components/terminal/TerminalPane'

/** What the main area can start, from its tab bar or its empty states. */
export interface MainAreaActions {
  onNewTab: () => void
  onOpenQuickActions: () => void
  onOpenSettings: () => void
  /** Set for one render when a shortcut asks to edit that terminal's note. */
  editNoteSessionId: string | null
}

/** The area beside the sidebar: an app-level tab, a repo's tab, or the terminal (with any
 * extension panels open beside it). */
export function MainArea(actions: MainAreaActions): JSX.Element {
  const { GlobalTab, WorkspaceTab, anySurfaceTab } = useActiveSurfaceTabs()
  const { repoRoot } = useActiveScope()
  return (
    <div className="app-main-area">
      <div className="main-content">
        {GlobalTab ? (
          <Suspense fallback={null}>
            <GlobalTab />
          </Suspense>
        ) : WorkspaceTab ? (
          <WorkspaceTab repoRoot={repoRoot} />
        ) : (
          <ProjectArea {...actions} />
        )}
      </div>
      {/* Extension-contributed sidebar panels — hidden when a global tab is active */}
      {!anySurfaceTab && <SidebarPanels repoRoot={repoRoot} />}
    </div>
  )
}

/** The app-level and repo-level tabs showing, if any, in place of the terminal. */
function useActiveSurfaceTabs() {
  const { globalTabs, workspaceTabs, activeGlobalTabId, activeWorkspaceTabId } =
    useExtensionRegistry(
      useShallow((s) => ({
        globalTabs: s.globalTabs,
        workspaceTabs: s.workspaceTabs,
        activeGlobalTabId: s.activeGlobalTabId,
        activeWorkspaceTabId: s.activeWorkspaceTabId,
      }))
    )
  const globalTab = activeGlobalTabId ? globalTabs.get(activeGlobalTabId) : undefined
  const workspaceTab = activeWorkspaceTabId ? workspaceTabs.get(activeWorkspaceTabId) : undefined
  return {
    GlobalTab: globalTab?.component as React.ComponentType<Record<string, never>> | undefined,
    WorkspaceTab: workspaceTab?.component,
    anySurfaceTab: Boolean(activeGlobalTabId || activeWorkspaceTabId),
  }
}

/** The panels open beside the terminal, each closable from itself. */
function SidebarPanels({ repoRoot }: { repoRoot: string | null }) {
  const { openPanels, sidebarPanels, togglePanel } = useExtensionRegistry(
    useShallow((s) => ({
      openPanels: s.openPanels,
      sidebarPanels: s.sidebarPanels,
      togglePanel: s.togglePanel,
    }))
  )
  const activePanels = Array.from(openPanels).filter((id) => sidebarPanels.has(id))
  if (activePanels.length === 0) return null
  return (
    <div className="app-sidebar-panels">
      {activePanels.map((panelId) => {
        const PanelComponent = sidebarPanels.get(panelId)!.component
        return (
          <PanelComponent key={panelId} repoRoot={repoRoot} onClose={() => togglePanel(panelId)} />
        )
      })}
    </div>
  )
}

/** Scratch, the active branch, or the welcome or "pick something" empty state. */
function ProjectArea(actions: MainAreaActions): JSX.Element {
  const { scratchActive, activeProjectId } = useWorkspaceStore(
    useShallow((s) => ({ scratchActive: s.scratchActive, activeProjectId: s.activeProjectId }))
  )
  // Scratch view takes priority over project view when active
  if (scratchActive) {
    return (
      <>
        <TabBar
          projectId={SCRATCH_PROJECT_ID}
          activeProjectTabId={null}
          projectTabs={[]}
          onSelectProjectTab={() => {}}
          onNewTab={actions.onNewTab}
          onScratchDeactivate={() => useWorkspaceStore.getState().setScratchActive(false)}
        />
        <TerminalPane projectId={SCRATCH_PROJECT_ID} />
      </>
    )
  }
  if (activeProjectId) return <BranchArea projectId={activeProjectId} {...actions} />
  return <NothingOpen {...actions} />
}

/** A branch's tab bar, over its terminal or the extension tab chosen in place of it. */
function BranchArea({ projectId, ...actions }: MainAreaActions & { projectId: string }) {
  const { projectTabs, activeProjectTabId, setActiveProjectTab } = useExtensionRegistry(
    useShallow((s) => ({
      projectTabs: s.projectTabs,
      activeProjectTabId: s.activeProjectTabId,
      setActiveProjectTab: s.setActiveProjectTab,
    }))
  )
  const { repoRoot } = useActiveScope()
  const ProjectTab = activeProjectTabId ? projectTabs.get(activeProjectTabId)?.component : undefined
  return (
    <>
      <TabBar
        projectId={projectId}
        editNoteSessionId={actions.editNoteSessionId}
        activeProjectTabId={activeProjectTabId}
        projectTabs={Array.from(projectTabs.values())}
        onSelectProjectTab={setActiveProjectTab}
        onNewTab={actions.onNewTab}
      />
      {ProjectTab ? <ProjectTab repoRoot={repoRoot} /> : <TerminalPane projectId={projectId} />}
    </>
  )
}

/** The welcome until the operator has opened a branch, then a prompt to pick one. */
function NothingOpen({ onOpenQuickActions, onOpenSettings }: MainAreaActions): JSX.Element {
  const globalSettings = useSettingsStore((s) => s.globalSettings)
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const quickActions = { label: 'Quick actions', shortcut: '⌘P', onSelect: onOpenQuickActions }
  if (globalSettings && !globalSettings.ui?.hasSeenWelcome) {
    return (
      <EmptyState
        icon={Hexagon}
        heading="Welcome to Terminator"
        description="A keyboard-first terminal for developers. Open a project to get started."
        actions={[
          quickActions,
          { label: 'New Tab', shortcut: '⌘T', onSelect: () => {} },
          { label: 'Open Settings', shortcut: '⌘,', onSelect: onOpenSettings },
        ]}
      />
    )
  }
  return (
    <EmptyState
      icon={Option}
      heading={
        activeWorkspaceId ? 'Select or create a project' : 'Select a workspace to get started'
      }
      description="Pick one in the sidebar, or make one from quick actions."
      actions={[quickActions]}
    />
  )
}
