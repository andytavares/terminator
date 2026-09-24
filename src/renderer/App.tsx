import React, { useCallback, useEffect, useMemo, useRef, useState, createElement } from 'react'
import { House, LayoutGrid } from 'lucide-react'
import { UnifiedSidebar } from './components/sidebar/UnifiedSidebar'
import { AppBand } from './components/sidebar/AppBand'
import { TerminalPane } from './components/terminal/TerminalPane'
import { TabBar } from './components/terminal/TabBar'
import { SettingsPanel } from './components/settings/SettingsPanel'
import { ToastContainer } from './components/ToastContainer'
import { LogWindow } from './components/LogWindow'
import { ErrorBoundary } from './components/ErrorBoundary'
import { QuickActions } from './components/QuickActions'
import type { QuickAction } from './quick-actions/types'
import { buildCoreActions } from './quick-actions/core-actions'
import {
  buildSurfaceActions,
  findSurface,
  type SurfaceRegistration,
} from './quick-actions/surface-actions'
import {
  buildExtensionActions,
  type RegisteredCommand,
  type DeclaredCommand,
} from './quick-actions/extension-actions'
import { CORE_GROUPS } from './quick-actions/groups'
import { buildCustomQuickActions } from './quick-actions/custom-runtime'
import { rankFirstScreen } from './quick-actions/rank'
import {
  recordUsage,
  pruneUsage,
  togglePin,
  recordDirectUse,
  shouldShowHint,
} from './quick-actions/usage'
import { useWorkspaceStore } from './stores/workspace.store'
import { useSettingsStore } from './stores/settings.store'
import { useIntegrationsStore } from './stores/integrations.store'
import { useSessionRecordsStore } from './stores/session-records.store'
import { useSessionStore } from './stores/session.store'
import { useSessionFacts, useIssue } from './components/session/useSessionFacts'
import { SessionLinkDialog } from './components/session/SessionLinkDialog'
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
import { EmptyState } from './components/EmptyState'
import { OverviewScreen } from './components/overview/OverviewScreen'
import { HomeScreen } from './components/home/HomeScreen'
import { BellAndBusySource } from './sidebar/agent-state'
import { MetricsBar } from './components/overview/MetricsBar'
import { useMetricsStore } from './stores/metrics.store'
import { AboutDialog } from './components/AboutDialog'
import { NameTerminalDialog } from './components/NameTerminalDialog'
import { SCRATCH_PROJECT_ID } from '../shared/types/index'
import { adoptTerminalSession } from './terminal/session-controller'
import { revealSession } from './terminal/navigate-to-session'
import { qualifiedBranchLabel } from './sidebar/branch-display'

/** Counts the sessions waiting on the operator for Home's badge. */
const needsYouSource = new BellAndBusySource()

