import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const app = { setActivationPolicy: vi.fn() }
const created: Array<{ width?: number; height?: number }> = []
class FakeBrowserWindow {
  size: number[]
  constructor(options: { width?: number; height?: number }) {
    created.push(options)
    // As macOS does: a window is created no larger than the screen's work area.
    this.size = [Math.min(options.width ?? 0, 1024), Math.min(options.height ?? 0, 674)]
  }
  setSize(width: number, height: number): void {
    this.size = [width, height]
  }
  getSize(): number[] {
    return this.size
  }
}
vi.mock('electron', () => ({ app, BrowserWindow: FakeBrowserWindow }))

const fakeWindow = () => ({ show: vi.fn(), focus: vi.fn() })

async function loadWith(value: string | undefined) {
  vi.resetModules()
  if (value === undefined) delete process.env.TERMINATOR_RUN_IN_BACKGROUND
  else process.env.TERMINATOR_RUN_IN_BACKGROUND = value
  return import('../../../src/main/background-mode')
}

const preload = { preload: '/preload.js', contextIsolation: true }

describe('a window created in the background', () => {
  afterEach(() => delete process.env.TERMINATOR_RUN_IN_BACKGROUND)

  it('creates windows hidden and still drawing, keeping their own preferences', async () => {
    const { newWindow } = await loadWith('1')
    newWindow({ width: 1280, webPreferences: preload })
    expect(created.at(-1)).toEqual({
      width: 1280,
      show: false,
      enableLargerThanScreen: true,
      webPreferences: { ...preload, backgroundThrottling: false },
    })
  })

  // macOS clamps a window to the screen's work area; a CI runner's screen is smaller than a
  // laptop's, so the same test laid out a different, narrower window there.
  it('keeps the size asked for whatever the screen', async () => {
    const { newWindow } = await loadWith('1')
    expect(newWindow({ width: 1280, height: 800 }).getSize()).toEqual([1280, 800])
    expect(created.at(-1)).toMatchObject({ enableLargerThanScreen: true, show: false })
  })
})

describe('running in the background, as the e2e harness asks', () => {
  beforeEach(() => app.setActivationPolicy.mockReset())
  afterEach(() => delete process.env.TERMINATOR_RUN_IN_BACKGROUND)

  it('never shows or focuses a window', async () => {
    const { revealWindow } = await loadWith('1')
    const win = fakeWindow()
    revealWindow(win)
    expect(win.show).not.toHaveBeenCalled()
    expect(win.focus).not.toHaveBeenCalled()
  })

  it('never focuses a window asked only to take focus', async () => {
    const { focusWindow } = await loadWith('1')
    const win = fakeWindow()
    focusWindow(win)
    expect(win.focus).not.toHaveBeenCalled()
  })

  it('keeps the app out of the Dock so it never becomes the active app', async () => {
    const { enterBackgroundMode } = await loadWith('1')
    enterBackgroundMode('darwin')
    expect(app.setActivationPolicy).toHaveBeenCalledWith('accessory')
  })
})

describe('running normally', () => {
  beforeEach(() => app.setActivationPolicy.mockReset())

  it('leaves window options as they are', async () => {
    const { newWindow } = await loadWith(undefined)
    newWindow({ width: 1280, webPreferences: preload })
    expect(created.at(-1)).toEqual({
      width: 1280,
      webPreferences: preload,
    })
  })

  it('shows and focuses a window it is asked to reveal', async () => {
    const { revealWindow } = await loadWith(undefined)
    const win = fakeWindow()
    revealWindow(win)
    expect(win.show).toHaveBeenCalledOnce()
    expect(win.focus).toHaveBeenCalledOnce()
  })

  it('focuses, without showing, a window asked only to take focus', async () => {
    const { focusWindow } = await loadWith(undefined)
    const win = fakeWindow()
    focusWindow(win)
    expect(win.focus).toHaveBeenCalledOnce()
    expect(win.show).not.toHaveBeenCalled()
  })

  it('stays in the Dock', async () => {
    const { enterBackgroundMode } = await loadWith('0')
    enterBackgroundMode('darwin')
    expect(app.setActivationPolicy).not.toHaveBeenCalled()
  })
})
