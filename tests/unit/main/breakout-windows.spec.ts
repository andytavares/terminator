import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'

vi.mock('electron', () => ({ app: {}, BrowserWindow: class {} }))

import {
  breakoutWindowOpen,
  sessionOfWindow,
  watchBreakoutWindows,
} from '../../../src/main/breakout-windows'
import { breakoutFrameName } from '../../../src/shared/breakout'

const SESSION = '3f2c1a9e-5b7d-4e8a-9c01-2d4f6a8b0c1e'

const open = (overrides: Partial<{ url: string; frameName: string; features: string }> = {}) =>
  breakoutWindowOpen({
    url: 'about:blank',
    frameName: breakoutFrameName(SESSION),
    features: 'width=900,height=600,left=40,top=50',
    ...overrides,
  })

describe('breakoutWindowOpen', () => {
  it('allows about:blank with a breakout frame name, sized and placed from the features', () => {
    expect(open()).toMatchObject({
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: 900,
        height: 600,
        x: 40,
        y: 50,
        minWidth: 360,
        minHeight: 200,
        backgroundColor: '#0c0c0f',
      },
    })
  })

  it('leaves size and position to the OS when the features omit them', () => {
    const decision = open({ features: '' })
    expect(decision?.overrideBrowserWindowOptions.width).toBeUndefined()
    expect(decision?.overrideBrowserWindowOptions.x).toBeUndefined()
  })

  it('does not override the renderer process settings of the opener', () => {
    expect(open()?.overrideBrowserWindowOptions.webPreferences).toBeUndefined()
  })
})

describe('breakoutWindowOpen for anything else', () => {
  it('returns null for an http url, even with a breakout frame name', () => {
    expect(open({ url: 'https://example.com' })).toBeNull()
  })

  it('returns null for a malformed or foreign frame name', () => {
    expect(open({ frameName: 'terminator-session:not-a-uuid' })).toBeNull()
    expect(open({ frameName: '' })).toBeNull()
  })
})

function fakeMain() {
  const webContents = Object.assign(new EventEmitter(), { send: vi.fn(), isDestroyed: () => false })
  return { webContents, isDestroyed: () => false } as never as Electron.BrowserWindow & {
    webContents: EventEmitter & { send: ReturnType<typeof vi.fn> }
  }
}

function watched() {
  const main = fakeMain()
  const child = new EventEmitter()
  const applyLinkHandling = vi.fn()
  watchBreakoutWindows(main, applyLinkHandling)
  const created = (frameName: string) =>
    main.webContents.emit('did-create-window', child, { frameName })
  return { main, child, applyLinkHandling, created }
}

describe('watchBreakoutWindows', () => {
  it('records the session of a breakout window and applies link handling to it', () => {
    const { child, applyLinkHandling, created } = watched()
    created(breakoutFrameName(SESSION))
    expect(sessionOfWindow(child as never)).toBe(SESSION)
    expect(applyLinkHandling).toHaveBeenCalledWith(child)
  })

  it('ignores a child window that is not a breakout', () => {
    const { child, applyLinkHandling, created } = watched()
    created('other')
    expect(sessionOfWindow(child as never)).toBeNull()
    expect(applyLinkHandling).not.toHaveBeenCalled()
  })

  it('tells the main window which session closed, and forgets the window', () => {
    const { main, child, created } = watched()
    created(breakoutFrameName(SESSION))
    child.emit('closed')
    expect(main.webContents.send).toHaveBeenCalledWith('breakout:closed', { sessionId: SESSION })
    expect(sessionOfWindow(child as never)).toBeNull()
  })
})

describe('sessionOfWindow', () => {
  it('has no session for the main window or for none', () => {
    expect(sessionOfWindow(watched().main)).toBeNull()
    expect(sessionOfWindow(null)).toBeNull()
  })
})
