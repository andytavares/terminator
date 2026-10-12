import { useShallow } from 'zustand/react/shallow'
import React, {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  createElement,
} from 'react'
import { Hexagon, House, LayoutGrid, Option } from 'lucide-react'
import { EmptyState } from '@terminator/extension-ui'
import { UnifiedSidebar } from './components/sidebar/UnifiedSidebar'
import { AppBand } from './components/sidebar/AppBand'
import { TerminalPane } from './components/terminal/TerminalPane'
import { TabBar } from './components/terminal/TabBar'
import { ToastContainer } from './components/ToastContainer'
import { LogWindow } from './components/LogWindow'
import { ErrorBoundary } from './components/ErrorBoundary'
import { HomeBadge, GlobalMetricsBar, SessionLinkHost } from './components/AppShellParts'
// Not lazy: the keys typed straight after ⌘P ("n n", "/") would reach the
// app before a lazily loaded panel mounted, and be lost.
import { QuickActionsHost } from './components/QuickActionsHost'
import { findSurface, type SurfaceRegistration } from './quick-actions/surface-actions'
import { recordDirectUse } from './quick-actions/usage'
import { useActiveScope } from './quick-actions/use-active-scope'
import type { ShellCommands } from './quick-actions/use-core-quick-actions'
import { useWorkspaceStore } from './stores/workspace.store'
import { useSettingsStore } from './stores/settings.store'
import { useSessionRecordsStore } from './stores/session-records.store'
import { useExtensionCommandsStore } from './stores/extension-commands.store'
import { useSessionStore } from './stores/session.store'
import { useTerminalOpenErrorStore } from './stores/terminal-open-error.store'
import { useTerminalSession } from './hooks/useTerminalSession'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { useExtensionEscapeExit } from './hooks/useExtensionEscapeExit'
import { useBranchSync } from './hooks/useBranchSync'
import { installLogInterceptor, useLogStore } from './stores/log.store'
import { useToastStore } from './stores/toast.store'
import { dispatchNotification } from './lib/notifications'
import { useNotificationStore } from './stores/notification.store'
import { NotificationPanel } from './components/NotificationPanel'
import { useExtensionRegistry } from './extensions/registry'
import { HomeScreen } from './components/home/HomeScreen'
import { useMetricsStore } from './stores/metrics.store'
import { AboutDialog } from './components/AboutDialog'
import { NameTerminalDialog } from './components/NameTerminalDialog'
import { SCRATCH_PROJECT_ID } from '../shared/types/index'
import { adoptTerminalSession } from './terminal/session-controller'
import { revealSession } from './terminal/navigate-to-session'

installLogInterceptor()

// Opened on demand, so each is its own chunk rather than part of the first
// script (https://react.dev/reference/react/lazy).
const SettingsPanel = lazy(() =>
  import('./components/settings/SettingsPanel').then((m) => ({ default: m.SettingsPanel }))
)
const OverviewScreen = lazy(() =>
  import('./components/overview/OverviewScreen').then((m) => ({ default: m.OverviewScreen }))
)

