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
import { useNotificationStore } from './stores/notification.store'
import { NotificationPanel } from './components/NotificationPanel'
import { useExtensionRegistry } from './extensions/registry'
import type { CommandRegistration } from './extensions/registry'
import { EmptyState } from './components/EmptyState'
import { OverviewScreen } from './components/overview/OverviewScreen'
import { MetricsBar } from './components/overview/MetricsBar'
import { useMetricsStore } from './stores/metrics.store'

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
  const { system, enableGlobalMetrics, disableGlobalMetrics } = useMetricsStore()
  const { handleProcessExit, getSessionsForProject } = useSessionStore()
  const { addToast } = useToastStore()
  const {
    addNotification,
    unreadCount,
    panelOpen: notificationPanelOpen,
    togglePanel: toggleNotificationPanel,
  } = useNotificationStore()

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
  const activeProjects = activeWorkspaceId
    ? (projectsByWorkspaceId.get(activeWorkspaceId) ?? [])
    : []
  const activeProject = activeProjects.find((p) => p.id === activeProjectId)
  // For worktree projects use their own path; otherwise fall back to the workspace folder
  const repoRoot = activeProject?.worktreePath ?? activeWorkspace?.folderPath ?? null

  const handleOpenSettings = useCallback(() => setSettingsOpen(true), [])
  const handleToggleLog = useCallback(() => setLogOpen((v) => !v), [])
  const handleOpenCommandPalette = useCallback(() => setPaletteOpen(true), [])

  const handleNewTab = useCallback(() => {
    if (!activeProjectId) return
    const settings = resolveSettings(activeWorkspaceId)
    const projects = activeWorkspaceId ? (projectsByWorkspaceId.get(activeWorkspaceId) ?? []) : []
    const activeProject = projects.find((p) => p.id === activeProjectId)
    const cwd = activeProject?.worktreePath ?? activeWorkspace?.folderPath ?? '~'
    void createSession(activeProjectId, 'human', '', cwd, settings.terminal.scrollbackLimit)
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
      {
        id: 'core.toggle-overview',
        label: 'Toggle Overview',
        shortcut: '⌘⇧O',
        category: 'App',
        action: () => {
          const { activeGlobalTabId, setActiveGlobalTab } = useExtensionRegistry.getState()
          setActiveGlobalTab(activeGlobalTabId === 'core.overview' ? null : 'core.overview')
        },
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
    if (globalSettings?.ui?.showMetricsBar) {
      enableGlobalMetrics()
    } else {
      disableGlobalMetrics()
    }
  }, [globalSettings?.ui?.showMetricsBar, enableGlobalMetrics, disableGlobalMetrics])

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

  // Hydrate notification store from main process on mount
  useEffect(() => {
    void window.electronAPI.notifications?.list().then((notifications) => {
      for (const n of notifications) addNotification(n)
    })
  }, [addNotification])

  // Subscribe to push notifications from extensions
  useEffect(() => {
    return window.electronAPI.notifications?.onPush((n) => addNotification(n))
  }, [addNotification])

  // Global handler for extension navigation events — works even when the target tab is unmounted
  useEffect(() => {
    return window.electronAPI.extensionBridge.on('task-vault:navigate-task', (taskId) => {
      useExtensionRegistry.getState().setActiveGlobalTabWithNavigation('task-vault', taskId)
    })
  }, [])

  // Auto-open a terminal whenever the Terminal tab is active and has no sessions.
  // Covers: first project selection, switching back from an extension tab, all sessions closed.
  useEffect(() => {
    if (!activeProjectId || activeProjectTabId !== null) return
    if (getSessionsForProject(activeProjectId).length > 0) return
    const settings = resolveSettings(activeWorkspaceId)
    const projects = activeWorkspaceId ? (projectsByWorkspaceId.get(activeWorkspaceId) ?? []) : []
    const activeProject = projects.find((p) => p.id === activeProjectId)
    const cwd = activeProject?.worktreePath ?? activeWorkspace?.folderPath ?? '~'
    void createSession(activeProjectId, 'human', '', cwd, settings.terminal.scrollbackLimit)
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

  // Close all open panels when switching workspaces
  const prevWorkspaceIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (prevWorkspaceIdRef.current !== null && prevWorkspaceIdRef.current !== activeWorkspaceId) {
      openPanelsRef.current.forEach((panelId) => togglePanel(panelId))
      savedPanelsRef.current = new Set()
    }
    prevWorkspaceIdRef.current = activeWorkspaceId
  }, [activeWorkspaceId, togglePanel])

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

  // Register Overview as a built-in global tab
  useEffect(() => {
    return useExtensionRegistry.getState().registerGlobalTab({
      id: 'core.overview',
      label: 'Overview',
      icon: '⊞',
      component: OverviewScreen,
      permanent: true,
    })
  }, [])

  const showMetricsBar = globalSettings?.ui?.showMetricsBar ?? false

  return (
    <ErrorBoundary>
      <div className="app-layout">
        <div className="app-body">
          <WorkspaceRail
            globalTabs={Array.from(globalTabs.values())}
            activeGlobalTabId={activeGlobalTabId}
            onSelectGlobalTab={(id) => setActiveGlobalTab(id === activeGlobalTabId ? null : id)}
            unreadNotifications={unreadCount}
            notificationPanelOpen={notificationPanelOpen}
            onBellClick={toggleNotificationPanel}
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

          <NotificationPanel />
          {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
          {logOpen && <LogWindow onClose={() => setLogOpen(false)} />}
          {paletteOpen && (
            <CommandPalette commands={paletteCommands} onClose={() => setPaletteOpen(false)} />
          )}
          <ToastContainer />
        </div>
        {showMetricsBar && (
          <div className="app-global-metrics">
            <MetricsBar system={system} />
          </div>
        )}
      </div>
    </ErrorBoundary>
  )
}
