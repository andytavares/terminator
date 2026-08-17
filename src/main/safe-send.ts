import type { BrowserWindow, WebContentsView } from 'electron'

// Sending to a receiver that is already gone.
//
// A PTY outlives the window that opened it. Output arriving after the window
// or the extension view has closed reaches a destroyed `webContents`, and
// every property access on a destroyed Electron object throws
// `TypeError: Object has been destroyed` — from inside a node-pty data event,
// where nothing catches it, so it takes the main process down.
//
// A closed window is a normal thing for a live PTY to run into, not an error:
// the send is dropped and the process stays up.
//
// The window is checked before its `webContents` is read, because reading the
// property off a destroyed window is itself one of the throwing accesses.

export function sendToWindow(
  win: BrowserWindow | null | undefined,
  channel: string,
  data: unknown
): void {
  if (!win || win.isDestroyed()) return
  if (win.webContents.isDestroyed()) return
  win.webContents.send(channel, data)
}

export function sendToView(view: WebContentsView, channel: string, data: unknown): void {
  if (view.webContents.isDestroyed()) return
  view.webContents.send(channel, data)
}