export function App(): JSX.Element {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [pendingCreate, setPendingCreate] = useState<{
    projectId: string
    cwd: string
    scrollbackLimit: number
    defaultName: string
  } | null>(null)
  const [logOpen, setLogOpen] = useState(false)
  const [sidebarVisible, setSidebarVisible] = useState(true)
  const [quickActionsOpen, setQuickActionsOpen] = useState(false)
  const [quickActionsOpenedAt, setQuickActionsOpenedAt] = useState(0)
  const [searchSignal, setSearchSignal] = useState(0)
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
  } = useWorkspaceStore(
    useShallow((s) => ({
      loadWorkspaces: s.loadWorkspaces,
      activeWorkspaceId: s.activeWorkspaceId,
      activeProjectId: s.activeProjectId,
      workspaces: s.workspaces,
      setActiveWorkspace: s.setActiveWorkspace,
      projectsByWorkspaceId: s.projectsByWorkspaceId,
      resolveActiveCwd: s.resolveActiveCwd,
      scratchActive: s.scratchActive,
      setScratchActive: s.setScratchActive,
    }))
  )
  const { loadSettings, globalSettings, markWelcomeSeen, resolveSettings } = useSettingsStore(
    useShallow((s) => ({
      loadSettings: s.loadSettings,
      globalSettings: s.globalSettings,
      markWelcomeSeen: s.markWelcomeSeen,
      resolveSettings: s.resolveSettings,
    }))
  )
  const { enableGlobalMetrics, disableGlobalMetrics } = useMetricsStore(
    useShallow((s) => ({
      enableGlobalMetrics: s.enableGlobalMetrics,
      disableGlobalMetrics: s.disableGlobalMetrics,
    }))
  )
  // No `sessions` here: they change every second while a terminal prints, and
  // the parts that draw them subscribe on their own.
  const { handleProcessExit, getSessionsForProject, closeSession, activeScratchSessionId } =
    useSessionStore(
      useShallow((s) => ({
        handleProcessExit: s.handleProcessExit,
        getSessionsForProject: s.getSessionsForProject,
        closeSession: s.closeSession,
        activeScratchSessionId: s.projectViews.get(SCRATCH_PROJECT_ID)?.activeSessionId ?? null,
      }))
    )
  const { addToast } = useToastStore(useShallow((s) => ({ addToast: s.addToast })))
  const {
    addNotification,
    unreadCount,
    togglePanel: toggleNotificationPanel,
  } = useNotificationStore(
    useShallow((s) => ({
      addNotification: s.addNotification,
      unreadCount: s.unreadCount,
      togglePanel: s.togglePanel,
    }))
  )

  const { createSession } = useTerminalSession()
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
    overlays,
  } = useExtensionRegistry()

  /**
   * App-level destinations in a stable order: core's first, then contributed
   * ones, unless a registration asked for a place of its own.
   */
  const sortedGlobalTabs = useMemo(
    () =>
      Array.from(globalTabs.values()).sort((a, b) => {
        const weight = (t: typeof a) =>
          t.sortOrder !== undefined ? t.sortOrder : t.id.startsWith('core.') ? 0 : 1
        return weight(a) - weight(b)
      }),
    [globalTabs]
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

  const handleOpenSettings = useCallback(() => setSettingsOpen(true), [])
  const setLogOpenWithInset = useCallback((open: boolean) => {
    setLogOpen(open)
    window.electronAPI.extension.setBottomInset(open ? 280 : 0)
  }, [])
  const handleToggleLog = useCallback(
    () => setLogOpenWithInset(!logOpen),
    [logOpen, setLogOpenWithInset]
  )
  const handleOpenQuickActions = useCallback(() => {
    setQuickActionsOpenedAt(Date.now())
    setQuickActionsOpen((open) => {
      if (open) setSearchSignal((n) => n + 1)
      return true
    })
  }, [])

  const handleDirectShortcut = useCallback((actionId: string) => {
    const current = useSettingsStore.getState().globalSettings?.quickActions?.directUse ?? []
    const directUse = recordDirectUse(current, actionId)
    if (directUse !== current) void useSettingsStore.getState().updateQuickActions({ directUse })
  }, [])
  const handleToggleOverview = useCallback(() => {
    setActiveGlobalTab(activeGlobalTabId === 'core.overview' ? null : 'core.overview')
  }, [activeGlobalTabId, setActiveGlobalTab])

  const handleNewTab = useCallback(() => {
    const projectId = scratchActive ? SCRATCH_PROJECT_ID : activeProjectId
    if (!projectId) return
    const settings = resolveSettings(activeWorkspaceId)
    const cwd = resolveActiveCwd()
    const scrollbackLimit = settings.terminal.scrollbackLimit
    if (settings.terminal.promptForName) {
      const { projectViews } = useSessionStore.getState()
      const next = (projectViews.get(projectId)?.terminalCounter ?? 0) + 1
      setPendingCreate({ projectId, cwd, scrollbackLimit, defaultName: `Terminal ${next}` })
    } else {
      void createSession(projectId, 'human', '', cwd, scrollbackLimit).catch(() => {})
    }
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

  const [editNoteSessionId, setEditNoteSessionId] = useState<string | null>(null)
  const [linkSessionId, setLinkSessionId] = useState<string | null>(null)
  const handleEditNote = useCallback((sessionId: string | null) => {
    // Set then clear, so pressing the shortcut twice reopens the editor.
    setEditNoteSessionId(sessionId)
    queueMicrotask(() => setEditNoteSessionId(null))
  }, [])

  useKeyboardShortcuts({
    onEditSessionNote: () => {
      const { projectViews } = useSessionStore.getState()
      handleEditNote(
        activeProjectId ? (projectViews.get(activeProjectId)?.activeSessionId ?? null) : null
      )
    },
    onOpenSettings: handleOpenSettings,
    onToggleLog: handleToggleLog,
    onOpenCommandPalette: handleOpenQuickActions,
    onToggleOverview: handleToggleOverview,
    onOpenHome: () => setActiveGlobalTab('core.home'),
    onNewScratch: handleNewScratch,
    onNewTab: handleNewTab,
    scratchProjectId: scratchActive ? SCRATCH_PROJECT_ID : null,
    onDirectShortcut: handleDirectShortcut,
  })

  useExtensionEscapeExit()

  /**
   * A card is named by its branch, so the branch it names has to be the one its
   * tree is on. Worktree cards are fixed at creation and are left out; the rest
   * follow whatever the operator checks out in their own terminal.
   */
  const branchSyncTargets = useMemo(() => {
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
  useBranchSync(branchSyncTargets)

  // Every non-core surface an extension registered, generic over the four
  // registration kinds — core never names an extension (Constitution II).
  const surfaces: SurfaceRegistration[] = useMemo(() => {
    const list: SurfaceRegistration[] = []
    for (const tab of globalTabs.values()) {
      if (tab.id.startsWith('core.')) continue
      list.push({ extensionId: tab.id, view: tab.view ?? 'main', label: tab.label, kind: 'global' })
    }
    for (const tab of workspaceTabs.values()) {
      list.push({
        extensionId: tab.id,
        view: tab.view ?? 'workspace',
        label: tab.label,
        kind: 'workspace',
      })
    }
    for (const tab of projectTabs.values()) {
      list.push({
        extensionId: tab.id,
        view: tab.view ?? 'project',
        label: tab.label,
        kind: 'project',
      })
    }
    for (const panel of sidebarPanels.values()) {
      list.push({
        extensionId: panel.id,
        view: panel.view ?? 'sidebar',
        label: panel.label,
        kind: 'sidebar',
      })
    }
    return list
  }, [globalTabs, workspaceTabs, projectTabs, sidebarPanels])

  const activateSurface = useCallback(
    (surface: SurfaceRegistration) => {
      if (surface.kind === 'global') setActiveGlobalTab(surface.extensionId)
      else if (surface.kind === 'workspace') setActiveWorkspaceTab(surface.extensionId)
      else if (surface.kind === 'project') setActiveProjectTab(surface.extensionId)
      else if (!useExtensionRegistry.getState().openPanels.has(surface.extensionId))
        togglePanel(surface.extensionId)
    },
    [setActiveGlobalTab, setActiveWorkspaceTab, setActiveProjectTab, togglePanel]
  )

  const shellCommands: ShellCommands = useMemo(
    () => ({
      onNewTab: handleNewTab,
      onNewScratch: handleNewScratch,
      onEditNote: handleEditNote,
      onLinkSession: setLinkSessionId,
      onToggleOverview: handleToggleOverview,
      onToggleSidebar: () => setSidebarVisible((v) => !v),
      onOpenSettings: handleOpenSettings,
      onToggleLog: handleToggleLog,
    }),
    [
      handleNewTab,
      handleNewScratch,
      handleEditNote,
      handleToggleOverview,
      handleOpenSettings,
      handleToggleLog,
    ]
  )
  const closeQuickActions = useCallback(() => setQuickActionsOpen(false), [])

  useEffect(() => {
    if (!window.electronAPI.quickActions?.onOpen) return
    return window.electronAPI.quickActions.onOpen(() => handleOpenQuickActions())
  }, [handleOpenQuickActions])

  useEffect(() => {
    loadWorkspaces()
    loadSettings()
  }, [loadWorkspaces, loadSettings])

  useEffect(() => {
    const records = useSessionRecordsStore.getState()
    void records.load()
    return records.subscribe()
  }, [])

  // Read before the first ⌘P, so the keys typed straight after it find them,
  // and again whenever a backend registers or drops a command.
  useEffect(() => {
    const refresh = (): void => {
      useExtensionCommandsStore
        .getState()
        .refresh()
        .catch((error: unknown) => console.warn('Could not read extension commands', error))
    }
    refresh()
    return window.electronAPI.extension?.onCommandsChanged?.(refresh)
  }, [])

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

  const openRetry = useTerminalOpenErrorStore((s) =>
    activeProjectId ? (s.retries[activeProjectId] ?? 0) : 0
  )

  // Auto-open a terminal whenever the Terminal tab is active and has no sessions.
  // Covers: first project selection, switching back from an extension tab, all sessions closed.
  useEffect(() => {
    if (!activeProjectId || activeProjectTabId !== null) return
    if (getSessionsForProject(activeProjectId).length > 0) return
    const settings = resolveSettings(activeWorkspaceId)
    const cwd = resolveActiveCwd()
    const projectId = activeProjectId
    createSession(projectId, 'human', '', cwd, settings.terminal.scrollbackLimit).then(
      () => useTerminalOpenErrorStore.getState().clearError(projectId),
      (err: unknown) =>
        useTerminalOpenErrorStore
          .getState()
          .setError(projectId, err instanceof Error ? err.message : String(err))
    )
  }, [
    activeProjectId,
    openRetry,
    activeProjectTabId,
    activeWorkspaceId,
    resolveActiveCwd,
    resolveSettings,
    createSession,
    getSessionsForProject,
  ])

  useEffect(() => {
    if (!window.electronAPI.extensionEvents?.onMenuOpenSettings) return
    return window.electronAPI.extensionEvents.onMenuOpenSettings(() => {
      handleDirectShortcut('core.open-settings')
      setSettingsOpen(true)
    })
  }, [handleDirectShortcut])

  useEffect(() => {
    if (!window.electronAPI.extensionEvents?.onMenuOpenAbout) return
    return window.electronAPI.extensionEvents.onMenuOpenAbout(() => setAboutOpen(true))
  }, [])

  useEffect(() => {
    if (!window.electronAPI.extensionEvents?.onMenuToggleSidebar) return
    return window.electronAPI.extensionEvents.onMenuToggleSidebar(() => {
      handleDirectShortcut('core.toggle-sidebar')
      setSidebarVisible((v) => !v)
    })
  }, [handleDirectShortcut])

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
      handleDirectShortcut('core.close-tab')
      const effectiveProjectId = scratchActive ? SCRATCH_PROJECT_ID : activeProjectId
      const { projectViews } = useSessionStore.getState()
      const sessionId = projectViews.get(effectiveProjectId ?? '')?.activeSessionId
      if (effectiveProjectId && sessionId) {
        void closeSession(sessionId)
      }
    })
  }, [scratchActive, activeProjectId, closeSession, handleDirectShortcut])

  // Keep a ref so the effect always sees the latest openPanels without re-running on every change
  const openPanelsRef = useRef(openPanels)
  useEffect(() => {
    openPanelsRef.current = openPanels
  }, [openPanels])

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

  // Home is registered before Overview so it sits first in the band.
  useEffect(() => {
    return useExtensionRegistry.getState().registerGlobalTab({
      id: 'core.home',
      label: 'Home',
      icon: createElement(House),
      component: () => <HomeScreen onOpenQuickActions={handleOpenQuickActions} />,
      permanent: true,
    })
  }, [handleOpenQuickActions])

  // Home is a Window-menu accelerator (Cmd+Shift+H), not a renderer keydown.
  useEffect(() => {
    if (!window.electronAPI.extensionEvents?.onMenuOpenHome) return
    return window.electronAPI.extensionEvents.onMenuOpenHome(() => {
      handleDirectShortcut('core.open-home')
      setActiveGlobalTab('core.home')
    })
  }, [setActiveGlobalTab, handleDirectShortcut])

  // Home is where the app opens.
  useEffect(() => {
    setActiveGlobalTab('core.home')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    return window.electronAPI.extensionBridge.on('extension:show-surface', (data) => {
      const { extensionId, view } = data as { extensionId: string; view: string }
      const surface = findSurface(surfaces, extensionId, view)
      if (surface) activateSurface(surface)
    })
  }, [surfaces, activateSurface])

  // A terminal an extension opened. The renderer owns the tab list, so without
  // adopting it the process runs and nothing on screen ever shows it — and its
  // output is held until the tab is mounted rather than delivered to nobody.
  useEffect(() => {
    return window.electronAPI.extensionBridge.on('terminal:adopt', (data) => {
      const { sessionId, projectId, tabTitle, scrollbackLimit } = data as {
        sessionId: string
        projectId: string
        tabTitle: string
        scrollbackLimit: number
      }
      adoptTerminalSession({ sessionId, projectId, tabTitle, scrollbackLimit })
    })
  }, [])

  useEffect(() => {
    return window.electronAPI.extensionBridge.on('terminal:close-tab', (data) => {
      const { sessionId } = data as { sessionId: string }
      void useSessionStore.getState().closeSession(sessionId)
    })
  }, [])

  useEffect(() => {
    return window.electronAPI.extensionBridge.on('terminal:navigate-to-session', (data) => {
      const { sessionId } = data as { sessionId: string }
      revealSession(sessionId)
    })
  }, [])

  useEffect(() => {
    const unsubLog = window.electronAPI.extensionBridge.on('log:push', (data) => {
      const { level, message } = data as { level: 'info' | 'warn' | 'error'; message: string }
      useLogStore.getState().addEntry(level, message)
    })
    const unsubDisconnected = window.electronAPI.extensionBridge.on(
      'remote:tunnel-disconnected',
      () => {
        dispatchNotification({
          type: 'error',
          title: 'Remote tunnel disconnected',
          message: 'ngrok tunnel disconnected. Click Reconnect in Settings to restore it.',
          key: 'remoteTunnelDisconnected',
        })
      }
    )
    return () => {
      unsubLog()
      unsubDisconnected()
    }
  }, [])

  const showMetricsBar = globalSettings?.ui?.showMetricsBar ?? false
  // Scratch view takes priority over project view when active
  const displayProjectId = scratchActive ? SCRATCH_PROJECT_ID : activeProjectId

  return (
    <ErrorBoundary>
      <div className="app-layout">
        <div className="app-body">
          {/* App-level destinations own the window's left edge, full height, so
              they stay put whether or not the sidebar is showing. */}
          <AppBand
            globalTabs={sortedGlobalTabs}
            activeId={activeGlobalTabId}
            onSelect={(id) => setActiveGlobalTab(id === activeGlobalTabId ? null : id)}
            unreadNotifications={unreadCount}
            onBellClick={toggleNotificationPanel}
            onOpenQuickActions={handleOpenQuickActions}
          />

          <UnifiedSidebar
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
            onNewScratch={handleNewScratch}
            activeScratchSessionId={scratchActive ? activeScratchSessionId : null}
            onSelectScratchSession={(sessionId) => revealSession(sessionId)}
            visible={sidebarVisible}
          />

          <div className="app-main-area">
            {activeGlobalTabId && globalTabs.has(activeGlobalTabId) ? (
              (() => {
                const tab = globalTabs.get(activeGlobalTabId)!
                const TabComponent = tab.component as React.ComponentType<Record<string, never>>
                return (
                  <div className="main-content">
                    <Suspense fallback={null}>
                      <TabComponent />
                    </Suspense>
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
                      editNoteSessionId={editNoteSessionId}
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
                    icon={Hexagon}
                    heading="Welcome to Terminator"
                    description="A keyboard-first terminal for developers. Open a project to get started."
                    actions={[
                      { label: 'Quick actions', shortcut: '⌘P', onSelect: handleOpenQuickActions },
                      { label: 'New Tab', shortcut: '⌘T', onSelect: () => {} },
                      {
                        label: 'Open Settings',
                        shortcut: '⌘,',
                        onSelect: () => setSettingsOpen(true),
                      },
                    ]}
                  />
                ) : (
                  <EmptyState
                    icon={Option}
                    heading={
                      activeWorkspaceId
                        ? 'Select or create a project'
                        : 'Select a workspace to get started'
                    }
                    description="Pick one in the sidebar, or make one from quick actions."
                    actions={[
                      { label: 'Quick actions', shortcut: '⌘P', onSelect: handleOpenQuickActions },
                    ]}
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
          {settingsOpen && (
            <Suspense fallback={null}>
              <SettingsPanel onClose={() => setSettingsOpen(false)} />
            </Suspense>
          )}
          {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
          {pendingCreate && (
            <NameTerminalDialog
              defaultName={pendingCreate.defaultName}
              onConfirm={(name) => {
                const { projectId, cwd, scrollbackLimit } = pendingCreate
                setPendingCreate(null)
                void createSession(projectId, 'human', name, cwd, scrollbackLimit).catch(() => {})
              }}
              onCancel={() => setPendingCreate(null)}
            />
          )}
          {logOpen && <LogWindow onClose={() => setLogOpenWithInset(false)} />}
          {linkSessionId !== null && (
            <SessionLinkHost sessionId={linkSessionId} onClose={() => setLinkSessionId(null)} />
          )}
          {quickActionsOpen && (
            <QuickActionsHost
              openedAt={quickActionsOpenedAt}
              searchSignal={searchSignal}
              surfaces={surfaces}
              activateSurface={activateSurface}
              shell={shellCommands}
              onClose={closeQuickActions}
            />
          )}
          <HomeBadge />
          <ToastContainer />
          {overlays.map((Overlay, i) => (
            <Overlay key={i} />
          ))}
        </div>
        {showMetricsBar && <GlobalMetricsBar />}
      </div>
    </ErrorBoundary>
  )
}
