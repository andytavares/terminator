import React, { useEffect, useRef, useState } from 'react'
import { WorkspaceRail } from './components/sidebar/WorkspaceRail'
import { ProjectsPanel } from './components/sidebar/ProjectsPanel'
import { TerminalPane } from './components/terminal/TerminalPane'
import { TabBar } from './components/terminal/TabBar'
import { SettingsPanel } from './components/settings/SettingsPanel'
import { ToastContainer } from './components/ToastContainer'
import { LogWindow } from './components/LogWindow'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useWorkspaceStore } from './stores/workspace.store'
import { useSettingsStore } from './stores/settings.store'
import { useSessionStore } from './stores/session.store'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { installLogInterceptor } from './stores/log.store'
import { useToastStore } from './stores/toast.store'
import { useExtensionRegistry } from './extensions/registry'
import './extensions/loader'

installLogInterceptor()

export function App(): JSX.Element {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  const { loadWorkspaces, activeWorkspaceId, activeProjectId, workspaces } = useWorkspaceStore()
  const { loadSettings } = useSettingsStore()
  const { handleProcessExit } = useSessionStore()
  const { addToast } = useToastStore()
  const { sidebarPanels, projectTabs, openPanels, activeProjectTabId, togglePanel, setActiveProjectTab } =
    useExtensionRegistry()

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId)
  const repoRoot = activeWorkspace?.folderPath ?? null

  useKeyboardShortcuts({
    onOpenSettings: () => setSettingsOpen(true),
    onToggleLog: () => setLogOpen((v) => !v),
    onToggleGitSidebar: () => togglePanel('git-changes'),
  })

  useEffect(() => {
    loadWorkspaces()
    loadSettings()
  }, [])

  useEffect(() => {
    if (activeWorkspaceId) loadSettings(activeWorkspaceId)
  }, [activeWorkspaceId])

  useEffect(() => {
    const unsub = window.electronAPI.terminal.onProcessExit((sessionId, exitCode) => {
      handleProcessExit(sessionId, exitCode)
    })
    return unsub
  }, [])

  useEffect(() => {
    const handler = (): void => setSettingsOpen(true)
    window.addEventListener('open-settings', handler)
    return () => window.removeEventListener('open-settings', handler)
  }, [])

  useEffect(() => {
    if (!window.electronAPI.extensionEvents) return
    return window.electronAPI.extensionEvents.onToast(({ type, message }) => {
      addToast({ type: type as 'info' | 'success' | 'warning' | 'error', message })
    })
  }, [addToast])

  useEffect(() => {
    if (!window.electronAPI.extensionEvents?.onTogglePanel) return
    return window.electronAPI.extensionEvents.onTogglePanel((panelId) => {
      togglePanel(panelId)
    })
  }, [togglePanel])

  useEffect(() => {
    if (!window.electronAPI.extensionEvents?.onSelectProjectTab) return
    return window.electronAPI.extensionEvents.onSelectProjectTab((tabId) => {
      setActiveProjectTab(tabId)
    })
  }, [setActiveProjectTab])

  // Keep a ref so the effect always sees the latest openPanels without re-running on every change
  const openPanelsRef = useRef(openPanels)
  openPanelsRef.current = openPanels

  // Snapshot of panels that were open before switching to an extension tab
  const savedPanelsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (activeProjectTabId !== null) {
      // Switching into an extension tab — save open panels then close them
      savedPanelsRef.current = new Set(openPanelsRef.current)
      openPanelsRef.current.forEach((panelId) => togglePanel(panelId))
    } else if (savedPanelsRef.current.size > 0) {
      // Returning to Terminal — reopen whatever was open before
      savedPanelsRef.current.forEach((panelId) => {
        if (!openPanelsRef.current.has(panelId)) togglePanel(panelId)
      })
      savedPanelsRef.current = new Set()
    }
  }, [activeProjectTabId])

  return (
    <ErrorBoundary>
      <div className="app-layout">
        <WorkspaceRail />

        {activeWorkspaceId && (
          <ProjectsPanel workspaceId={activeWorkspaceId} />
        )}

        <div className="main-content">
          {activeProjectId ? (
            <>
              <TabBar
                projectId={activeProjectId}
                activeProjectTabId={activeProjectTabId}
                projectTabs={Array.from(projectTabs.values())}
                onSelectProjectTab={setActiveProjectTab}
              />
              {activeProjectTabId && projectTabs.has(activeProjectTabId) ? (
                (() => {
                  const tab = projectTabs.get(activeProjectTabId)!
                  const TabComponent = tab.component
                  return <TabComponent repoRoot={repoRoot} />
                })()
              ) : (
                <TerminalPane projectId={activeProjectId} />
              )}
            </>
          ) : (
            <div className="empty-state">
              <span className="empty-state__icon">⌥</span>
              <span>
                {activeWorkspaceId
                  ? 'Select or create a project'
                  : 'Select a workspace to get started'}
              </span>
            </div>
          )}
        </div>

        {/* Extension-contributed sidebar panels */}
        {Array.from(openPanels).map((panelId) => {
          const panel = sidebarPanels.get(panelId)
          if (!panel) return null
          const PanelComponent = panel.component
          return (
            <PanelComponent
              key={panelId}
              repoRoot={repoRoot}
              onClose={() => togglePanel(panelId)}
            />
          )
        })}

        {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
        {logOpen && <LogWindow onClose={() => setLogOpen(false)} />}
        <ToastContainer />
      </div>
    </ErrorBoundary>
  )
}
