import { useCallback, useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { UnifiedSidebar } from './components/sidebar/UnifiedSidebar'
import { AppBand } from './components/sidebar/AppBand'
import { ErrorBoundary } from './components/ErrorBoundary'
import { GlobalMetricsBar } from './components/AppShellParts'
import type { ShellCommands } from './quick-actions/use-core-quick-actions'
import { useWorkspaceStore } from './stores/workspace.store'
import { useSettingsStore } from './stores/settings.store'
import { useSessionStore } from './stores/session.store'
import { useNotificationStore } from './stores/notification.store'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { useExtensionEscapeExit } from './hooks/useExtensionEscapeExit'
import { useExtensionRegistry } from './extensions/registry'
import { SCRATCH_PROJECT_ID } from '../shared/types/index'
import { revealSession } from './terminal/navigate-to-session'
import { useAutoOpenTerminal, useTerminalLaunch } from './shell/terminal-launch'
import {
  recordDirectShortcut,
  useBridgeEvents,
  useMenuEvents,
  useNotificationFeed,
} from './shell/main-events'
import {
  usePanelPersistence,
  usePanelsAroundProjectTabs,
  useShowSurface,
  useSurfaces,
} from './shell/panels'
import { useCoreTabs } from './shell/core-tabs'
import {
  useBranchSyncTargets,
  useGlobalMetrics,
  useInitialLoad,
  useSelectionEffects,
} from './shell/bootstrap'
import { MainArea } from './shell/MainArea'
import { useSidebarVisibility } from './shell/useSidebarVisibility'
import { ShellOverlays } from './shell/ShellOverlays'
import { BreakoutWindows } from './components/terminal/BreakoutWindowView'
import { BreakoutDropZone } from './components/terminal/BreakoutDropZone'

export function App(): JSX.Element {
  const { windows, palette, launch, note, scratchActive, quickActions } = useShellParts()
  const showMetricsBar = useMetricsBar()
  return (
    <ErrorBoundary>
      <div className="app-layout">
        <div className="app-body">
          {/* App-level destinations own the window's left edge, full height, so
              they stay put whether or not the sidebar is showing. */}
          <ShellBand onOpenQuickActions={palette.open} />
          <ShellSidebar
            visible={windows.sidebarVisible}
            scratchActive={scratchActive}
            onNewScratch={launch.newScratch}
          />
          <MainArea
            onNewTab={launch.newTab}
            onOpenQuickActions={palette.open}
            onOpenSettings={windows.openSettings}
            editNoteSessionId={note.editNoteSessionId}
          />
          <ShellOverlays {...windows} {...launch} quickActions={quickActions} />
          <BreakoutWindows />
          <BreakoutDropZone />
        </div>
        {showMetricsBar && <GlobalMetricsBar />}
      </div>
    </ErrorBoundary>
  )
}

/** The shell's state and everything it keeps running, wired together. */
function useShellParts() {
  const windows = useShellWindows()
  const palette = useQuickActionsPanel()
  const launch = useTerminalLaunch()
  const note = useNoteEditing()
  const scratchActive = useWorkspaceStore((s) => s.scratchActive)
  useShellShortcuts({ windows, palette, launch, note, scratchActive })
  const surfaces = useSurfaces()
  const showSurface = useShowSurface()
  useShellEffects({ windows, palette, surfaces, showSurface })
  const shell = useShellCommands({ windows, launch, note })
  const quickActions = palette.isOpen
    ? { ...palette.host, surfaces, activateSurface: showSurface, shell }
    : null
  return { windows, palette, launch, note, scratchActive, quickActions }
}

/** Whether the metrics bar is on, polling system metrics while it is. */
function useMetricsBar(): boolean {
  const showMetricsBar = useSettingsStore((s) => s.globalSettings?.ui?.showMetricsBar ?? false)
  useGlobalMetrics(showMetricsBar)
  return showMetricsBar
}

/** Which of the shell's windows are open: Settings, About, the log, a link dialog, the sidebar. */
function useShellWindows() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const { sidebarVisible, toggleSidebar } = useSidebarVisibility()
  const [linkSessionId, setLinkSessionId] = useState<string | null>(null)
  const [logOpen, setLogOpen] = useState(false)
  const showLog = useCallback((open: boolean) => setLogOpen(open), [])
  return {
    settingsOpen,
    aboutOpen,
    sidebarVisible,
    linkSessionId,
    logOpen,
    setLinkSessionId,
    openSettings: useCallback(() => setSettingsOpen(true), []),
    closeSettings: useCallback(() => setSettingsOpen(false), []),
    openAbout: useCallback(() => setAboutOpen(true), []),
    closeAbout: useCallback(() => setAboutOpen(false), []),
    toggleSidebar,
    toggleLog: useCallback(() => showLog(!logOpen), [logOpen, showLog]),
    closeLog: useCallback(() => showLog(false), [showLog]),
    closeLink: useCallback(() => setLinkSessionId(null), []),
  }
}