installLogInterceptor()

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
  const [searchSignal, setSearchSignal] = useState(0)
  const [registeredCommands, setRegisteredCommands] = useState<RegisteredCommand[]>([])
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
  const { linkFor: issueLinkFor, issueFor, openLinkDialog, openDrawer } = useIntegrationsStore()
  const { system, enableGlobalMetrics, disableGlobalMetrics } = useMetricsStore()
  const {
    handleProcessExit,
    getSessionsForProject,
    getActiveSessionForProject,
    getFocusedSession,
    getPaneLayout,
    closeSplitLeaf,
    getTerminalInstance,
    closeSession,
    projectViews,
    sessions,
    setActiveSessionForProject,
  } = useSessionStore()
  const activeScratchSessionId = projectViews.get(SCRATCH_PROJECT_ID)?.activeSessionId ?? null
  const { addToast } = useToastStore()
  const {
    addNotification,
    unreadCount,
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
    sidebarButtons,
    quickActionGroups,
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

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId)
  const activeProjects = activeWorkspaceId
    ? (projectsByWorkspaceId.get(activeWorkspaceId) ?? [])
    : []
  const activeProject = activeProjects.find((p) => p.id === activeProjectId)
  // For worktree projects use their own path; otherwise fall back to the workspace folder
  const repoRoot = activeProject?.worktreePath ?? activeWorkspace?.folderPath ?? null

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
    setQuickActionsOpen((open) => {
      if (open) setSearchSignal((n) => n + 1)
      return true
    })
  }, [])

  const handleDirectShortcut = useCallback((actionId: string) => {
    const current = useSettingsStore.getState().globalSettings?.quickActions?.directUse ?? []
    void useSettingsStore
      .getState()
      .updateQuickActions({ directUse: recordDirectUse(current, actionId) })
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

  useKeyboardShortcuts({
    onEditSessionNote: () => {
      const sessionId = activeProjectId
        ? (projectViews.get(activeProjectId)?.activeSessionId ?? null)
        : null
      // Set then clear, so pressing the shortcut twice reopens the editor.
      setEditNoteSessionId(sessionId)
      queueMicrotask(() => setEditNoteSessionId(null))
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

  // Sessions are offered in the existing palette rather than a second overlay.
  const paletteSessions = useMemo(() => {
    const repoNameById = new Map(workspaces.map((w) => [w.id, w.name]))
    const projectName = new Map(
      [...projectsByWorkspaceId.values()]
        .flat()
        .map((p) => [p.id, qualifiedBranchLabel(p, repoNameById.get(p.workspaceId))])
    )
    return [...sessions.values()]
      .filter((s) => s.status !== 'closed')
      .map((s) => ({
        id: s.id,
        projectId: s.projectId,
        tabTitle: s.tabTitle,
        projectName: projectName.get(s.projectId) ?? '',
      }))
  }, [sessions, projectsByWorkspaceId, workspaces])

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

  const qaProjectId = scratchActive ? SCRATCH_PROJECT_ID : activeProjectId
  const focusedSessionId = qaProjectId
    ? (getFocusedSession?.(qaProjectId) ?? getActiveSessionForProject?.(qaProjectId) ?? null)
    : null
  const focusedSession = focusedSessionId ? sessions.get(focusedSessionId) : undefined

  const [declaredCommands, setDeclaredCommands] = useState<DeclaredCommand[]>([])

  useEffect(() => {
    if (!quickActionsOpen) return
    void window.electronAPI.extension.getCommands().then((r) => setRegisteredCommands(r.commands))
    void window.electronAPI.extension.list().then((r) => {
      const declared: DeclaredCommand[] = []
      for (const ext of r.extensions) {
        for (const cmd of ext.contributes?.commands ?? []) {
          declared.push({
            extensionId: ext.id,
            id: cmd.id,
            label: cmd.label,
            mnemonic: cmd.mnemonic,
            shortcut: cmd.shortcut,
            description: cmd.description,
            requires: cmd.requires,
          })
        }
      }
      setDeclaredCommands(declared)
    })
  }, [quickActionsOpen])

  const surfaceOwner = [activeGlobalTabId, activeWorkspaceTabId, activeProjectTabId].find(
    (id): id is string => !!id && !id.startsWith('core.')
  )

  const actionContext = useMemo(
    () => ({
      projectId: qaProjectId,
      sessionId: focusedSessionId,
      repoRoot,
      agentState: focusedSession?.agentState ?? null,
      isAgentSession: focusedSession?.type === 'agent',
      surfaceOwner: surfaceOwner ?? null,
    }),
    [qaProjectId, focusedSessionId, repoRoot, focusedSession, surfaceOwner]
  )

  const quickActionGroupsAll = useMemo(
    () => [...CORE_GROUPS, ...quickActionGroups],
    [quickActionGroups]
  )

  const contextGroupId = surfaceOwner
    ? (quickActionGroupsAll.find((g) => g.owner === surfaceOwner)?.id ?? null)
    : null

  const contextLabel = contextGroupId
    ? `in ${quickActionGroupsAll.find((g) => g.id === contextGroupId)?.label ?? surfaceOwner}`
    : focusedSession
      ? `in terminal · ${focusedSession.tabTitle}`
      : undefined

  const activeIssueLink = activeProjectId ? issueLinkFor(activeProjectId) : null
  const activeIssue = activeProjectId ? issueFor(activeProjectId) : null

  // Quick Actions' issue actions follow the focused terminal's own resolved
  // ticket — its own link, else its branch's — rather than always the branch's.
  const sessionFacts = useSessionFacts()
  const focusedFacts = focusedSessionId
    ? sessionFacts.find((f) => f.sessionId === focusedSessionId)
    : undefined
  const focusedWorkItem = focusedFacts?.workItem ?? null
  const focusedIssue = useIssue(focusedWorkItem?.ref ?? null)
  const focusedIssueLink = focusedWorkItem
    ? { key: focusedWorkItem.ref.key, tracker: focusedWorkItem.ref.tracker }
    : null

  const coreActions = useMemo(
    () =>
      buildCoreActions({
        hasProjectFocused: !!qaProjectId,
        hasTerminalFocused: !!focusedSessionId,
        activeWorkspaceId,
        workspaces: workspaces.map((w) => ({ id: w.id, name: w.name })),
        sessions: paletteSessions,
        issueLink: focusedIssueLink,
        issue: focusedIssue ?? null,
        onNewTab: handleNewTab,
        onSplit: (direction) => {
          if (!qaProjectId) return
          const settings = resolveSettings(activeWorkspaceId)
          void splitSession(
            qaProjectId,
            direction,
            resolveActiveCwd(),
            settings.terminal.scrollbackLimit
          )
        },
        onClosePane: () => {
          if (!qaProjectId) return
          const layout = getPaneLayout?.(qaProjectId)
          const focusedId = getFocusedSession?.(qaProjectId)
          if (layout && focusedId) {
            closeSplitLeaf(qaProjectId, focusedId)
            void closeSession(focusedId)
          } else {
            const activeId = getActiveSessionForProject?.(qaProjectId)
            if (activeId) void closeSession(activeId)
          }
        },
        onClear: () => {
          if (focusedSessionId) window.electronAPI.terminal.input(focusedSessionId, '\x0c')
        },
        onNewScratch: handleNewScratch,
        onEditNote: () => {
          setEditNoteSessionId(focusedSessionId)
          queueMicrotask(() => setEditNoteSessionId(null))
        },
        onCycleTab: (delta) => {
          if (!qaProjectId) return
          const list = getSessionsForProject(qaProjectId)
          if (list.length === 0) return
          const idx = list.findIndex((s) => s.id === getActiveSessionForProject?.(qaProjectId))
          const next = list[(((idx + delta) % list.length) + list.length) % list.length]
          // Cycling stays within the project already on screen — unlike the other
          // "go to session" paths it must not switch to the session's own
          // projectId — but still has to leave whatever tab is showing and ask
          // for focus, the way every other path does.
          useExtensionRegistry.getState().setActiveGlobalTab(null)
          useExtensionRegistry.getState().setActiveWorkspaceTab(null)
          useExtensionRegistry.getState().setActiveProjectTab(null)
          setActiveSessionForProject(qaProjectId, next.id)
          useSessionStore.getState().requestFocus(next.id)
        },
        onCycleRecentSession: (delta) => {
          const all = [...sessions.values()]
            .filter((s) => s.status !== 'closed')
            .sort((a, b) => (b.lastAttendedAt ?? 0) - (a.lastAttendedAt ?? 0))
          if (all.length < 2) return
          const idx = all.findIndex((s) => s.id === focusedSessionId)
          const next = all[((idx === -1 ? 0 : idx) + delta + all.length) % all.length]
          revealSession(next.id)
        },
        onSelectSession: (session) => {
          revealSession(session.id)
        },
        onNextWaiting: () => {
          const waiting = [...sessions.values()].filter((s) => s.agentState === 'awaiting-input')
          if (waiting.length === 0) return
          const idx = waiting.findIndex((s) => s.id === focusedSessionId)
          const next = waiting[(idx + 1) % waiting.length]
          revealSession(next.id)
        },
        onResume: () => setActiveGlobalTab('core.home'),
        onSwitchWorkspace: (id) => setActiveWorkspace(id),
        onCycleWorkspace: (delta) => {
          if (workspaces.length === 0) return
          const idx = workspaces.findIndex((w) => w.id === activeWorkspaceId)
          const next = workspaces[(idx + delta + workspaces.length) % workspaces.length]
          setActiveWorkspace(next.id)
        },
        onLinkIssue: () => focusedSessionId && setLinkSessionId(focusedSessionId),
        onLinkIssueBranch: () => activeProjectId && openLinkDialog(activeProjectId),
        onViewIssue: () => activeProjectId && openDrawer(activeProjectId),
        onCopyIssueKey: () =>
          focusedIssueLink && void navigator.clipboard?.writeText(focusedIssueLink.key),
        onOpenIssue: () =>
          focusedIssue && void window.electronAPI.shell.openExternal(focusedIssue.url),
        onHome: () => setActiveGlobalTab('core.home'),
        onOverview: handleToggleOverview,
        onToggleSidebar: () => setSidebarVisible((v) => !v),
        onOpenSettings: handleOpenSettings,
        onToggleLog: handleToggleLog,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      qaProjectId,
      focusedSessionId,
      activeWorkspaceId,
      workspaces,
      paletteSessions,
      activeIssueLink,
      activeIssue,
      focusedIssueLink,
      focusedIssue,
      sessions,
      activeProjectId,
    ]
  )

  const extActions = useMemo(
    () =>
      buildExtensionActions(
        registeredCommands,
        declaredCommands,
        quickActionGroupsAll,
        actionContext,
        (key, ctx) => void window.electronAPI.extension.executeCommand(key, ctx),
        extensionCommands.map((c) => ({
          id: c.id,
          label: c.label,
          description: c.description,
          shortcut: c.shortcut,
          action: c.action,
        }))
      ),
    [registeredCommands, declaredCommands, quickActionGroupsAll, actionContext, extensionCommands]
  )

  const surfaceActions = useMemo(
    () =>
      buildSurfaceActions(surfaces, quickActionGroupsAll, activateSurface, [
        ...coreActions,
        ...extActions,
      ]),
    [surfaces, quickActionGroupsAll, activateSurface, coreActions, extActions]
  )

  const customEnv = useMemo(
    () => ({
      focused: focusedSession
        ? {
            sessionId: focusedSession.id,
            isAgent: focusedSession.type === 'agent',
            agentState: focusedSession.agentState,
          }
        : null,
      projectId: qaProjectId,
      vars: {
        cwd: resolveActiveCwd(),
        branch: activeProject?.gitBranch ?? null,
        worktree: activeProject?.worktreePath ?? null,
        repo: activeWorkspace?.folderPath ?? null,
        issue: activeIssueLink?.key ?? null,
        selection: focusedSessionId
          ? getTerminalInstance?.(focusedSessionId)?.getSelection() || null
          : null,
      },
    }),
    [
      focusedSession,
      qaProjectId,
      resolveActiveCwd,
      activeProject,
      activeWorkspace,
      activeIssueLink,
      focusedSessionId,
      getTerminalInstance,
    ]
  )

  const customActions = useMemo(() => {
    const global = globalSettings?.quickActions?.custom ?? []
    const workspaceCustom = activeWorkspaceId
      ? (useSettingsStore.getState().workspaceSettings.get(activeWorkspaceId)?.overrides
          .quickActions?.custom ?? [])
      : []
    return buildCustomQuickActions([...global, ...workspaceCustom], customEnv, {
      input: (sessionId, data) => window.electronAPI.terminal.input(sessionId, data),
      openTab: async (projectId) => {
        const settings = resolveSettings(activeWorkspaceId)
        const id = await createSession(
          projectId,
          'human',
          '',
          resolveActiveCwd(),
          settings.terminal.scrollbackLimit
        )
        return id as string
      },
      notify: (message) => addToast({ type: 'error', message }),
    })
  }, [
    globalSettings,
    activeWorkspaceId,
    customEnv,
    resolveSettings,
    resolveActiveCwd,
    createSession,
    addToast,
  ])

  const allQuickActions: QuickAction[] = useMemo(
    () => [...coreActions, ...surfaceActions, ...extActions, ...customActions],
    [coreActions, surfaceActions, extActions, customActions]
  )

  const quickActionsSettings = globalSettings?.quickActions
  const { pinned, recent } = useMemo(
    () =>
      rankFirstScreen(allQuickActions, {
        pins: quickActionsSettings?.pins ?? [],
        usage: quickActionsSettings?.usage ?? [],
        now: Date.now(),
      }),
    [allQuickActions, quickActionsSettings]
  )

  const handleRunQuickAction = useCallback(
    (action: QuickAction) => {
      setQuickActionsOpen(false)
      const settings = useSettingsStore.getState().globalSettings?.quickActions ?? {
        pins: [],
        usage: [],
        directUse: [],
        custom: [],
      }
      const liveIds = new Set(allQuickActions.map((a) => a.id))
      const usage = pruneUsage(recordUsage(settings.usage, action.id, Date.now()), liveIds)
      const pins = pruneUsage(
        settings.pins.map((id) => ({ id })),
        liveIds
      ).map((p) => p.id)
      const directUse = pruneUsage(settings.directUse, liveIds)
      void useSettingsStore.getState().updateQuickActions({ usage, pins, directUse })
      if (shouldShowHint(action, settings.directUse)) {
        addToast({ type: 'info', message: `Next time: ${action.shortcut}` })
      }
      // `action.run()` can throw synchronously (most core actions are sync) or
      // return a rejected promise (custom/extension actions). Only wrapping
      // the call in an async function catches both — Promise.resolve(fn())
      // still lets a synchronous throw escape before it ever wraps anything.
      void (async () => {
        try {
          await action.run()
        } catch (error: unknown) {
          addToast({
            type: 'error',
            message: error instanceof Error ? error.message : 'Action failed',
          })
        }
      })()
    },
    [allQuickActions, addToast]
  )

  const handleToggleQuickActionPin = useCallback((id: string) => {
    const settings = useSettingsStore.getState().globalSettings?.quickActions
    const pins = togglePin(settings?.pins ?? [], id)
    void useSettingsStore.getState().updateQuickActions({ pins })
  }, [])

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
    void createSession(activeProjectId, 'human', '', cwd, settings.terminal.scrollbackLimit).catch(
      () => {}
    )
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
      const sessionId = projectViews.get(effectiveProjectId ?? '')?.activeSessionId
      if (effectiveProjectId && sessionId) {
        void closeSession(sessionId)
      }
    })
  }, [scratchActive, activeProjectId, projectViews, closeSession, handleDirectShortcut])

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

  // A menu accelerator, not a renderer keydown: macOS claims Cmd+` for window
  // cycling before the keydown is ever dispatched to the page.
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

  const needsYouCount = useMemo(
    () =>
      [...sessions.values()].filter((s) => needsYouSource.derive(s) === 'awaiting-input').length,
    [sessions]
  )

  useEffect(() => {
    useExtensionRegistry.getState().updateGlobalTab('core.home', {
      badge: needsYouCount,
      badgeLabel: `${needsYouCount} need you`,
    })
  }, [needsYouCount])

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
            sidebarItems={sidebarButtons}
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
                    icon="⬡"
                    title="Welcome to Terminator"
                    subtitle="A keyboard-first terminal for developers. Open a project to get started."
                    actions={[
                      { label: 'Quick actions', shortcut: '⌘P', onClick: handleOpenQuickActions },
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
                    actions={[
                      { label: 'Quick actions', shortcut: '⌘P', onClick: handleOpenQuickActions },
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
          {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
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
          {linkSessionId !== null &&
            (() => {
              const facts = sessionFacts.find((f) => f.sessionId === linkSessionId)
              if (!facts) return null
              return <SessionLinkDialog facts={facts} onClose={() => setLinkSessionId(null)} />
            })()}
          {quickActionsOpen && (
            <QuickActions
              groups={quickActionGroupsAll}
              actions={allQuickActions}
              pinned={pinned}
              recent={recent}
              pins={quickActionsSettings?.pins ?? []}
              contextGroupId={contextGroupId}
              contextLabel={contextLabel}
              searchSignal={searchSignal}
              onRun={handleRunQuickAction}
              onTogglePin={handleToggleQuickActionPin}
              onClose={() => setQuickActionsOpen(false)}
            />
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
