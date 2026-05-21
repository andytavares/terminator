import React, { useCallback, useEffect, useRef, useState } from 'react'
import { WorkspaceRail } from './components/sidebar/WorkspaceRail'
import { ProjectsPanel } from './components/sidebar/ProjectsPanel'
import { TerminalPane } from './components/terminal/TerminalPane'
import { TabBar } from './components/terminal/TabBar'
import { SettingsPanel } from './components/settings/SettingsPanel'
import { ToastContainer } from './components/ToastContainer'
import { LogWindow } from './components/LogWindow'
import { ErrorBoundary } from './components/ErrorBoundary'
import { CommandPalette } from './components/CommandPalette'
import { useWorkspaceStore } from './stores/workspace.store'
import { useSettingsStore } from './stores/settings.store'
import { useSessionStore } from './stores/session.store'
import { useTerminalSession } from './hooks/useTerminalSession'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { installLogInterceptor } from './stores/log.store'
import { useToastStore } from './stores/toast.store'
import { useExtensionRegistry } from './extensions/registry'
import type { CommandRegistration } from './extensions/registry'
import { EmptyState } from './components/EmptyState'

installLogInterceptor()

export function App(): JSX.Element {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  const [sidebarVisible, setSidebarVisible] = useState(true)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const {
    loadWorkspaces,
    activeWorkspaceId,
    activeProjectId,
    workspaces,
    setActiveWorkspace,
    projectsByWorkspaceId,
  } = useWorkspaceStore()
  const { loadSettings, globalSettings, markWelcomeSeen, resolveSettings } = useSettingsStore()
  const { handleProcessExit, getSessionsForProject } = useSessionStore()
  const { addToast } = useToastStore()
  const { createSession } = useTerminalSession()
  const {
    sidebarPanels,
    projectTabs,
    globalTabs,
    activeGlobalTabId,
    openPanels,
    activeProjectTabId,
    togglePanel,
    setActiveProjectTab,
    setActiveGlobalTab,
    commands: extensionCommands,
  } = useExtensionRegistry()

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId)
  const repoRoot = activeWorkspace?.folderPath ?? null

  const handleOpenSettings = useCallback(() => setSettingsOpen(true), [])
  const handleToggleLog = useCallback(() => setLogOpen((v) => !v), [])
  const handleOpenCommandPalette = useCallback(() => setPaletteOpen(true), [])

  const handleNewTab = useCallback(() => {
    if (!activeProjectId) return
    const settings = resolveSettings(activeWorkspaceId)
    const projects = activeWorkspaceId ? (projectsByWorkspaceId.get(activeWorkspaceId) ?? []) : []
    const activeProject = projects.find((p) => p.id === activeProjectId)
    const cwd = activeProject?.worktreePath ?? activeWorkspace?.folderPath ?? '~'
    void createSession(activeProjectId, 'human', 'Terminal', cwd, settings.terminal.scrollbackLimit)
  }, [
    activeProjectId,
    activeWorkspaceId,
    activeWorkspace,
    projectsByWorkspaceId,
    resolveSettings,
    createSession,
  ])
  useKeyboardShortcuts({
    onOpenSettings: handleOpenSettings,
    onToggleLog: handleToggleLog,
    onOpenCommandPalette: handleOpenCommandPalette,
  })

  const builtinCommands = useCallback((): CommandRegistration[] => {
    const cmds: CommandRegistration[] = [
      {
        id: 'core.open-settings',
        label: 'Open Settings',
        shortcut: '⌘,',
        category: 'App',
        action: () => setSettingsOpen(true),
      },
      {
        id: 'core.toggle-sidebar',
        label: 'Toggle Sidebar',
        category: 'App',
        action: () => setSidebarVisible((v) => !v),
      },
      {
        id: 'core.toggle-log',
        label: 'Toggle Log Window',
        shortcut: '⌘⇧L',
        category: 'App',
        action: () => setLogOpen((v) => !v),
      },
    ]

    if (activeProjectId) {
      cmds.push({
        id: 'core.new-tab',
        label: 'New Terminal Tab',
        shortcut: '⌘T',
        category: 'Terminal',
        action: handleNewTab,
      })
    }

    workspaces.forEach((ws, i) => {
      cmds.push({
        id: `core.switch-workspace-${ws.id}`,
        label: `Switch to Workspace: ${ws.name}`,
        shortcut: i < 9 ? `⌘${i + 1}` : undefined,
        category: 'Workspaces',
        action: () => setActiveWorkspace(ws.id),
      })
    })

    return cmds
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId, workspaces, handleNewTab, setActiveWorkspace])

  const paletteCommands = [...builtinCommands(), ...extensionCommands]

  useEffect(() => {
    loadWorkspaces()
    loadSettings()
  }, [loadWorkspaces, loadSettings])

  useEffect(() => {
    if (activeWorkspaceId) loadSettings(activeWorkspaceId)
  }, [activeWorkspaceId, loadSettings])

  useEffect(() => {
    if (activeProjectId && globalSettings && !globalSettings.ui?.hasSeenWelcome) {
      markWelcomeSeen()
    }
  }, [activeProjectId, globalSettings, markWelcomeSeen])

  useEffect(() => {
    const unsub = window.electronAPI.terminal.onProcessExit((sessionId, exitCode) => {
      handleProcessExit(sessionId, exitCode)
    })
    return unsub
  }, [handleProcessExit])

  // Auto-open a terminal whenever the Terminal tab is active and has no sessions.
  // Covers: first project selection, switching back from an extension tab, all sessions closed.
  useEffect(() => {
    if (!activeProjectId || activeProjectTabId !== null) return
    if (getSessionsForProject(activeProjectId).length > 0) return
    const settings = resolveSettings(activeWorkspaceId)
    const projects = activeWorkspaceId ? (projectsByWorkspaceId.get(activeWorkspaceId) ?? []) : []
    const activeProject = projects.find((p) => p.id === activeProjectId)
    const cwd = activeProject?.worktreePath ?? activeWorkspace?.folderPath ?? '~'
    void createSession(activeProjectId, 'human', 'Terminal', cwd, settings.terminal.scrollbackLimit)
  }, [
    activeProjectId,
    activeProjectTabId,
    activeWorkspaceId,
    activeWorkspace,
    projectsByWorkspaceId,
    resolveSettings,
    createSession,
    getSessionsForProject,
  ])

  useEffect(() => {
    const handler = (): void => setSettingsOpen(true)
    window.addEventListener('open-settings', handler)
    return () => window.removeEventListener('open-settings', handler)
  }, [])

  useEffect(() => {
    if (!window.electronAPI.extensionEvents?.onMenuOpenSettings) return
    return window.electronAPI.extensionEvents.onMenuOpenSettings(() => setSettingsOpen(true))
  }, [])

  useEffect(() => {
    if (!window.electronAPI.extensionEvents?.onMenuToggleSidebar) return
    return window.electronAPI.extensionEvents.onMenuToggleSidebar(() =>
      setSidebarVisible((v) => !v)
    )
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
  }, [activeProjectTabId, togglePanel])

  return (
    <ErrorBoundary>
      <div className="app-layout">
        <WorkspaceRail
          globalTabs={Array.from(globalTabs.values())}
          activeGlobalTabId={activeGlobalTabId}
          onSelectGlobalTab={(id) => setActiveGlobalTab(id === activeGlobalTabId ? null : id)}
        />

        {activeGlobalTabId && globalTabs.has(activeGlobalTabId) ? (
          (() => {
            const tab = globalTabs.get(activeGlobalTabId)!
            const TabComponent = tab.component as React.ComponentType<Record<string, never>>
            return (
              <div className="main-content">
                <TabComponent />
              </div>
            )
          })()
        ) : (
          <>
            {activeWorkspaceId && sidebarVisible && (
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
                    onNewTab={handleNewTab}
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
              ) : globalSettings && !globalSettings.ui?.hasSeenWelcome ? (
                <EmptyState
                  icon="⬡"
                  title="Welcome to Terminator"
                  subtitle="A keyboard-first terminal for developers. Open a project to get started."
                  actions={[
                    { label: 'New Tab', shortcut: '⌘T', onClick: () => {} },
                    {
                      label: 'Open Settings',
                      shortcut: '⌘,',
                      onClick: () => setSettingsOpen(true),
                    },
                  ]}
                />
              ) : (
                <EmptyState
                  icon="⌥"
                  title={
                    activeWorkspaceId
                      ? 'Select or create a project'
                      : 'Select a workspace to get started'
                  }
                />
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
          </>
        )}

        {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
        {logOpen && <LogWindow onClose={() => setLogOpen(false)} />}
        {paletteOpen && (
          <CommandPalette commands={paletteCommands} onClose={() => setPaletteOpen(false)} />
        )}
        <ToastContainer />
      </div>
    </ErrorBoundary>
  )
}
