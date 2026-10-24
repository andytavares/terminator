import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron'
import { sessionIdOfFrameName } from '../shared/breakout.js'
import { windowOptions } from './background-mode.js'
import { sendToWindow } from './safe-send.js'

interface WindowOpenDetails {
  url: string
  frameName: string
  features: string
}

type BreakoutDecision = {
  action: 'allow'
  overrideBrowserWindowOptions: BrowserWindowConstructorOptions
}

const sessionByWindow = new Map<BrowserWindow, string>()

/** A `window.open` feature such as `width=900`, as a number; undefined when absent. */
function featureNumber(features: string, name: string): number | undefined {
  const match = new RegExp(`(?:^|,)\\s*${name}=(-?\\d+)`).exec(features)
  return match ? Number(match[1]) : undefined
}

/** Allows the main renderer's `window.open('about:blank', <breakout frame name>)`; any other
 * open returns null, so the caller keeps its deny-and-open-externally path. */
export function breakoutWindowOpen(details: WindowOpenDetails): BreakoutDecision | null {
  if (details.url !== 'about:blank' || !sessionIdOfFrameName(details.frameName)) return null
  return {
    action: 'allow',
    overrideBrowserWindowOptions: windowOptions({
      width: featureNumber(details.features, 'width'),
      height: featureNumber(details.features, 'height'),
      x: featureNumber(details.features, 'left'),
      y: featureNumber(details.features, 'top'),
      minWidth: 360,
      minHeight: 200,
      title: 'Terminal',
      backgroundColor: '#0c0c0f',
    }),
  }
}

/** The session a breakout window holds, or null for any other window. */
export function sessionOfWindow(win: BrowserWindow | null | undefined): string | null {
  return (win && sessionByWindow.get(win)) || null
}

/** Records each breakout window the main window opens, and tells the main window when one closes. */
export function watchBreakoutWindows(
  mainWindow: BrowserWindow,
  applyLinkHandling: (child: BrowserWindow) => void
): void {
  mainWindow.webContents.on('did-create-window', (child, { frameName }) => {
    const sessionId = sessionIdOfFrameName(frameName)
    if (!sessionId) return
    sessionByWindow.set(child, sessionId)
    applyLinkHandling(child)
    // Its page runs in the main window's renderer, so it cannot outlive that window.
    const closeChild = (): void => {
      if (!child.isDestroyed()) child.close()
    }
    mainWindow.once('closed', closeChild)
    child.on('closed', () => {
      if (!mainWindow.isDestroyed()) mainWindow.removeListener('closed', closeChild)
      sessionByWindow.delete(child)
      sendToWindow(mainWindow, 'breakout:closed', { sessionId })
    })
  })
}
