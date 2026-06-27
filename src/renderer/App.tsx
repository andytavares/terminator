import React, { useCallback, useEffect, useRef, useState, createElement } from 'react'
import { LayoutGrid } from 'lucide-react'
import { UnifiedSidebar } from './components/sidebar/UnifiedSidebar'
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
import { installLogInterceptor, useLogStore } from './stores/log.store'
import { useToastStore } from './stores/toast.store'
import { useNotificationStore } from './stores/notification.store'
import { NotificationPanel } from './components/NotificationPanel'
import { useExtensionRegistry } from './extensions/registry'
import type { CommandRegistration } from './extensions/registry'
import { EmptyState } from './components/EmptyState'
import { OverviewScreen } from './components/overview/OverviewScreen'
import { MetricsBar } from './components/overview/MetricsBar'
import { useMetricsStore } from './stores/metrics.store'
import { AboutDialog } from './components/AboutDialog'
import { SCRATCH_PROJECT_ID } from '../shared/types/index'

installLogInterceptor()

export function App(): JSX.Element {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
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
    resolveActiveCwd,
    scratchActive,
    setScratchActive,
  } = useWorkspaceStore()
  const { loadSettings, globalSettings, markWelcomeSeen, resolveSettings } = useSettingsStore()
  const { system, enableGlobalMetrics, disableGlobalMetrics } = useMetricsStore()
  const {
    handleProcessExit,
    getSessionsForProject,
    closeSession,
    activeSessionIdByProject,
    getScratchSessions,
  } = useSessionStore()
  const activeScratchSessionId = activeSessionIdByProject.get(SCRATCH_PROJECT_ID) ?? null
  const { addToast } = useToastStore()
  const {
    addNotification,
    unreadCount,
    panelOpen: notificationPanelOpen,
    togglePanel: toggleNotificationPanel,
  } = useNotificationStore()

  const { createSession, splitSession } = useTerminalSession()
  const {
    sidebarPanels,
    projectTabs,
    globalTabs,
    workspaceTabs,
    activeGlobalTabId,
    activeWorkspaceTabId,
    openPanels,
    activeProjectTabId,
    togglePanel,
    setActiveProjectTab,
    setActiveGlobalTab,
    setActiveWorkspaceTab,
    commands: extensionCommands,
    overlays,
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
  const handleToggleOverview = useCallback(() => {
    setActiveGlobalTab(activeGlobalTabId === 'core.overview' ? null : 'core.overview')
  }, [activeGlobalTabId, setActiveGlobalTab])

  const handleNewTab = useCallback(() => {
    if (scratchActive) {
      const settings = resolveSettings(activeWorkspaceId)
      void createSession(
        SCRATCH_PROJECT_ID,
        'human',
        '',
        resolveActiveCwd(),
        settings.terminal.scrollbackLimit
      )
      return
    }
    if (!activeProjectId) return
    const settings = resolveSettings(activeWorkspaceId)
    const cwd = resolveActiveCwd()
    void createSession(activeProjectId, 'human', '', cwd, settings.terminal.scrollbackLimit)
  }, [
    scratchActive,
    activeProjectId,
    activeWorkspaceId,
    resolveSettings,
    resolveActiveCwd,
    createSession,
  ])

  const handleNewScratch = useCallback(() => {
    const settings = resolveSettings(activeWorkspaceId)
    const cwd = resolveActiveCwd()
    createSession(SCRATCH_PROJECT_ID, 'human', 'Scratch', cwd, settings.terminal.scrollbackLimit)
      .then(() => {
        setScratchActive(true)
      })
      .catch(() => {})
  }, [activeWorkspaceId, resolveSettings, resolveActiveCwd, createSession])

  useKeyboardShortcuts({
    onOpenSettings: handleOpenSettings,
    onToggleLog: handleToggleLog,
    onOpenCommandPalette: handleOpenCommandPalette,
    onToggleOverview: handleToggleOverview,
    onNewScratch: handleNewScratch,
    scratchProjectId: scratchActive ? SCRATCH_PROJECT_ID : null,
  })

  function builtinCommands(): CommandRegistration[] {
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
        shortcut: '⌘⇧I',
        category: 'App',
        action: () => {
          setActiveGlobalTab(activeGlobalTabId === 'core.overview' ? null : 'core.overview')
        },
      },
    ]

    cmds.push({
      id: 'core.new-scratch',
      label: 'New Scratch Terminal',
      shortcut: '⌘⇧T',
      category: 'Terminal',
      action: handleNewScratch,
    })

    if (activeProjectId || scratchActive) {
      cmds.push({
        id: 'core.new-tab',
        label: 'New Terminal Tab',
        shortcut: '⌘T',
        category: 'Terminal',
        action: handleNewTab,
      })
    }

    if (activeProjectId) {
      const settings = resolveSettings(activeWorkspaceId)
      const cwd = resolveActiveCwd()
      cmds.push({
        id: 'core.split-vertical',
        label: 'Split Pane Vertically',
        shortcut: '⌘D',
        category: 'Terminal',
        action: () => {
          void splitSession(activeProjectId, 'vertical', cwd, settings.terminal.scrollbackLimit)
        },
      })
      cmds.push({
        id: 'core.split-horizontal',
        label: 'Split Pane Horizontally',
        shortcut: '⌘⇧D',
        category: 'Terminal',
        action: () => {
          void splitSession(activeProjectId, 'horizontal', cwd, settings.terminal.scrollbackLimit)
        },
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
  }

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
      for (const n of notifications) {
        if (n.targets?.includes('center')) addNotification(n)
      }
    })
  }, [addNotification])

  // Subscribe to push notifications from extensions
  useEffect(() => {
    return window.electronAPI.notifications?.onPush((n) => {
      if (n.targets.includes('center')) addNotification(n)
      if (n.targets.includes('toast')) {
        addToast({ type: n.type, message: n.message ? `${n.title}: ${n.message}` : n.title })
      }
    })
  }, [addNotification, addToast])

  // Deactivate scratch view when a real project is selected
  useEffect(() => {
    if (activeProjectId) setScratchActive(false)
  }, [activeProjectId])

  // Auto-open a terminal whenever the Terminal tab is active and has no sessions.
  // Covers: first project selection, switching back from an extension tab, all sessions closed.
  useEffect(() => {
    if (!activeProjectId || activeProjectTabId !== null) return
    if (getSessionsForProject(activeProjectId).length > 0) return
    const settings = resolveSettings(activeWorkspaceId)
    const cwd = resolveActiveCwd()
    void createSession(activeProjectId, 'human', '', cwd, settings.terminal.scrollbackLimit)
  }, [
    activeProjectId,
    activeProjectTabId,
    activeWorkspaceId,
    resolveActiveCwd,
    resolveSettings,
    createSession,
    getSessionsForProject,
  ])

  useEffect(() => {
    if (!window.electronAPI.extensionEvents?.onMenuOpenSettings) return
    return window.electronAPI.extensionEvents.onMenuOpenSettings(() => setSettingsOpen(true))
  }, [])

  useEffect(() => {
    if (!window.electronAPI.extensionEvents?.onMenuOpenAbout) return
    return window.electronAPI.extensionEvents.onMenuOpenAbout(() => setAboutOpen(true))
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

  // Restore persisted open panels on mount (after extensions have registered their panels)
  const panelsRestored = useRef(false)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('openPanels')
      if (saved) {
        const ids: string[] = JSON.parse(saved)
        ids.forEach((id) => {
          if (!useExtensionRegistry.getState().openPanels.has(id)) togglePanel(id)
        })
      }
    } catch {
      // ignore malformed data
    }
    panelsRestored.current = true
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Persist open panels whenever they change (skip localStorage until restore has run),
  // but always notify the main process of current panel states.
  useEffect(() => {
    if (panelsRestored.current) {
      localStorage.setItem('openPanels', JSON.stringify(Array.from(openPanels)))
    }
    for (const panelId of useExtensionRegistry.getState().sidebarPanels.keys()) {
      window.electronAPI.extensionEvents?.notifyPanelState?.(panelId, openPanels.has(panelId))
    }
  }, [openPanels])

  useEffect(() => {
    if (!window.electronAPI.extensionEvents?.onSelectProjectTab) return
    return window.electronAPI.extensionEvents.onSelectProjectTab((tabId) => {
      setActiveProjectTab(tabId)
    })
  }, [setActiveProjectTab])

  useEffect(() => {
    if (!window.electronAPI.extensionEvents?.onMenuCloseTab) return
    return window.electronAPI.extensionEvents.onMenuCloseTab(() => {
      const effectiveProjectId = scratchActive ? SCRATCH_PROJECT_ID : activeProjectId
      const sessionId = activeSessionIdByProject.get(effectiveProjectId ?? '')
      if (effectiveProjectId && sessionId) {
        void closeSession(sessionId)
      }
    })
  }, [scratchActive, activeProjectId, activeSessionIdByProject, closeSession])

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

  // Register Overview as a built-in global tab
  useEffect(() => {
    return useExtensionRegistry.getState().registerGlobalTab({
      id: 'core.overview',
      label: 'Overview',
      icon: createElement(LayoutGrid),
      component: OverviewScreen,
      permanent: true,
    })
  }, [])

  useEffect(() => {
    return window.electronAPI.extensionBridge.on('extension:activate-global-tab', (tabId) => {
      if (typeof tabId === 'string') setActiveGlobalTab(tabId)
    })
  }, [setActiveGlobalTab])

  useEffect(() => {
    return window.electronAPI.extensionBridge.on('terminal:navigate-to-session', (data) => {
      const { sessionId, projectId } = data as { sessionId: string; projectId: string }
      setActiveGlobalTab(null)
      const { projectsByWorkspaceId } = useWorkspaceStore.getState()
      for (const [wsId, projects] of projectsByWorkspaceId) {
        if (projects.some((p) => p.id === projectId)) {
          useWorkspaceStore.getState().setActiveWorkspace(wsId)
          break
        }
      }
      useWorkspaceStore.getState().setActiveProject(projectId)
      useSessionStore.getState().setActiveSessionForProject(projectId, sessionId)
    })
  }, [setActiveGlobalTab])

  useEffect(() => {
    const unsubLog = window.electronAPI.extensionBridge.on('log:push', (data) => {
      const { level, message } = data as { level: 'info' | 'warn' | 'error'; message: string }
      useLogStore.getState().addEntry(level, message)
    })
    const unsubDisconnected = window.electronAPI.extensionBridge.on(
      'remote:tunnel-disconnected',
      () => {
        addToast({
          type: 'error',
          message: 'ngrok tunnel disconnected. Click Reconnect in Settings to restore it.',
        })
      }
    )
    return () => {
      unsubLog()
      unsubDisconnected()
    }
  }, [addToast])

  const showMetricsBar = globalSettings?.ui?.showMetricsBar ?? false
  const scratchSessions = getScratchSessions()
  // Scratch view takes priority over project view when active
  const displayProjectId = scratchActive ? SCRATCH_PROJECT_ID : activeProjectId

  return (
    <ErrorBoundary>
      <div className="app-layout">
        <div className="app-body">
          <UnifiedSidebar
            globalTabs={Array.from(globalTabs.values()).sort((a, b) => {
              const weight = (t: typeof a) =>
                t.sortOrder !== undefined ? t.sortOrder : t.id.startsWith('core.') ? 0 : 1
              return weight(a) - weight(b)
            })}
            activeGlobalTabId={activeGlobalTabId}
            onSelectGlobalTab={(id) => setActiveGlobalTab(id === activeGlobalTabId ? null : id)}
            activeWorkspaceTabId={activeWorkspaceTabId}
            onSelectWorkspaceTab={(workspaceId, tabId) => {
              const isAlreadyActive =
                tabId === activeWorkspaceTabId && workspaceId === activeWorkspaceId
              setActiveWorkspace(workspaceId)
              setActiveWorkspaceTab(isAlreadyActive ? null : tabId)
            }}
            onSelectProject={() => {
              if (activeGlobalTabId) setActiveGlobalTab(null)
              if (activeWorkspaceTabId) setActiveWorkspaceTab(null)
              if (activeProjectTabId) setActiveProjectTab(null)
            }}
            unreadNotifications={unreadCount}
            notificationPanelOpen={notificationPanelOpen}
            onBellClick={toggleNotificationPanel}
            onNewScratch={handleNewScratch}
            scratchActive={scratchActive}
            hasScratchSessions={scratchSessions.length > 0}
            activeScratchSessionId={scratchActive ? activeScratchSessionId : null}
            onSelectScratchSession={(sessionId) => {
              setScratchActive(true)
              if (activeWorkspaceTabId) setActiveWorkspaceTab(null)
              useSessionStore.getState().setActiveSessionForProject(SCRATCH_PROJECT_ID, sessionId)
            }}
            visible={sidebarVisible}
          />

          <div className="app-main-area">
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
            ) : activeWorkspaceTabId && workspaceTabs.has(activeWorkspaceTabId) ? (
              (() => {
                const tab = workspaceTabs.get(activeWorkspaceTabId)!
                const TabComponent = tab.component
                return (
                  <div className="main-content">
                    <TabComponent repoRoot={repoRoot} />
                  </div>
                )
              })()
            ) : (
              <div className="main-content">
                {scratchActive ? (
                  <>
                    <TabBar
                      projectId={SCRATCH_PROJECT_ID}
                      activeProjectTabId={null}
                      projectTabs={[]}
                      onSelectProjectTab={() => {}}
                      onNewTab={handleNewTab}
                      onScratchDeactivate={() => setScratchActive(false)}
                    />
                    <TerminalPane projectId={SCRATCH_PROJECT_ID} />
                  </>
                ) : displayProjectId ? (
                  <>
                    <TabBar
                      projectId={displayProjectId}
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
                      <TerminalPane projectId={displayProjectId} />
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
            )}

            {/* Extension-contributed sidebar panels — hidden when a global tab is active */}
            {!activeGlobalTabId &&
              !activeWorkspaceTabId &&
              (() => {
                const activePanels = Array.from(openPanels).filter((id) => sidebarPanels.has(id))
                if (activePanels.length === 0) return null
                return (
                  <div className="app-sidebar-panels">
                    {activePanels.map((panelId) => {
                      const panel = sidebarPanels.get(panelId)!
                      const PanelComponent = panel.component
                      return (
                        <PanelComponent
                          key={panelId}
                          repoRoot={repoRoot}
                          onClose={() => togglePanel(panelId)}
                        />
                      )
                    })}
                  </div>
                )
              })()}
          </div>

          <NotificationPanel />
          {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
          {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
          {logOpen && <LogWindow onClose={() => setLogOpen(false)} />}
          {paletteOpen && (
            <CommandPalette commands={paletteCommands} onClose={() => setPaletteOpen(false)} />
          )}
          <ToastContainer />
          {overlays.map((Overlay, i) => (
            <Overlay key={i} />
          ))}
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
