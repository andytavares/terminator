import { useEffect } from 'react'
import { SCRATCH_PROJECT_ID } from '../../shared/types/index'
import { useExtensionRegistry } from '../extensions/registry'
import { useWorkspaceStore } from '../stores/workspace.store'
import { useSessionStore } from '../stores/session.store'
import { isBrokenOut } from '../stores/breakout.store'
import { useSettingsStore } from '../stores/settings.store'
import { useLogStore } from '../stores/log.store'
import { useNotificationStore } from '../stores/notification.store'
import { useToastStore } from '../stores/toast.store'
import { isExtensionViewShown } from '../stores/shown-extension-views.store'
import { dispatchNotification } from '../lib/notifications'
import { recordDirectUse } from '../quick-actions/usage'
import { findSurface, type SurfaceRegistration } from '../quick-actions/surface-actions'
import { adoptTerminalSession } from '../terminal/session-controller'
import { revealSession } from '../terminal/navigate-to-session'
import { useTaskSwitcher } from '../components/task-switcher/task-switcher.store'
import { dockBack, toggleBreakout } from '../terminal/breakout'
import { switchLane } from '../terminal/switch-lane'

// What the main process tells the window: menu accelerators, notifications,
// and what extensions ask the shell to do.

/** Counts a use of a core shortcut, so the palette stops hinting at it once the operator knows
 * it. Writes only when the count changed. */
export function recordDirectShortcut(actionId: string): void {
  const current = useSettingsStore.getState().globalSettings?.quickActions?.directUse ?? []
  const directUse = recordDirectUse(current, actionId)
  if (directUse !== current) void useSettingsStore.getState().updateQuickActions({ directUse })
}

/** What the menu accelerators open or toggle. */
export interface MenuHandlers {
  openSettings: () => void
  openAbout: () => void
  toggleSidebar: () => void
}

/** Closes the active terminal of whatever is showing, scratch or the active branch. */
function closeActiveTab(): void {
  recordDirectShortcut('core.close-tab')
  const { scratchActive, activeProjectId } = useWorkspaceStore.getState()
  const projectId = scratchActive ? SCRATCH_PROJECT_ID : activeProjectId
  const sessionId = useSessionStore.getState().projectViews.get(projectId ?? '')?.activeSessionId
  // A tab in its own window is not on the main window's screen, so ⌘W there must not close it.
  if (projectId && sessionId && !isBrokenOut(sessionId)) {
    void useSessionStore.getState().closeSession(sessionId)
  }
}

type MenuEvents = typeof window.electronAPI.extensionEvents
type Unsubscribe = (() => void) | undefined

/** Wraps a menu action so it also counts as a direct use of that shortcut. */
function countedShortcut<Args extends unknown[]>(
  actionId: string,
  run: (...args: Args) => void
): (...args: Args) => void {
  return (...args) => {
    recordDirectShortcut(actionId)
    run(...args)
  }
}

/** The accelerators for the shell's own windows and tabs. */
function subscribeShellMenu(events: MenuEvents | undefined, handlers: MenuHandlers): Unsubscribe[] {
  return [
    events?.onMenuOpenSettings?.(countedShortcut('core.open-settings', handlers.openSettings)),
    events?.onMenuOpenAbout?.(handlers.openAbout),
    events?.onMenuToggleSidebar?.(countedShortcut('core.toggle-sidebar', handlers.toggleSidebar)),
    events?.onMenuCloseTab?.(closeTabOf),
  ]
}

/** Closes the terminal of the breakout window the accelerator was pressed in, else the active tab. */
function closeTabOf(sessionId: string | null): void {
  if (sessionId) void useSessionStore.getState().closeSession(sessionId)
  else closeActiveTab()
}

/** What happens in a terminal's own window: its accelerator, and the user closing it. */
function subscribeBreakout(events: MenuEvents | undefined): Unsubscribe[] {
  return [
    events?.onMenuToggleBreakout?.(countedShortcut('core.break-out', toggleBreakout)),
    window.electronAPI.breakout?.onClosed(dockBack),
  ]
}

/** The accelerators that switch what the registry shows: panels, branch tabs, Home. */
function subscribeSurfaceMenu(events: MenuEvents | undefined): Unsubscribe[] {
  const registry = useExtensionRegistry.getState
  return [
    events?.onTogglePanel?.((panelId) => registry().togglePanel(panelId)),
    events?.onSelectProjectTab?.((tabId) => registry().setActiveProjectTab(tabId)),
    // Home is a Window-menu accelerator (Cmd+Shift+H), not a renderer keydown.
    events?.onMenuOpenHome?.(
      countedShortcut('core.open-home', () => registry().setActiveGlobalTab('core.home'))
    ),
  ]
}

/** The accelerators that move between tasks and between the lanes of one. */
function subscribeTaskMenu(events: MenuEvents | undefined): Unsubscribe[] {
  return [
    events?.onMenuOpenTaskSwitcher?.(
      countedShortcut('core.switch-task', () => useTaskSwitcher.getState().show())
    ),
    events?.onMenuSwitchLane?.(switchLane),
  ]
}