type ShellWindows = ReturnType<typeof useShellWindows>

/** The palette: open or not, when it was opened (for ranking recent use), and a signal that ⌘P
 * was pressed again while it was open, which switches it to search. */
function useQuickActionsPanel() {
  const [isOpen, setIsOpen] = useState(false)
  const [openedAt, setOpenedAt] = useState(0)
  const [searchSignal, setSearchSignal] = useState(0)
  const open = useCallback(() => {
    setOpenedAt(Date.now())
    setIsOpen((wasOpen) => {
      if (wasOpen) setSearchSignal((n) => n + 1)
      return true
    })
  }, [])
  const onClose = useCallback(() => setIsOpen(false), [])
  useEffect(() => window.electronAPI.quickActions?.onOpen?.(() => open()), [open])
  return { isOpen, open, host: { openedAt, searchSignal, onClose } }
}

type QuickActionsPanel = ReturnType<typeof useQuickActionsPanel>

/** The terminal whose note a shortcut asked to edit, set for one render. */
function useNoteEditing() {
  const [editNoteSessionId, setEditNoteSessionId] = useState<string | null>(null)
  const editNote = useCallback((sessionId: string | null) => {
    // Set then clear, so pressing the shortcut twice reopens the editor.
    setEditNoteSessionId(sessionId)
    queueMicrotask(() => setEditNoteSessionId(null))
  }, [])
  return { editNoteSessionId, editNote }
}

type NoteEditing = ReturnType<typeof useNoteEditing>
type TerminalLaunch = ReturnType<typeof useTerminalLaunch>

/** Opens Overview, or closes it when it is what is showing. */
function toggleOverview(): void {
  const registry = useExtensionRegistry.getState()
  registry.setActiveGlobalTab(
    registry.activeGlobalTabId === 'core.overview' ? null : 'core.overview'
  )
}

/** The active branch's terminal, the one a note shortcut edits. */
function activeSessionOfActiveBranch(): string | null {
  const { activeProjectId } = useWorkspaceStore.getState()
  if (!activeProjectId) return null
  return useSessionStore.getState().projectViews.get(activeProjectId)?.activeSessionId ?? null
}

interface ShortcutInput {
  windows: ShellWindows
  palette: QuickActionsPanel
  launch: TerminalLaunch
  note: NoteEditing
  scratchActive: boolean
}

function useShellShortcuts({ windows, palette, launch, note, scratchActive }: ShortcutInput) {
  useKeyboardShortcuts({
    onEditSessionNote: () => note.editNote(activeSessionOfActiveBranch()),
    onOpenSettings: windows.openSettings,
    onToggleLog: windows.toggleLog,
    onOpenCommandPalette: palette.open,
    onToggleOverview: toggleOverview,
    onOpenHome: () => useExtensionRegistry.getState().setActiveGlobalTab('core.home'),
    onNewScratch: launch.newScratch,
    onNewTab: launch.newTab,
    scratchProjectId: scratchActive ? SCRATCH_PROJECT_ID : null,
    onDirectShortcut: recordDirectShortcut,
  })
  useExtensionEscapeExit()
}

interface EffectsInput {
  windows: ShellWindows
  palette: QuickActionsPanel
  surfaces: ReturnType<typeof useSurfaces>
  showSurface: ReturnType<typeof useShowSurface>
}

/** Everything the shell keeps running: loading, syncing, and answering main and extensions. */
function useShellEffects({ windows, palette, surfaces, showSurface }: EffectsInput): void {
  const { openPanels, activeProjectTabId } = useExtensionRegistry(
    useShallow((s) => ({ openPanels: s.openPanels, activeProjectTabId: s.activeProjectTabId }))
  )
  useSelectionEffects()
  useInitialLoad()
  useBranchSyncTargets()
  useNotificationFeed()
  useAutoOpenTerminal(activeProjectTabId)
  useMenuEvents(windows)
  usePanelPersistence(openPanels)
  usePanelsAroundProjectTabs(openPanels, activeProjectTabId)
  useCoreTabs(palette.open)
  useBridgeEvents(surfaces, showSurface)
}

