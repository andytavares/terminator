import { breakoutFrameName } from '../../shared/breakout'
import { isBrokenOut, useBreakoutStore } from '../stores/breakout.store'
import { useSessionStore } from '../stores/session.store'
import { focusedTerminalSessionId } from '../lib/focus-terminal'
import { dispatchNotification } from '../lib/notifications'
import { revealSession } from './navigate-to-session'

// A terminal in its own window: a window.open child of the main one, its body drawn by the
// BreakoutWindows component. This is where one is opened, docked and cleaned up.

const FALLBACK_SIZE = { width: 800, height: 500 }
const OFFSET_FROM_MAIN_WINDOW = 40
const STYLE_SELECTOR = 'link[rel="stylesheet"], style'

/** Stops a window's following of the main document, by session id. */
const stopFollowing = new Map<string, () => void>()

function terminalSize(sessionId: string): { width: number; height: number } {
  const element = useSessionStore.getState().getTerminalInstance(sessionId)?.element
  const width = element?.offsetWidth ?? 0
  const height = element?.offsetHeight ?? 0
  return width > 0 && height > 0 ? { width, height } : FALLBACK_SIZE
}

function windowFeatures(sessionId: string, at?: { x: number; y: number }): string {
  const { width, height } = terminalSize(sessionId)
  const x = at?.x ?? window.screenX + OFFSET_FROM_MAIN_WINDOW
  const y = at?.y ?? window.screenY + OFFSET_FROM_MAIN_WINDOW
  return `width=${width},height=${height},left=${x},top=${y}`
}

function copyStylesTo(child: Window, nodes: Iterable<Node>): void {
  for (const node of nodes) {
    if (node instanceof Element && node.matches(STYLE_SELECTOR)) {
      child.document.head.appendChild(child.document.importNode(node, true))
    }
  }
}

function copyTheme(child: Window): void {
  const { theme } = document.documentElement.dataset
  if (theme === undefined) delete child.document.documentElement.dataset.theme
  else child.document.documentElement.dataset.theme = theme
}

/** Gives the window the main document's styles and theme, and keeps them in step until stopped. */
function followMainDocument(child: Window): () => void {
  copyStylesTo(child, document.head.children)
  copyTheme(child)
  const headWatcher = new MutationObserver((records) =>
    records.forEach((record) => copyStylesTo(child, record.addedNodes))
  )
  headWatcher.observe(document.head, { childList: true })
  const themeWatcher = new MutationObserver(() => copyTheme(child))
  themeWatcher.observe(document.documentElement, { attributeFilter: ['data-theme'] })
  return () => {
    headWatcher.disconnect()
    themeWatcher.disconnect()
  }
}

/** Takes the session out of any split and hands the main pane the project's next tab. */
function releaseFromMainPane(projectId: string, sessionId: string): void {
  const store = useSessionStore.getState()
  store.closeSplitLeaf(projectId, sessionId)
  const next = store
    .getSessionsForProject(projectId)
    .find((s) => s.id !== sessionId && !isBrokenOut(s.id))
  if (next) store.setActiveSessionForProject(projectId, next.id)
}

function reportBlockedWindow(sessionId: string): void {
  dispatchNotification({
    type: 'error',
    title: 'Terminator',
    message: 'This terminal could not open its own window, so it stays where it is.',
    key: 'breakoutBlocked',
    sessionId,
  })
}

/** Moves a terminal into a window of its own; does nothing if it already is in one. */
export function breakOut(sessionId: string, at?: { x: number; y: number }): void {
  const session = useSessionStore.getState().sessions.get(sessionId)
  if (!session || isBrokenOut(sessionId)) return
  const child = window.open(
    'about:blank',
    breakoutFrameName(sessionId),
    windowFeatures(sessionId, at)
  )
  if (!child) return reportBlockedWindow(sessionId)
  releaseFromMainPane(session.projectId, sessionId)
  child.document.title = session.tabTitle
  stopFollowing.set(sessionId, followMainDocument(child))
  useBreakoutStore.getState().add(sessionId, child)
}

/** Closes the window, forgets it, and shows the terminal back among its tabs. */
export function dockBack(sessionId: string): void {
  const child = useBreakoutStore.getState().windows.get(sessionId)
  if (!child) return
  stopFollowing.get(sessionId)?.()
  stopFollowing.delete(sessionId)
  useBreakoutStore.getState().remove(sessionId)
  if (!child.closed) child.close()
  if (useSessionStore.getState().sessions.has(sessionId)) revealSession(sessionId)
}

/** A session that is gone has no window to dock into: closes the window and forgets it. */
function dropWindowsOfEndedSessions(): void {
  const { sessions } = useSessionStore.getState()
  for (const sessionId of useBreakoutStore.getState().windows.keys()) {
    if (!sessions.has(sessionId)) dockBack(sessionId)
  }
}

useSessionStore.subscribe(dropWindowsOfEndedSessions)

/** Docks the given session, or with none moves the focused terminal into its own window. */
export function toggleBreakout(sessionId: string | null): void {
  if (sessionId !== null) return dockBack(sessionId)
  const focused = focusedTerminalSessionId()
  if (focused) breakOut(focused)
}