/** Subscribes to every menu accelerator main sends; a window without them (the remote) has none. */
export function useMenuEvents(handlers: MenuHandlers): void {
  const { openSettings, openAbout, toggleSidebar } = handlers
  useEffect(() => {
    const events = window.electronAPI.extensionEvents
    const unsubscribers = [
      ...subscribeShellMenu(events, { openSettings, openAbout, toggleSidebar }),
      ...subscribeSurfaceMenu(events),
      ...subscribeTaskMenu(events),
      ...subscribeBreakout(events),
    ]
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe?.())
  }, [openSettings, openAbout, toggleSidebar])
}

/** The notifications main already holds for the centre, then each one it pushes. */
export function useNotificationFeed(): void {
  useEffect(() => {
    const { addNotification } = useNotificationStore.getState()
    void window.electronAPI.notifications?.list().then((notifications) => {
      for (const n of notifications) if (n.targets?.includes('center')) addNotification(n)
    })
    return window.electronAPI.notifications?.onPush((n) => {
      if (n.targets.includes('center')) addNotification(n)
      // An extension whose view is on screen draws its own: the core's would sit under the view.
      if (n.targets.includes('toast') && !isExtensionViewShown(n.source)) {
        const message = n.message ? `${n.title}: ${n.message}` : n.title
        useToastStore.getState().addToast({ type: n.type, message })
      }
    })
  }, [])
}

type BridgeHandlers = Record<string, (data: unknown) => void>

/** What an extension's backend can ask of the window, by bridge channel. */
function bridgeHandlers(
  showSurface: (surface: SurfaceRegistration) => void,
  surfaces: SurfaceRegistration[]
): BridgeHandlers {
  return {
    ...surfaceHandlers(showSurface, surfaces),
    ...terminalBridgeHandlers(),
    ...logHandlers(),
  }
}

/** Showing an extension's app-level tab or one of its surfaces. */
function surfaceHandlers(
  showSurface: (surface: SurfaceRegistration) => void,
  surfaces: SurfaceRegistration[]
): BridgeHandlers {
  return {
    'extension:activate-global-tab': (tabId) => {
      if (typeof tabId === 'string') useExtensionRegistry.getState().setActiveGlobalTab(tabId)
    },
    'extension:show-surface': (data) => {
      const { extensionId, view } = data as { extensionId: string; view: string }
      const surface = findSurface(surfaces, extensionId, view)
      if (surface) showSurface(surface)
    },
    'extension:focus-view': (data) => {
      const { extensionId, viewParam } = data as { extensionId: string; viewParam: string }
      focusExtensionFrame(extensionId, viewParam)
    },
  }
}

/** Gives the keyboard to an extension's frame, as `api.window.focusSelf` asks. */
function focusExtensionFrame(extensionId: string, viewParam: string): void {
  const panel = document.querySelector(
    `[data-extension-panel="${extensionId}"][data-view-param="${viewParam}"]`
  )
  panel?.querySelector('iframe')?.focus()
}

/** Terminals an extension opens, closes or brings into view. */
function terminalBridgeHandlers(): BridgeHandlers {
  return {
    // A terminal an extension opened. The renderer owns the tab list, so without adopting it the
    // process runs and nothing on screen ever shows it, and its output is held until the tab is
    // mounted rather than delivered to nobody.
    'terminal:adopt': (data) => {
      const { sessionId, projectId, tabTitle, scrollbackLimit } = data as {
        sessionId: string
        projectId: string
        tabTitle: string
        scrollbackLimit: number
      }
      adoptTerminalSession({ sessionId, projectId, tabTitle, scrollbackLimit })
    },
    'terminal:close-tab': (data) =>
      void useSessionStore.getState().closeSession((data as { sessionId: string }).sessionId),
    'terminal:navigate-to-session': (data) =>
      revealSession((data as { sessionId: string }).sessionId),
  }
}

/** Log lines and the remote tunnel dropping. */
function logHandlers(): BridgeHandlers {
  return {
    'log:push': (data) => {
      const { level, message } = data as { level: 'info' | 'warn' | 'error'; message: string }
      useLogStore.getState().addEntry(level, message)
    },
    'remote:tunnel-disconnected': () =>
      dispatchNotification({
        type: 'error',
        title: 'Remote tunnel disconnected',
        message: 'ngrok tunnel disconnected. Click Reconnect in Settings to restore it.',
        key: 'remoteTunnelDisconnected',
      }),
  }
}

/** Listens on every bridge channel the shell answers. */
export function useBridgeEvents(
  surfaces: SurfaceRegistration[],
  showSurface: (surface: SurfaceRegistration) => void
): void {
  useEffect(() => {
    const handlers = bridgeHandlers(showSurface, surfaces)
    const unsubscribers = Object.entries(handlers).map(([channel, handler]) =>
      window.electronAPI.extensionBridge.on(channel, handler)
    )
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
  }, [surfaces, showSurface])
}
