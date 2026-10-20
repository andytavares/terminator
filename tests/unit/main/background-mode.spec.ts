import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const app = { setActivationPolicy: vi.fn() }
vi.mock('electron', () => ({ app }))

const fakeWindow = () => ({ show: vi.fn(), focus: vi.fn() })

/** A window that records what it is asked to do once it is ready to show. */
function readyWindow() {
  const handlers: Array<() => void> = []
  return {
    showInactive: vi.fn(),
    once: vi.fn((_event: 'ready-to-show', handler: () => void) => void handlers.push(handler)),
    becomeReady: () => handlers.forEach((handler) => handler()),
  }
}

async function loadWith(value: string | undefined) {
  vi.resetModules()
  if (value === undefined) delete process.env.TERMINATOR_RUN_IN_BACKGROUND
  else process.env.TERMINATOR_RUN_IN_BACKGROUND = value
  return import('../../../src/main/background-mode')
}

const preload = { preload: '/preload.js', contextIsolation: true }

describe('running in the background, as the e2e harness asks', () => {
  beforeEach(() => app.setActivationPolicy.mockReset())
  afterEach(() => delete process.env.TERMINATOR_RUN_IN_BACKGROUND)

  it('creates windows hidden and still drawing, keeping their own preferences', async () => {
    const { windowOptions } = await loadWith('1')
    expect(windowOptions({ width: 1280, webPreferences: preload })).toEqual({
      width: 1280,
      show: false,
      webPreferences: { ...preload, backgroundThrottling: false },
    })
  })

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
})

describe('a new window, running in the background', () => {
  beforeEach(() => app.setActivationPolicy.mockReset())
  afterEach(() => delete process.env.TERMINATOR_RUN_IN_BACKGROUND)

  it('shows a window without focus on Linux, whose unshown windows cannot be clicked', async () => {
    const { presentWindow } = await loadWith('1')
    const win = readyWindow()
    presentWindow(win, 'linux')
    win.becomeReady()
    expect(win.showInactive).toHaveBeenCalledOnce()
  })

  it('keeps a window hidden on macOS, where a hidden window still draws', async () => {
    const { presentWindow } = await loadWith('1')
    const win = readyWindow()
    presentWindow(win, 'darwin')
    win.becomeReady()
    expect(win.showInactive).not.toHaveBeenCalled()
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
    const { windowOptions } = await loadWith(undefined)
    expect(windowOptions({ width: 1280, webPreferences: preload })).toEqual({
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

  it('leaves a window to show itself', async () => {
    const { presentWindow } = await loadWith(undefined)
    const win = readyWindow()
    presentWindow(win, 'linux')
    expect(win.once).not.toHaveBeenCalled()
  })
})

describe('running normally, the Dock', () => {
  beforeEach(() => app.setActivationPolicy.mockReset())

  it('stays in the Dock', async () => {
    const { enterBackgroundMode } = await loadWith('0')
    enterBackgroundMode('darwin')
    expect(app.setActivationPolicy).not.toHaveBeenCalled()
  })
})
