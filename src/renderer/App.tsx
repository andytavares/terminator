import React, { useEffect, useState } from 'react'
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

installLogInterceptor()

export function App(): JSX.Element {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  const { loadWorkspaces, activeWorkspaceId, activeProjectId } = useWorkspaceStore()
  const { loadSettings } = useSettingsStore()
  const { handleProcessExit } = useSessionStore()

  useKeyboardShortcuts({
    onOpenSettings: () => setSettingsOpen(true),
    onToggleLog: () => setLogOpen((v) => !v),
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
              <TabBar projectId={activeProjectId} />
              <TerminalPane projectId={activeProjectId} />
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

        {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
        {logOpen && <LogWindow onClose={() => setLogOpen(false)} />}
        <ToastContainer />
      </div>
    </ErrorBoundary>
  )
}
