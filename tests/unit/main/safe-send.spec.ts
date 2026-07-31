import { describe, it, expect, vi } from 'vitest'
import type { BrowserWindow, WebContentsView } from 'electron'
import { sendToWindow, sendToView } from '../../../src/main/safe-send.js'

// A supervised run's PTY kept emitting after its window closed. The broadcast
// read `mainWindow.webContents` on a destroyed window, which throws, and the
// throw arrived inside a node-pty data event with nothing above it to catch —
// crashing the main process:
//
//   TypeError: Object has been destroyed
//     at broadcastToWindows … at EventEmitter2.fire … at ReadStream.<anonymous>

function makeWindow(opts: { destroyed: boolean; contentsDestroyed?: boolean }): {
  win: BrowserWindow
  send: ReturnType<typeof vi.fn>
} {
  const send = vi.fn()
  const webContents = {
    send,
    isDestroyed: () => opts.contentsDestroyed === true,
  }
  const win = {
    isDestroyed: () => opts.destroyed,
    // Reading this off a destroyed window is one of the accesses that throws.
    get webContents() {
      if (opts.destroyed) throw new TypeError('Object has been destroyed')
      return webContents
    },
  } as unknown as BrowserWindow
  return { win, send }
}

describe('sending to a window', () => {
  it('sends while the window is alive', () => {
    const { win, send } = makeWindow({ destroyed: false })
    sendToWindow(win, 'terminal:output', { sessionId: 'a', data: 'hi' })
    expect(send).toHaveBeenCalledWith('terminal:output', { sessionId: 'a', data: 'hi' })
  })

  it('drops the send once the window is destroyed, without throwing', () => {
    const { win, send } = makeWindow({ destroyed: true })
    expect(() => sendToWindow(win, 'terminal:output', {})).not.toThrow()
    expect(send).not.toHaveBeenCalled()
  })

  it('drops the send when only the webContents is destroyed', () => {
    // Electron tears the two down separately; a live window is no promise
    // that its contents are still there.
    const { win, send } = makeWindow({ destroyed: false, contentsDestroyed: true })
    sendToWindow(win, 'terminal:output', {})
    expect(send).not.toHaveBeenCalled()
  })

  it('is a no-op with no window at all', () => {
    expect(() => sendToWindow(null, 'terminal:output', {})).not.toThrow()
    expect(() => sendToWindow(undefined, 'terminal:output', {})).not.toThrow()
  })
})

describe('sending to an extension view', () => {
  function makeView(destroyed: boolean): { view: WebContentsView; send: ReturnType<typeof vi.fn> } {
    const send = vi.fn()
    const view = {
      webContents: { send, isDestroyed: () => destroyed },
    } as unknown as WebContentsView
    return { view, send }
  }

  it('sends while the view is alive', () => {
    const { view, send } = makeView(false)
    sendToView(view, 'speckit:changed', { n: 1 })
    expect(send).toHaveBeenCalledWith('speckit:changed', { n: 1 })
  })

  it('drops the send to a closed view', () => {
    const { view, send } = makeView(true)
    expect(() => sendToView(view, 'speckit:changed', {})).not.toThrow()
    expect(send).not.toHaveBeenCalled()
  })
})