interface CommandsInput {
  windows: ShellWindows
  launch: TerminalLaunch
  note: NoteEditing
}

/** What the palette's core actions do that only the shell can. */
function useShellCommands({ windows, launch, note }: CommandsInput): ShellCommands {
  const { toggleSidebar, setLinkSessionId, openSettings, toggleLog } = windows
  const { newTab, newScratch } = launch
  return useMemo(
    () => ({
      onNewTab: newTab,
      onNewScratch: newScratch,
      onEditNote: note.editNote,
      onLinkSession: setLinkSessionId,
      onToggleOverview: toggleOverview,
      onToggleSidebar: toggleSidebar,
      onOpenSettings: openSettings,
      onToggleLog: toggleLog,
    }),
    [newTab, newScratch, note.editNote, setLinkSessionId, toggleSidebar, openSettings, toggleLog]
  )
}

/** App-level destinations in a stable order: core's first, then contributed ones, unless a
 * registration asked for a place of its own. */
function ShellBand({ onOpenQuickActions }: { onOpenQuickActions: () => void }): JSX.Element {
  const { globalTabs, activeGlobalTabId } = useExtensionRegistry(
    useShallow((s) => ({ globalTabs: s.globalTabs, activeGlobalTabId: s.activeGlobalTabId }))
  )
  const { unreadCount, togglePanel } = useNotificationStore(
    useShallow((s) => ({ unreadCount: s.unreadCount, togglePanel: s.togglePanel }))
  )
  const sorted = useMemo(() => {
    const weight = (t: { id: string; sortOrder?: number }) =>
      t.sortOrder !== undefined ? t.sortOrder : t.id.startsWith('core.') ? 0 : 1
    return Array.from(globalTabs.values()).sort((a, b) => weight(a) - weight(b))
  }, [globalTabs])
  return (
    <AppBand
      globalTabs={sorted}
      activeId={activeGlobalTabId}
      onSelect={(id) =>
        useExtensionRegistry.getState().setActiveGlobalTab(id === activeGlobalTabId ? null : id)
      }
      unreadNotifications={unreadCount}
      onBellClick={togglePanel}
      onOpenQuickActions={onOpenQuickActions}
    />
  )
}

interface ShellSidebarProps {
  visible: boolean
  scratchActive: boolean
  onNewScratch: () => void
}

/** The sidebar, wired to the registry's tabs and the scratch view. */
function ShellSidebar({ visible, scratchActive, onNewScratch }: ShellSidebarProps): JSX.Element {
  const activeWorkspaceTabId = useExtensionRegistry((s) => s.activeWorkspaceTabId)
  // No `sessions` here: they change every second while a terminal prints.
  const activeScratchSessionId = useSessionStore(
    (s) => s.projectViews.get(SCRATCH_PROJECT_ID)?.activeSessionId ?? null
  )
  return (
    <UnifiedSidebar
      activeWorkspaceTabId={activeWorkspaceTabId}
      onSelectWorkspaceTab={selectWorkspaceTab}
      onSelectProject={clearSurfaceTabs}
      onNewScratch={onNewScratch}
      activeScratchSessionId={scratchActive ? activeScratchSessionId : null}
      onSelectScratchSession={(sessionId) => revealSession(sessionId)}
      visible={visible}
    />
  )
}

/** Shows a repo's tab in that repo, or closes it when it is the one showing there already. */
function selectWorkspaceTab(workspaceId: string, tabId: string): void {
  const registry = useExtensionRegistry.getState()
  const { activeWorkspaceId, setActiveWorkspace } = useWorkspaceStore.getState()
  const isAlreadyActive =
    tabId === registry.activeWorkspaceTabId && workspaceId === activeWorkspaceId
  setActiveWorkspace(workspaceId)
  registry.setActiveWorkspaceTab(isAlreadyActive ? null : tabId)
}

/** Choosing a branch leaves whatever app, repo or branch tab was covering its terminal. */
function clearSurfaceTabs(): void {
  const registry = useExtensionRegistry.getState()
  if (registry.activeGlobalTabId) registry.setActiveGlobalTab(null)
  if (registry.activeWorkspaceTabId) registry.setActiveWorkspaceTab(null)
  if (registry.activeProjectTabId) registry.setActiveProjectTab(null)
}
