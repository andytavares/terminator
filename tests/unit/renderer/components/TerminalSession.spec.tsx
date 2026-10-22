import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Terminal, type IBuffer, type IBufferNamespace, type IBufferLine } from '@xterm/xterm'
import {
  TerminalInstance,
  XTERM_THEMES,
} from '../../../../src/renderer/components/terminal/TerminalSession'
import { MAX_WEBGL_CONTEXTS } from '../../../../src/renderer/terminal/webgl-contexts'
import { installElectronApi } from '../../../support/electron-api'
import { partialFake } from '../../../support/fakes'

const mockResizeObserver = vi.fn().mockImplementation(function () {
  return {
    observe: vi.fn(),
    disconnect: vi.fn(),
  }
})
vi.stubGlobal('ResizeObserver', mockResizeObserver)

// Mock xterm and its addons
/** An 80 by 24 buffer whose every line reads `lineText`. */
function makeMockBuffer(lineText = '', viewportY = 0) {
  const rows = 24
  const cols = 80
  return {
    active: {
      getLine: (_row: number) => ({
        translateToString: () => lineText,
      }),
      viewportY,
    },
    cols,
    rows,
  }
}

const mockRenderDispose = vi.fn()

vi.mock('@xterm/xterm', () => {
  const Terminal = vi.fn().mockImplementation(function () {
    return {
      loadAddon: vi.fn(),
      attachCustomKeyEventHandler: vi.fn(),
      onData: vi.fn(),
      onResize: vi.fn(),
      onBell: vi.fn(),
      open: vi.fn(),
      focus: vi.fn(),
      write: vi.fn(),
      paste: vi.fn(),
      dispose: vi.fn(),
      scrollToBottom: vi.fn(),
      scrollLines: vi.fn(),
      getSelection: vi.fn().mockReturnValue(''),
      registerLinkProvider: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onRender: vi.fn().mockReturnValue({ dispose: mockRenderDispose }),
      buffer: makeMockBuffer(),
      options: { theme: null as unknown },
    }
  })
  return { Terminal }
})

vi.mock('@xterm/addon-fit', () => {
  const FitAddon = vi.fn().mockImplementation(function () {
    return {
      fit: vi.fn(),
    }
  })
  return { FitAddon }
})

const webglAddons = vi.hoisted(() => [] as { dispose: () => void; loseContext: () => void }[])
vi.mock('@xterm/addon-webgl', () => {
  const WebglAddon = vi.fn().mockImplementation(function () {
    let onLoss: () => void = () => {}
    const addon = {
      onContextLoss: (listener: () => void) => {
        onLoss = listener
        return { dispose: vi.fn() }
      },
      dispose: vi.fn(),
      loseContext: () => onLoss(),
    }
    webglAddons.push(addon)
    return addon
  })
  return { WebglAddon }
})

// Each test gets an empty context budget, so terminals other tests leave mounted
// do not use up the contexts these tests count.
const budgetHolder = vi.hoisted(() => ({ current: null as unknown }))
vi.mock('../../../../src/renderer/terminal/webgl-contexts', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../../src/renderer/terminal/webgl-contexts')>()
  budgetHolder.current = new actual.WebglContextBudget(actual.MAX_WEBGL_CONTEXTS)
  return {
    ...actual,
    get webglContexts() {
      return budgetHolder.current
    },
  }
})

vi.mock('../../../../src/renderer/terminal/output-router', () => ({
  subscribeToSessionOutput: (
    sessionId: string,
    handler: (data: string, written: () => void) => void
  ) => mockSubscribe(sessionId, handler),
}))

vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

// TerminalInstance is a pure view object: busy/idle/bell reach the outside
// world only through the constructor hooks (wired by the session controller).
const mockSetSessionBusy = vi.fn()
const mockSetSessionIdle = vi.fn()
const ACTIVITY_HOOKS = { onBusy: () => mockSetSessionBusy(), onIdle: () => mockSetSessionIdle() }

// Mock canvas getContext so character-width measurement works under jsdom
const mockMeasureText = vi.fn(() => partialFake<TextMetrics>({ width: 8 }))
const mockFakeCtx = partialFake<CanvasRenderingContext2D>({
  font: '',
  fillStyle: '',
  measureText: mockMeasureText,
})
vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => mockFakeCtx)

const mockSubscribe = vi.fn()
const mockAttach = vi.fn()
const mockInput = vi.fn()
const mockResize = vi.fn()
const mockUnsubscribe = vi.fn()
const mockOpenExternal = vi.fn().mockResolvedValue({ ok: true })
const mockOpenPath = vi.fn().mockResolvedValue({ ok: true })

// Default to macOS so metaKey-based tests work; override per test as needed.
let mockPlatform = 'MacIntel'
Object.defineProperty(navigator, 'platform', { get: () => mockPlatform, configurable: true })

beforeEach(async () => {
  const { WebglContextBudget, MAX_WEBGL_CONTEXTS } = await import(
    '../../../../src/renderer/terminal/webgl-contexts'
  )
  budgetHolder.current = new WebglContextBudget(MAX_WEBGL_CONTEXTS)
  mockPlatform = 'MacIntel'
  vi.clearAllMocks()
  mockSubscribe.mockReturnValue(mockUnsubscribe)
  mockAttach.mockResolvedValue({ released: false })
  mockOpenExternal.mockResolvedValue({ ok: true })
  mockOpenPath.mockResolvedValue({ ok: true })
  installElectronApi({
    terminal: {
      input: mockInput,
      resize: mockResize,
      attach: mockAttach,
    },
    shell: {
      openExternal: mockOpenExternal,
      openPath: mockOpenPath,
    },
  })
})

/** Puts a screen of `rows` rows from `buffer` behind the instance's (faked) xterm. */
function showScreen(instance: TerminalInstance, rows: number, buffer: Partial<IBuffer>): void {
  Object.defineProperty(instance.terminal, 'rows', { value: rows })
  Object.defineProperty(instance.terminal, 'buffer', {
    value: partialFake<IBufferNamespace>({ active: partialFake<IBuffer>(buffer) }),
  })
}

// Returning false tells xterm not to handle the key, so it is neither sent
// to the shell nor stopped from reaching the app's own shortcut listener.
function leaderReachesTheApp(key: Partial<KeyboardEvent>): boolean {
  new TerminalInstance('ses-1', 1000)
  const instance = vi.mocked(Terminal).mock.results[0].value
  const handler = instance.attachCustomKeyEventHandler.mock.calls[0][0]
  const pressed = { metaKey: false, ctrlKey: false, shiftKey: false, altKey: false }
  return handler({ ...pressed, type: 'keydown', key: 'p', ...key }) === false
}

describe('TerminalInstance', () => {
  it('pastes \\n when Cmd+Enter is pressed via custom key handler', () => {
    new TerminalInstance('ses-1', 1000)
    const instance = vi.mocked(Terminal).mock.results[0].value
    const handler = instance.attachCustomKeyEventHandler.mock.calls[0][0]
    const mockPreventDefault = vi.fn()
    const result = handler({
      metaKey: true,
      ctrlKey: false,
      key: 'Enter',
      type: 'keydown',
      preventDefault: mockPreventDefault,
    })
    expect(result).toBe(false)
    expect(instance.paste).toHaveBeenCalledWith('\n')
    expect(mockPreventDefault).toHaveBeenCalled()
  })

  it('does not intercept non-Cmd+Enter keys', () => {
    new TerminalInstance('ses-1', 1000)
    const instance = vi.mocked(Terminal).mock.results[0].value
    const handler = instance.attachCustomKeyEventHandler.mock.calls[0][0]
    const result = handler({ metaKey: false, ctrlKey: false, key: 'Enter', type: 'keydown' })
    expect(result).toBe(true)
  })
})

describe('TerminalInstance — forwards keystrokes to the PTY via onData', () => {
  it('forwards keystrokes to the PTY via onData', () => {
    new TerminalInstance('ses-data', 1000)
    const instance = vi.mocked(Terminal).mock.results[0].value
    const onData = instance.onData.mock.calls[0][0]
    onData('ls\r')
    expect(mockInput).toHaveBeenCalledWith('ses-data', 'ls\r')
  })

  it('forwards terminal resize to the PTY via onResize', () => {
    new TerminalInstance('ses-resize', 1000)
    const instance = vi.mocked(Terminal).mock.results[0].value
    const onResize = instance.onResize.mock.calls[0][0]
    onResize({ cols: 120, rows: 40 })
    expect(mockResize).toHaveBeenCalledWith('ses-resize', 120, 40)
  })

  it('re-pins the viewport to the bottom when mounted (reattach follows output)', () => {
    const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
      ;(cb as FrameRequestCallback)(0)
      return 0
    })
    const inst = new TerminalInstance('ses-mount', 1000)
    const term = vi.mocked(Terminal).mock.results[0].value
    inst.mount(document.createElement('div'))
    // Nudge then pin to bottom so xterm re-syncs the DOM viewport after reattach.
    expect(term.scrollLines).toHaveBeenCalledWith(-1)
    expect(term.scrollToBottom).toHaveBeenCalled()
    rafSpy.mockRestore()
  })
})

describe('TerminalInstance — pastes \\n when Shift+Enter is pressed', () => {
  it('pastes \\n when Shift+Enter is pressed', () => {
    new TerminalInstance('ses-1', 1000)
    const instance = vi.mocked(Terminal).mock.results[0].value
    const handler = instance.attachCustomKeyEventHandler.mock.calls[0][0]
    const mockPreventDefault = vi.fn()
    const result = handler({
      shiftKey: true,
      metaKey: false,
      ctrlKey: false,
      key: 'Enter',
      type: 'keydown',
      preventDefault: mockPreventDefault,
    })
    expect(result).toBe(false)
    expect(instance.paste).toHaveBeenCalledWith('\n')
    expect(mockPreventDefault).toHaveBeenCalled()
  })
})

describe('TerminalInstance — does not intercept plain Enter without modifiers', () => {
  it('does not intercept plain Enter without modifiers', () => {
    new TerminalInstance('ses-1', 1000)
    const instance = vi.mocked(Terminal).mock.results[0].value
    const handler = instance.attachCustomKeyEventHandler.mock.calls[0][0]
    const result = handler({
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      key: 'Enter',
      type: 'keydown',
    })
    expect(result).toBe(true)
    expect(instance.paste).not.toHaveBeenCalled()
  })

  it('leaves Ctrl+P to the app on Linux, where it opens Quick actions', () => {
    mockPlatform = 'Linux x86_64'
    expect(leaderReachesTheApp({ ctrlKey: true })).toBe(true)
  })

  it('leaves ⌘P to the app on macOS', () => {
    expect(leaderReachesTheApp({ metaKey: true })).toBe(true)
  })

  it('sends Ctrl+P to the shell on macOS, where the leader is ⌘P', () => {
    expect(leaderReachesTheApp({ ctrlKey: true })).toBe(false)
  })
})

describe('TerminalInstance — sends Ctrl+Shift+P to the shell on Linux', () => {
  it('sends Ctrl+Shift+P to the shell on Linux', () => {
    mockPlatform = 'Linux x86_64'
    expect(leaderReachesTheApp({ ctrlKey: true, shiftKey: true, key: 'P' })).toBe(false)
  })

  it('subscribes to its own session output on construction', () => {
    new TerminalInstance('ses-1', 1000)
    expect(mockSubscribe).toHaveBeenCalledTimes(1)
    expect(mockSubscribe).toHaveBeenCalledWith('ses-1', expect.any(Function))
  })

  it('writes the output it receives to the terminal', () => {
    const instance = new TerminalInstance('ses-write', 1000)
    const receive = mockSubscribe.mock.calls[0][1]
    receive('hello', vi.fn())
    expect(instance.terminal.write).toHaveBeenCalledWith('hello', expect.any(Function))
  })

  it('says the output is written once xterm has taken it', () => {
    const instance = new TerminalInstance('ses-written', 1000)
    const written = vi.fn()
    const receive = mockSubscribe.mock.calls[0][1]
    receive('hello', written)

    expect(written).not.toHaveBeenCalled()
    const xtermDone = vi.mocked(instance.terminal.write).mock.calls[0][1] as () => void
    xtermDone()
    expect(written).toHaveBeenCalledTimes(1)
  })
})

describe('TerminalInstance — reads the visible screen as one string per row, trailing spaces trimmed', () => {
  it('reads the visible screen as one string per row, trailing spaces trimmed', () => {
    const instance = new TerminalInstance('ses-1', 1000)
    const translate = vi.fn((trimRight?: boolean) => (trimRight ? 'row' : 'row   '))
    const getLine = vi.fn((_line: number) =>
      partialFake<IBufferLine>({ translateToString: translate })
    )
    showScreen(instance, 3, { viewportY: 40, getLine })
    expect(instance.readVisibleRows()).toEqual(['row', 'row', 'row'])
    expect(getLine.mock.calls.map((c) => c[0])).toEqual([40, 41, 42])
  })

  it("reports the cursor's row on screen", () => {
    const instance = new TerminalInstance('ses-1', 1000)
    Object.assign(instance.terminal.buffer.active, { cursorY: 7 })
    expect(instance.cursorRow()).toBe(7)
  })

  it('reads a missing buffer line as an empty row', () => {
    const instance = new TerminalInstance('ses-1', 1000)
    showScreen(instance, 2, { viewportY: 0, getLine: () => undefined })
    expect(instance.readVisibleRows()).toEqual(['', ''])
  })

  it('creates a div element on construction', () => {
    const instance = new TerminalInstance('ses-1', 1000)
    expect(instance.element).toBeInstanceOf(HTMLDivElement)
    expect(instance.element.style.cssText).toContain('width')
  })
})

describe('TerminalInstance — returns the xterm selection', () => {
  it('returns the xterm selection', () => {
    const instance = new TerminalInstance('ses-1', 1000)
    const mockTerminal = vi.mocked(Terminal).mock.results[0].value
    mockTerminal.getSelection.mockReturnValue('selected text')
    expect(instance.getSelection()).toBe('selected text')
  })

  it('accepts an optional onBell hook', () => {
    const onBell = vi.fn()
    const instance = new TerminalInstance('ses-1', 1000, { onBell })
    expect(instance.terminal.onBell).toHaveBeenCalledWith(onBell)
  })
})

describe('TerminalInstance — mount()', () => {
  it('appends element to container and opens terminal', () => {
    const instance = new TerminalInstance('ses-1', 1000)
    const container = document.createElement('div')
    document.body.appendChild(container)
    instance.mount(container)
    expect(container.contains(instance.element)).toBe(true)
    expect(instance.terminal.open).toHaveBeenCalledWith(instance.element)
    expect(instance.terminal.focus).toHaveBeenCalled()
    document.body.removeChild(container)
  })

  it('does not re-open terminal on second mount', () => {
    const instance = new TerminalInstance('ses-1', 1000)
    const container = document.createElement('div')
    document.body.appendChild(container)
    instance.mount(container)
    instance.unmount()
    instance.mount(container)
    expect(instance.terminal.open).toHaveBeenCalledTimes(1)
    document.body.removeChild(container)
  })
})

function mounted(sessionId: string): TerminalInstance {
  const instance = new TerminalInstance(sessionId, 1000)
  instance.mount(document.createElement('div'))
  return instance
}

/** The hooks every "TerminalInstance — WebGL renderer" describe registers. */
function setUpTerminalInstanceWebGLRenderer(): void {
  beforeEach(() => {
    webglAddons.length = 0
  })
}

describe('TerminalInstance — WebGL renderer', () => {
  setUpTerminalInstanceWebGLRenderer()

  it('loads the WebGL renderer into a terminal that becomes visible', () => {
    const instance = mounted('webgl-visible')
    const terminal = vi.mocked(Terminal).mock.results.at(-1)!.value
    expect(webglAddons).toHaveLength(1)
    expect(terminal.loadAddon).toHaveBeenCalledWith(webglAddons[0])
    instance.unmount()
  })

  it('releases the WebGL context when the terminal is hidden', () => {
    const instance = mounted('webgl-hidden')
    instance.unmount()
    expect(webglAddons[0].dispose).toHaveBeenCalled()
  })

  it('hands the context back so the same terminal gets one again when shown', () => {
    const instance = mounted('webgl-reshown')
    instance.unmount()
    instance.mount(document.createElement('div'))
    expect(webglAddons).toHaveLength(2)
    instance.unmount()
  })
})

describe('TerminalInstance — WebGL renderer — uses the DOM renderer for a terminal shown as a preview tile', () => {
  setUpTerminalInstanceWebGLRenderer()

  it('uses the DOM renderer for a terminal shown as a preview tile', () => {
    const instance = mounted('webgl-tile')
    Object.defineProperty(instance.terminal, 'cols', { value: 80, configurable: true })
    Object.defineProperty(instance.terminal, 'rows', { value: 24, configurable: true })
    const cleanup = instance.mountPreview(document.createElement('div'))
    expect(webglAddons[0].dispose).toHaveBeenCalled()
    cleanup?.()
    instance.unmount()
  })

  it('falls back to the DOM renderer when the GPU context is lost', () => {
    const instance = mounted('webgl-lost')
    webglAddons[0].loseContext()
    expect(webglAddons[0].dispose).toHaveBeenCalled()
    instance.unmount()
  })

  it('leaves terminals beyond the context limit on the DOM renderer', () => {
    const visible = Array.from({ length: MAX_WEBGL_CONTEXTS + 1 }, (_, i) => mounted(`cap-${i}`))
    expect(webglAddons).toHaveLength(MAX_WEBGL_CONTEXTS)
    visible.forEach((instance) => instance.unmount())
  })
})

describe('TerminalInstance — WebGL renderer — gives a freed context to a terminal that was left on the DOM renderer', () => {
  setUpTerminalInstanceWebGLRenderer()

  it('gives a freed context to a terminal that was left on the DOM renderer', () => {
    const visible = Array.from({ length: MAX_WEBGL_CONTEXTS + 1 }, (_, i) => mounted(`free-${i}`))
    visible[0].unmount()
    visible[MAX_WEBGL_CONTEXTS].mount(document.createElement('div'))
    expect(webglAddons).toHaveLength(MAX_WEBGL_CONTEXTS + 1)
    visible.forEach((instance) => instance.unmount())
  })
})

describe('TerminalInstance — unmount()', () => {
  it('removes element from DOM', () => {
    const instance = new TerminalInstance('ses-1', 1000)
    const container = document.createElement('div')
    document.body.appendChild(container)
    instance.mount(container)
    instance.unmount()
    expect(container.contains(instance.element)).toBe(false)
    document.body.removeChild(container)
  })

  it('does not throw when called before mount', () => {
    const instance = new TerminalInstance('ses-1', 1000)
    expect(() => instance.unmount()).not.toThrow()
  })
})

describe('TerminalInstance — dispose()', () => {
  it('unsubscribes from output and disposes terminal', () => {
    const instance = new TerminalInstance('ses-1', 1000)
    instance.dispose()
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1)
    expect(instance.terminal.dispose).toHaveBeenCalledTimes(1)
  })

  it('does not throw when called without mounting first', () => {
    const instance = new TerminalInstance('ses-1', 1000)
    expect(() => instance.dispose()).not.toThrow()
  })
})

describe('TerminalInstance — busy/idle tracking', () => {
  it('fires onBusy and schedules onIdle on output', () => {
    vi.useFakeTimers()
    new TerminalInstance('ses-busy', 1000, ACTIVITY_HOOKS)
    const receive = mockSubscribe.mock.calls[0][1]
    receive('data', vi.fn())

    expect(mockSetSessionBusy).toHaveBeenCalled()
    vi.runAllTimers()
    expect(mockSetSessionIdle).toHaveBeenCalled()
    vi.useRealTimers()
  })
})

describe('TerminalInstance — dispose()', () => {
  it('clears busy timer and fires onIdle on dispose', () => {
    vi.useFakeTimers()
    const instance = new TerminalInstance('ses-dispose', 1000, ACTIVITY_HOOKS)
    // Trigger a busy timer
    const receive = mockSubscribe.mock.calls[0][1]
    receive('data', vi.fn())

    mockSetSessionIdle.mockClear()
    instance.dispose()
    expect(mockSetSessionIdle).toHaveBeenCalled()
    vi.useRealTimers()
  })
})

describe('TerminalInstance — mountPreview()', () => {
  it('returns null when terminal has not been opened', () => {
    const instance = new TerminalInstance('ses-1', 1000)
    const container = document.createElement('div')
    expect(instance.mountPreview(container)).toBeNull()
  })

  it('returns null when cols or rows are 0', () => {
    const instance = new TerminalInstance('ses-1', 1000)
    // terminal mock returns cols=0/rows=0 by default
    const container = document.createElement('div')
    const mountContainer = document.createElement('div')
    document.body.appendChild(mountContainer)
    instance.mount(mountContainer) // opens the terminal
    // Override cols/rows to 0 for this test
    Object.defineProperty(instance.terminal, 'cols', { value: 0, configurable: true })
    expect(instance.mountPreview(container)).toBeNull()
    document.body.removeChild(mountContainer)
  })
})

describe('TerminalInstance — mountPreview() — appends element to the preview container after mount', () => {
  it('appends element to the preview container after mount', () => {
    const instance = new TerminalInstance('ses-1', 1000)
    const mountContainer = document.createElement('div')
    document.body.appendChild(mountContainer)
    instance.mount(mountContainer)

    instance.unmount()

    // Give terminal non-zero cols/rows
    Object.defineProperty(instance.terminal, 'cols', { value: 80, configurable: true })
    Object.defineProperty(instance.terminal, 'rows', { value: 24, configurable: true })

    const previewContainer = document.createElement('div')
    document.body.appendChild(previewContainer)

    const cleanup = instance.mountPreview(previewContainer)
    expect(previewContainer.contains(instance.element)).toBe(true)
    expect(cleanup).toBeTypeOf('function')

    document.body.removeChild(mountContainer)
    document.body.removeChild(previewContainer)
  })
})

/** A terminal mounted once, at 80 by 24, whose screen xterm drew 640 by 432: 18px rows. */
function previewableInstance(): TerminalInstance {
  const instance = new TerminalInstance('ses-1', 1000)
  instance.mount(document.createElement('div'))
  instance.unmount()
  Object.defineProperty(instance.terminal, 'cols', { value: 80, configurable: true })
  Object.defineProperty(instance.terminal, 'rows', { value: 24, configurable: true })
  const screen = document.createElement('div')
  screen.className = 'xterm-screen'
  Object.defineProperty(screen, 'offsetWidth', { value: 640 })
  Object.defineProperty(screen, 'offsetHeight', { value: 432 })
  instance.element.appendChild(screen)
  return instance
}

/** A preview box whose size the test can change, as a resized tile would. */
function sizedBox(width: number, height: number): HTMLDivElement {
  const box = document.createElement('div')
  Object.defineProperty(box, 'offsetWidth', { value: width, configurable: true })
  Object.defineProperty(box, 'offsetHeight', { value: height, configurable: true })
  return box
}

describe('TerminalInstance — mountPreview() — follows the cursor on every render, and stops when the preview goes', () => {
  it('follows the cursor on every render, and stops when the preview goes', () => {
    const instance = previewableInstance()
    // A short box, so a full screen is taller than it and the window has to move.
    const previewContainer = sizedBox(220, 60)
    Object.assign(instance.terminal.buffer.active, { cursorY: 0 })
    const cleanup = instance.mountPreview(previewContainer)!
    const onRender = vi.mocked(instance.terminal.onRender)
    expect(onRender).toHaveBeenCalledTimes(1)
    expect(instance.element.style.transform).toMatch(/^translateY\(.*\) scale\(.*\)$/)

    Object.assign(instance.terminal.buffer.active, { cursorY: 23 })
    ;(onRender.mock.calls[0][0] as () => void)()
    expect(instance.element.style.transform).toMatch(/translateY\(-/)

    cleanup()
    expect(mockRenderDispose).toHaveBeenCalled()
  })
})

describe('TerminalInstance — mountPreview() — sizes the window from the rows xterm drew', () => {
  it('ends the window on the cursor row at the drawn row height', () => {
    const instance = previewableInstance()
    Object.assign(instance.terminal.buffer.active, { cursorY: 23 })
    // 220 / (640 + 12) scales the screen; 9 rows of 18px fit the box, so the window starts at row 15.
    const scale = 220 / 652
    instance.mountPreview(sizedBox(220, 60))
    const [, translateY, shownScale] = instance.element.style.transform.match(
      /translateY\((.+)px\) scale\((.+)\)/
    )!
    expect(Number(shownScale)).toBeCloseTo(scale, 5)
    expect(Number(translateY)).toBeCloseTo(-15 * 18 * scale, 3)
  })

  it('places the screen again when the box is resized', () => {
    const instance = previewableInstance()
    Object.assign(instance.terminal.buffer.active, { cursorY: 0 })
    const box = sizedBox(220, 60)
    instance.mountPreview(box)
    Object.defineProperty(box, 'offsetWidth', { value: 652 })
    const observer = mockResizeObserver.mock.calls.at(-1)![0] as () => void
    observer()
    expect(instance.element.style.transform).toBe('translateY(0px) scale(1)')
  })
})

describe('TerminalInstance — mountPreview() — keeps a preview out of the tab order, and gives the terminal back its place after', () => {
  it('keeps a preview out of the tab order, and gives the terminal back its place after', () => {
    const instance = new TerminalInstance('ses-1', 1000)
    const mountContainer = document.createElement('div')
    document.body.appendChild(mountContainer)
    instance.mount(mountContainer)
    instance.unmount()
    Object.defineProperty(instance.terminal, 'cols', { value: 80, configurable: true })
    Object.defineProperty(instance.terminal, 'rows', { value: 24, configurable: true })
    const textarea = document.createElement('textarea')
    Object.assign(instance.terminal, { textarea })
    Object.assign(instance.terminal.buffer.active, { cursorY: 0 })

    const cleanup = instance.mountPreview(document.createElement('div'))!
    expect(textarea.getAttribute('tabindex')).toBe('-1')
    cleanup()
    expect(textarea.hasAttribute('tabindex')).toBe(false)
    document.body.removeChild(mountContainer)
  })
})

describe('TerminalInstance — mountPreview() — cleanup removes element and restores original cssText', () => {
  it('cleanup removes element and restores original cssText', () => {
    const instance = new TerminalInstance('ses-1', 1000)
    const mountContainer = document.createElement('div')
    document.body.appendChild(mountContainer)
    instance.mount(mountContainer)
    instance.unmount()

    Object.defineProperty(instance.terminal, 'cols', { value: 80, configurable: true })
    Object.defineProperty(instance.terminal, 'rows', { value: 24, configurable: true })

    const previewContainer = document.createElement('div')
    document.body.appendChild(previewContainer)

    const cleanup = instance.mountPreview(previewContainer)!
    cleanup()

    expect(previewContainer.contains(instance.element)).toBe(false)
    expect(instance.element.style.width).toBe('100%')

    document.body.removeChild(mountContainer)
    document.body.removeChild(previewContainer)
  })
})

describe('TerminalInstance — mountPreview() — sets pointer-events none and transform on the element', () => {
  it('sets pointer-events none and transform on the element', () => {
    const instance = previewableInstance()
    instance.mountPreview(sizedBox(220, 150))
    expect(instance.element.style.pointerEvents).toBe('none')
    expect(instance.element.style.transform).toContain('scale(')
  })
})

function getProvider(lineText: string, providerIndex: number) {
  new TerminalInstance('ses-links', 1000)
  const instance = vi.mocked(Terminal).mock.results[0].value
  Object.defineProperty(instance, 'buffer', {
    value: makeMockBuffer(lineText),
    configurable: true,
  })
  return instance.registerLinkProvider.mock.calls[providerIndex][0]
}

describe('TerminalInstance — link providers (visual decoration)', () => {
  it('registers five link providers on construction (URL, bare, naked, path, quoted-path)', () => {
    new TerminalInstance('ses-links', 1000)
    const instance = vi.mocked(Terminal).mock.results[0].value
    expect(instance.registerLinkProvider).toHaveBeenCalledTimes(5)
  })

  it('URL provider detects https links and returns them in callback', () => {
    const provider = getProvider('visit https://example.com/path for info', 0)
    let result: unknown
    provider.provideLinks(0, (links: unknown) => {
      result = links
    })
    expect(Array.isArray(result)).toBe(true)
    expect((result as { text: string }[])[0].text).toBe('https://example.com/path')
  })

  it('URL provider range stops before the full stop that ends a sentence', () => {
    const provider = getProvider('draft PR https://github.com/x/y/pull/208. Lint', 0)
    let result: { text: string; range: { end: { x: number } } }[] = []
    provider.provideLinks(0, (links: typeof result) => {
      result = links
    })
    expect(result[0].text).toBe('https://github.com/x/y/pull/208')
    expect(result[0].range.end.x).toBe(9 + 'https://github.com/x/y/pull/208'.length)
  })
})

describe('TerminalInstance — link providers (visual decoration) — URL provider activate is a no-op (mousedown handler owns activation)', () => {
  it('URL provider activate is a no-op (mousedown handler owns activation)', () => {
    const provider = getProvider('https://example.com', 0)
    let link: { activate: (e: MouseEvent, t: string) => void } | undefined
    provider.provideLinks(0, (links: unknown[]) => {
      link = links?.[0] as typeof link
    })
    link!.activate({ metaKey: true } as MouseEvent, 'https://example.com')
    expect(mockOpenExternal).not.toHaveBeenCalled()
  })

  it('URL provider returns undefined for line with no URLs', () => {
    const provider = getProvider('no links here', 0)
    let result: unknown = 'sentinel'
    provider.provideLinks(0, (links: unknown) => {
      result = links
    })
    expect(result).toBeUndefined()
  })
})

describe('TerminalInstance — link providers (visual decoration) — URL provider returns undefined when line is missing', () => {
  it('URL provider returns undefined when line is missing', () => {
    new TerminalInstance('ses-links', 1000)
    const instance = vi.mocked(Terminal).mock.results[0].value
    Object.defineProperty(instance, 'buffer', {
      value: { active: { getLine: () => undefined, viewportY: 0 } },
      configurable: true,
    })
    const provider = instance.registerLinkProvider.mock.calls[0][0]
    let result: unknown = 'sentinel'
    provider.provideLinks(0, (links: unknown) => {
      result = links
    })
    expect(result).toBeUndefined()
  })

  it('bare URL provider (index 1) detects www. links', () => {
    const provider = getProvider('visit www.google.com for info', 1)
    let result: unknown
    provider.provideLinks(0, (links: unknown) => {
      result = links
    })
    expect(Array.isArray(result)).toBe(true)
    expect((result as { text: string }[])[0].text).toBe('www.google.com')
  })
})

describe('TerminalInstance — link providers (visual decoration) — naked URL provider (index 2) detects bare domain links', () => {
  it('naked URL provider (index 2) detects bare domain links', () => {
    const provider = getProvider('check google.com for info', 2)
    let result: unknown
    provider.provideLinks(0, (links: unknown) => {
      result = links
    })
    expect(Array.isArray(result)).toBe(true)
    expect((result as { text: string }[])[0].text).toBe('google.com')
  })

  it('path provider detects absolute paths and returns them in callback', () => {
    const provider = getProvider('Error in /Users/foo/bar.ts:12:3', 3)
    let result: unknown
    provider.provideLinks(0, (links: unknown) => {
      result = links
    })
    expect(Array.isArray(result)).toBe(true)
    expect((result as { text: string }[])[0].text).toContain('/Users/foo/bar.ts')
  })

  it('quoted-path provider (index 4) detects the inner path of a quoted string', () => {
    const provider = getProvider('opened "/Users/foo/bar.ts" successfully', 4)
    let result: unknown
    provider.provideLinks(0, (links: unknown) => {
      result = links
    })
    expect(Array.isArray(result)).toBe(true)
    expect((result as { text: string }[])[0].text).toBe('/Users/foo/bar.ts')
  })
})

describe('TerminalInstance — link providers (visual decoration) — quoted-path provider returns undefined when the line has no quoted path', () => {
  it('quoted-path provider returns undefined when the line has no quoted path', () => {
    const provider = getProvider('no quoted paths on this line', 4)
    let result: unknown = 'sentinel'
    provider.provideLinks(0, (links: unknown) => {
      result = links
    })
    expect(result).toBeUndefined()
  })

  it('quoted-path provider returns undefined when the line is missing', () => {
    new TerminalInstance('ses-links', 1000)
    const instance = vi.mocked(Terminal).mock.results[0].value
    Object.defineProperty(instance, 'buffer', {
      value: { active: { getLine: () => undefined, viewportY: 0 } },
      configurable: true,
    })
    const provider = instance.registerLinkProvider.mock.calls[4][0]
    let result: unknown = 'sentinel'
    provider.provideLinks(0, (links: unknown) => {
      result = links
    })
    expect(result).toBeUndefined()
  })
})

// xterm draws 80 × 24 cells of 8 × 16 px from the screen's top left, which
// jsdom puts at 0,0 along with the terminal's element; viewportY=0.

/** Gives the mocked terminal the `.xterm-screen` xterm sizes to its cells. */
function drawTerminalScreen(
  termMock: Record<string, unknown>,
  cell: { width: number; height: number },
  screen = { left: 0, top: 0 }
) {
  const screenElement = document.createElement('div')
  screenElement.className = 'xterm-screen'
  screenElement.getBoundingClientRect = () =>
    new DOMRect(screen.left, screen.top, 80 * cell.width, 24 * cell.height)
  const xtermElement = document.createElement('div')
  xtermElement.appendChild(screenElement)
  Object.assign(termMock, { element: xtermElement, rows: 24, cols: 80 })
}

function makeInstanceWithLine(lineText: string) {
  const instance = new TerminalInstance('ses-link', 1000)
  const termMock = vi.mocked(Terminal).mock.results.at(-1)!.value
  drawTerminalScreen(termMock, { width: 8, height: 16 })
  Object.defineProperty(termMock, 'buffer', {
    value: makeMockBuffer(lineText, 0),
    configurable: true,
  })
  return instance
}

const fire = (element: HTMLElement, type: string, opts: Partial<MouseEventInit> = {}) =>
  element.dispatchEvent(new MouseEvent(type, { bubbles: true, ...opts }))

describe('TerminalInstance — link interaction (hover overlay + cmd+click) — hover overlay', () => {
  it('shows overlay when hovering over a URL with cmd held', () => {
    const instance = makeInstanceWithLine('https://example.com')
    fire(instance.element, 'mousemove', { clientX: 8, clientY: 0, metaKey: true })
    expect(instance.linkOverlay?.style.display).toBe('block')
  })

  it('does not show overlay when hovering over a URL without cmd', () => {
    const instance = makeInstanceWithLine('https://example.com')
    fire(instance.element, 'mousemove', { clientX: 8, clientY: 0, metaKey: false })
    expect(instance.linkOverlay?.style.display).toBe('none')
  })

  it('hides overlay when hovering over plain text', () => {
    const instance = makeInstanceWithLine('just some text')
    fire(instance.element, 'mousemove', { clientX: 8, clientY: 0, metaKey: true })
    expect(instance.linkOverlay?.style.display).toBe('none')
  })

  it('hides overlay on mouseleave', () => {
    const instance = makeInstanceWithLine('https://example.com')
    fire(instance.element, 'mousemove', { clientX: 8, clientY: 0, metaKey: true })
    expect(instance.linkOverlay?.style.display).toBe('block')
    fire(instance.element, 'mouseleave')
    expect(instance.linkOverlay?.style.display).toBe('none')
  })
})

describe('TerminalInstance — link interaction (hover overlay + cmd+click) — hover overlay — positions overlay correctly for a URL at start of line', () => {
  it('positions overlay correctly for a URL at start of line', () => {
    // URL 'https://example.com' at index 0, length 19
    // overlay.left = 0*8=0, top = (0+1)*16-1=15, width = 19*8=152
    const instance = makeInstanceWithLine('https://example.com')
    fire(instance.element, 'mousemove', { clientX: 8, clientY: 0, metaKey: true })
    expect(instance.linkOverlay?.style.left).toBe('0px')
    expect(instance.linkOverlay?.style.top).toBe('15px')
    expect(instance.linkOverlay?.style.width).toBe('152px')
  })

  it('shows overlay when hovering over a www. URL with cmd held', () => {
    const instance = makeInstanceWithLine('www.google.com')
    fire(instance.element, 'mousemove', { clientX: 0, clientY: 0, metaKey: true })
    expect(instance.linkOverlay?.style.display).toBe('block')
  })

  it('shows overlay when hovering over a bare domain URL with cmd held', () => {
    const instance = makeInstanceWithLine('google.com')
    fire(instance.element, 'mousemove', { clientX: 0, clientY: 0, metaKey: true })
    expect(instance.linkOverlay?.style.display).toBe('block')
  })

  it('shows overlay when hovering over an absolute path', () => {
    const instance = makeInstanceWithLine('/Users/foo/bar.ts')
    fire(instance.element, 'mousemove', { clientX: 4, clientY: 0, metaKey: true })
    expect(instance.linkOverlay?.style.display).toBe('block')
  })
})

describe('TerminalInstance — link interaction (hover overlay + cmd+click) — hover overlay — hides overlay when cursor moves off a link', () => {
  it('hides overlay when cursor moves off a link', () => {
    const instance = makeInstanceWithLine('text https://x.com more')
    // Hover over URL with cmd (clientX=44 → col=5, URL starts at index 5)
    fire(instance.element, 'mousemove', { clientX: 44, clientY: 0, metaKey: true })
    expect(instance.linkOverlay?.style.display).toBe('block')
    // Move to plain text before URL (col=0)
    fire(instance.element, 'mousemove', { clientX: 0, clientY: 0, metaKey: true })
    expect(instance.linkOverlay?.style.display).toBe('none')
  })

  it('hides overlay when cmd is released while hovering', () => {
    const instance = makeInstanceWithLine('https://example.com')
    fire(instance.element, 'mousemove', { clientX: 8, clientY: 0, metaKey: true })
    expect(instance.linkOverlay?.style.display).toBe('block')
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Meta', bubbles: true }))
    expect(instance.linkOverlay?.style.display).toBe('none')
  })

  it('shows overlay when cmd is pressed while already hovering a link', () => {
    const instance = makeInstanceWithLine('https://example.com')
    // Hover without cmd first to record the position, overlay stays hidden.
    fire(instance.element, 'mousemove', { clientX: 8, clientY: 0, metaKey: false })
    expect(instance.linkOverlay?.style.display).toBe('none')
    // Pressing cmd while hovering re-checks and shows the overlay.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', bubbles: true }))
    expect(instance.linkOverlay?.style.display).toBe('block')
  })
})

describe('TerminalInstance — link interaction (hover overlay + cmd+click) — cmd+click mousedown', () => {
  it('opens URL with openExternal on cmd+click', () => {
    const instance = makeInstanceWithLine('https://example.com')
    fire(instance.element, 'mousedown', { metaKey: true, clientX: 8, clientY: 0 })
    expect(mockOpenExternal).toHaveBeenCalledWith('https://example.com')
  })

  it('opens full URL including balanced parentheses (e.g. Wikipedia)', () => {
    const url = 'https://en.wikipedia.org/wiki/Foo_(bar)'
    const instance = makeInstanceWithLine(url)
    fire(instance.element, 'mousedown', { metaKey: true, clientX: 8, clientY: 0 })
    expect(mockOpenExternal).toHaveBeenCalledWith(url)
  })

  it('opens the inner path of a double-quoted string with a space on cmd+click', () => {
    // A space means the bare path regex misses it, so the quoted-path hit-test runs.
    const instance = makeInstanceWithLine('see "/Users/foo bar/x.ts"')
    fire(instance.element, 'mousedown', { metaKey: true, clientX: 6 * 8, clientY: 0 })
    expect(mockOpenPath).toHaveBeenCalledWith('/Users/foo bar/x.ts')
  })

  it('opens the inner path of a single-quoted string with a space on cmd+click', () => {
    const instance = makeInstanceWithLine("see '/Users/foo bar/x.ts'")
    fire(instance.element, 'mousedown', { metaKey: true, clientX: 6 * 8, clientY: 0 })
    expect(mockOpenPath).toHaveBeenCalledWith('/Users/foo bar/x.ts')
  })
})

describe('TerminalInstance — link interaction (hover overlay + cmd+click) — cmd+click mousedown — opens without the punctuation that ends it', () => {
  // Reported: a URL ending a sentence opened with the full stop on it.
  it.each([
    [
      'draft PR https://github.com/andytavares/terminator/pull/208. Lint',
      'https://github.com/andytavares/terminator/pull/208',
    ],
    ['see https://example.com/a, then', 'https://example.com/a'],
    ['(https://example.com/a)', 'https://example.com/a'],
    ['is it https://example.com/a?', 'https://example.com/a'],
    ['go to https://example.com/a!', 'https://example.com/a'],
    ['with https://example.com/a; and', 'https://example.com/a'],
    ['per https://example.com/a: yes', 'https://example.com/a'],
    ['quoted "https://example.com/a".', 'https://example.com/a'],
    ['check www.google.com.', 'https://www.google.com'],
    ['check google.com.', 'https://google.com'],
  ])('opens %j without the punctuation that ends it', (line, url) => {
    const instance = makeInstanceWithLine(line)
    const col = line.indexOf(
      url.replace('https://www.', 'www.').replace(/^https:\/\/(?=google)/, '')
    )
    fire(instance.element, 'mousedown', { metaKey: true, clientX: (col + 2) * 8, clientY: 0 })
    expect(mockOpenExternal).toHaveBeenCalledWith(url)
  })

  it('opens a path that ends a sentence without the full stop', () => {
    const instance = makeInstanceWithLine('Wrote /Users/foo/bar.ts.')
    fire(instance.element, 'mousedown', { metaKey: true, clientX: 8 * 8, clientY: 0 })
    expect(mockOpenPath).toHaveBeenCalledWith('/Users/foo/bar.ts')
  })
})

describe('TerminalInstance — link interaction (hover overlay + cmd+click) — cmd+click mousedown — keeps punctuation inside a URL', () => {
  it('keeps punctuation inside a URL', () => {
    const url = 'https://example.com/a.b?q=1,2&x=y#frag.c'
    const instance = makeInstanceWithLine(`${url}.`)
    fire(instance.element, 'mousedown', { metaKey: true, clientX: 8, clientY: 0 })
    expect(mockOpenExternal).toHaveBeenCalledWith(url)
  })

  it('opens a path ending a sentence without the full stop, keeping its line number', () => {
    const instance = makeInstanceWithLine('Fixed in /Users/foo/bar.ts:12.')
    fire(instance.element, 'mousedown', { metaKey: true, clientX: 12 * 8, clientY: 0 })
    expect(mockOpenPath).toHaveBeenCalledWith(
      expect.stringMatching(/^\/Users\/foo\/bar\.ts(:12)?$/)
    )
    expect(mockOpenPath.mock.calls[0][0]).not.toMatch(/\.$/)
  })

  it('does not open URL without metaKey or ctrlKey', () => {
    const instance = makeInstanceWithLine('https://example.com')
    fire(instance.element, 'mousedown', {
      metaKey: false,
      ctrlKey: false,
      clientX: 8,
      clientY: 0,
    })
    expect(mockOpenExternal).not.toHaveBeenCalled()
  })
})

describe('TerminalInstance — link interaction (hover overlay + cmd+click) — cmd+click mousedown — opens URL with openExternal on ctrl+click (Windows/Linux)', () => {
  it('opens URL with openExternal on ctrl+click (Windows/Linux)', () => {
    mockPlatform = 'Win32'
    const instance = makeInstanceWithLine('https://example.com')
    fire(instance.element, 'mousedown', {
      metaKey: false,
      ctrlKey: true,
      clientX: 8,
      clientY: 0,
    })
    expect(mockOpenExternal).toHaveBeenCalledWith('https://example.com')
  })

  it('does not open on macOS ctrl+click (context menu key)', () => {
    // macOS: ctrl+click = right-click, should not open link
    const instance = makeInstanceWithLine('https://example.com')
    fire(instance.element, 'mousedown', {
      metaKey: false,
      ctrlKey: true,
      clientX: 8,
      clientY: 0,
    })
    expect(mockOpenExternal).not.toHaveBeenCalled()
  })

  it('opens www. URL with https:// prepended on cmd+click', () => {
    const instance = makeInstanceWithLine('www.google.com')
    fire(instance.element, 'mousedown', { metaKey: true, clientX: 0, clientY: 0 })
    expect(mockOpenExternal).toHaveBeenCalledWith('https://www.google.com')
  })
})

describe('TerminalInstance — link interaction (hover overlay + cmd+click) — cmd+click mousedown — opens bare domain URL with https:// prepended on cmd+click', () => {
  it('opens bare domain URL with https:// prepended on cmd+click', () => {
    const instance = makeInstanceWithLine('google.com')
    fire(instance.element, 'mousedown', { metaKey: true, clientX: 0, clientY: 0 })
    expect(mockOpenExternal).toHaveBeenCalledWith('https://google.com')
  })

  it('does not treat protocol-relative URL as a path', () => {
    const instance = makeInstanceWithLine('//example.com/path')
    fire(instance.element, 'mousedown', { metaKey: true, clientX: 4, clientY: 0 })
    expect(mockOpenPath).not.toHaveBeenCalled()
    expect(mockOpenExternal).not.toHaveBeenCalled()
  })

  it('does not match mid-string slash as a path', () => {
    // 'src/renderer/foo.ts' contains '/renderer/foo.ts' which is NOT a word-boundary path
    const instance = makeInstanceWithLine('src/renderer/foo.ts')
    fire(instance.element, 'mousedown', { metaKey: true, clientX: 4, clientY: 0 })
    expect(mockOpenPath).not.toHaveBeenCalled()
  })

  it('opens double-quoted path with spaces', () => {
    // Python tracebacks: File "/Users/Jane Doe/foo.py", line 5
    const instance = makeInstanceWithLine('File "/Users/Jane Doe/foo.py", line 5')
    // col inside the quoted path (char 6 = 'U' in /Users, offset by 1 for opening quote)
    fire(instance.element, 'mousedown', { metaKey: true, clientX: 48, clientY: 0 })
    expect(mockOpenPath).toHaveBeenCalledWith('/Users/Jane Doe/foo.py')
  })

  it('opens single-quoted path with spaces', () => {
    const instance = makeInstanceWithLine("error: '/Users/Jane Doe/bar.ts'")
    fire(instance.element, 'mousedown', { metaKey: true, clientX: 64, clientY: 0 })
    expect(mockOpenPath).toHaveBeenCalledWith('/Users/Jane Doe/bar.ts')
  })
})

describe('TerminalInstance — link interaction (hover overlay + cmd+click) — cmd+click mousedown — strips line:col suffix from quoted path', () => {
  it('strips line:col suffix from quoted path', () => {
    const instance = makeInstanceWithLine('File "/Users/foo/bar.ts:10:3"')
    fire(instance.element, 'mousedown', { metaKey: true, clientX: 48, clientY: 0 })
    expect(mockOpenPath).toHaveBeenCalledWith('/Users/foo/bar.ts')
  })

  it('opens absolute path with openPath on cmd+click', () => {
    const instance = makeInstanceWithLine('/Users/foo/bar')
    fire(instance.element, 'mousedown', { metaKey: true, clientX: 4, clientY: 0 })
    expect(mockOpenPath).toHaveBeenCalledWith('/Users/foo/bar')
  })

  it('strips line:col suffix from path before opening', () => {
    const instance = makeInstanceWithLine('/Users/foo/bar.ts:12:3')
    fire(instance.element, 'mousedown', { metaKey: true, clientX: 4, clientY: 0 })
    expect(mockOpenPath).toHaveBeenCalledWith('/Users/foo/bar.ts')
  })

  it('strips only col suffix when line number present', () => {
    const instance = makeInstanceWithLine('/home/user/file.go:99')
    fire(instance.element, 'mousedown', { metaKey: true, clientX: 4, clientY: 0 })
    expect(mockOpenPath).toHaveBeenCalledWith('/home/user/file.go')
  })

  it('does nothing when cmd+clicking on plain text', () => {
    const instance = makeInstanceWithLine('just some output text')
    fire(instance.element, 'mousedown', { metaKey: true, clientX: 4, clientY: 0 })
    expect(mockOpenExternal).not.toHaveBeenCalled()
    expect(mockOpenPath).not.toHaveBeenCalled()
  })
})

describe('TerminalInstance — link interaction (hover overlay + cmd+click) — cmd+click mousedown — neither underlines nor opens before xterm has drawn a screen', () => {
  it('neither underlines nor opens before xterm has drawn a screen', () => {
    const instance = new TerminalInstance('ses-unopened', 1000)
    const termMock = vi.mocked(Terminal).mock.results.at(-1)!.value
    Object.defineProperty(termMock, 'buffer', {
      value: makeMockBuffer('https://example.com', 0),
      configurable: true,
    })
    fire(instance.element, 'mousemove', { metaKey: true, clientX: 8, clientY: 0 })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', bubbles: true }))
    fire(instance.element, 'mousedown', { metaKey: true, clientX: 8, clientY: 0 })
    expect(instance.linkOverlay?.style.display).toBe('none')
    expect(mockOpenExternal).not.toHaveBeenCalled()
  })

  it('removes listeners on dispose — no action after dispose', () => {
    const instance = makeInstanceWithLine('https://example.com')
    instance.dispose()
    fire(instance.element, 'mousedown', { metaKey: true, clientX: 8, clientY: 0 })
    expect(mockOpenExternal).not.toHaveBeenCalled()
  })
})

// The WebGL renderer leaves no `.xterm-rows` to measure, and xterm draws
// its cells from `.xterm-screen`, inside the padding the pane gives `.xterm`.
const CELL = { width: 7, height: 18 }

function makeDrawnTerminal(lines: Record<number, string>, screen = { left: 0, top: 0 }) {
  const instance = new TerminalInstance('ses-drawn', 1000)
  const termMock = vi.mocked(Terminal).mock.results.at(-1)!.value
  drawTerminalScreen(termMock, CELL, screen)
  Object.defineProperty(termMock, 'buffer', {
    value: {
      active: {
        viewportY: 0,
        getLine: (row: number) => ({ translateToString: () => lines[row] ?? '' }),
      },
    },
    configurable: true,
  })
  return instance
}

const atCell = (col: number, row: number, screen = { left: 0, top: 0 }) => ({
  metaKey: true,
  clientX: screen.left + (col + 0.5) * CELL.width,
  clientY: screen.top + (row + 0.5) * CELL.height,
})

describe('TerminalInstance — link interaction (hover overlay + cmd+click) — on the cells xterm draws', () => {
  it('opens the link on the row clicked, at the height xterm draws its rows', () => {
    const instance = makeDrawnTerminal({ 5: 'https://example.com/row-five' })
    fire(instance.element, 'mousedown', atCell(2, 5))
    expect(mockOpenExternal).toHaveBeenCalledWith('https://example.com/row-five')
  })

  it('counts rows and columns from where the screen starts, inside the padding', () => {
    const padding = { left: 12, top: 6 }
    const instance = makeDrawnTerminal({ 0: '/tmp/notes.txt' }, padding)
    fire(instance.element, 'mousedown', {
      ...atCell(0, 0, padding),
      clientY: padding.top + CELL.height - 1,
    })
    expect(mockOpenPath).toHaveBeenCalledWith('/tmp/notes.txt')
  })

  it('opens nothing on a row past the end of the buffer', () => {
    const instance = makeDrawnTerminal({})
    const termMock = vi.mocked(Terminal).mock.results.at(-1)!.value
    termMock.buffer.active.getLine = () => undefined
    fire(instance.element, 'mousedown', atCell(0, 0))
    expect(mockOpenExternal).not.toHaveBeenCalled()
    expect(mockOpenPath).not.toHaveBeenCalled()
  })
})

describe('TerminalInstance — link interaction (hover overlay + cmd+click) — on the cells xterm draws — swallows a refusal to open, so a click never throws', () => {
  it('swallows a refusal to open, so a click never throws', async () => {
    mockOpenExternal.mockRejectedValueOnce(new Error('no browser'))
    mockOpenPath.mockRejectedValueOnce(new Error('no app'))
    const instance = makeDrawnTerminal({ 0: 'https://example.com', 1: '/tmp/a.txt' })
    fire(instance.element, 'mousedown', atCell(0, 0))
    fire(instance.element, 'mousedown', atCell(0, 1))
    await Promise.allSettled(
      [...mockOpenExternal.mock.results, ...mockOpenPath.mock.results].map((call) => call.value)
    )
    expect(mockOpenExternal).toHaveBeenCalledWith('https://example.com')
    expect(mockOpenPath).toHaveBeenCalledWith('/tmp/a.txt')
  })

  it('underlines the link at the row and columns xterm draws it in', () => {
    const padding = { left: 12, top: 6 }
    const instance = makeDrawnTerminal({ 3: 'see https://example.com' }, padding)
    fire(instance.element, 'mousemove', atCell(5, 3, padding))
    expect(instance.linkOverlay?.style.left).toBe(`${12 + 4 * CELL.width}px`)
    expect(instance.linkOverlay?.style.top).toBe(`${6 + 4 * CELL.height - 1}px`)
    expect(instance.linkOverlay?.style.width).toBe(`${19 * CELL.width}px`)
  })
})

let observerCallback: MutationCallback

let mockObserve: ReturnType<typeof vi.fn>

let mockDisconnect: ReturnType<typeof vi.fn>

/** The hooks every "TerminalInstance — xterm theming" describe registers. */
function setUpTerminalInstanceXtermTheming(): void {
  beforeEach(() => {
    mockObserve = vi.fn()
    mockDisconnect = vi.fn()
    vi.stubGlobal(
      'MutationObserver',
      vi.fn().mockImplementation(function (cb: MutationCallback) {
        observerCallback = cb
        return { observe: mockObserve, disconnect: mockDisconnect }
      })
    )
    document.documentElement.removeAttribute('data-theme')
  })
}

describe('TerminalInstance — xterm theming', () => {
  setUpTerminalInstanceXtermTheming()

  it.each(['dark', 'light'] as const)(
    'carries distinct scrollbar slider colours in the %s theme, as xterm draws its own scrollbar',
    (name) => {
      const theme = XTERM_THEMES[name]
      const colours = [
        theme.scrollbarSliderBackground,
        theme.scrollbarSliderHoverBackground,
        theme.scrollbarSliderActiveBackground,
      ]
      for (const colour of colours) expect(colour).toMatch(/^rgba\(/)
      expect(new Set(colours).size).toBe(3)
    }
  )

  it('hands the scrollbar colours to the terminal on construction', () => {
    new TerminalInstance('ses-scrollbar', 1000)
    const terminal = vi.mocked(Terminal).mock.results.at(-1)!.value
    expect(terminal.options.theme.scrollbarSliderBackground).toBe(
      XTERM_THEMES.dark.scrollbarSliderBackground
    )
  })

  it('sets dark theme on construction when data-theme is absent', () => {
    new TerminalInstance('ses-theme', 1000)
    const terminal = vi.mocked(Terminal).mock.results.at(-1)!.value
    expect(terminal.options.theme).toEqual(XTERM_THEMES.dark)
  })
})

describe('TerminalInstance — the padding around the terminal', () => {
  setUpTerminalInstanceXtermTheming()

  it("is painted in the terminal's own background, so no edge shows around it", () => {
    const instance = new TerminalInstance('ses-edge', 1000)
    expect(instance.element.style.backgroundColor).toBe('rgb(30, 30, 30)')
  })

  it('follows the theme when it changes', () => {
    const instance = new TerminalInstance('ses-edge-light', 1000)
    document.documentElement.dataset.theme = 'light'
    observerCallback([], {} as MutationObserver)
    expect(instance.element.style.backgroundColor).toBe('rgb(245, 245, 245)')
  })
})

describe('TerminalInstance — xterm theming — sets light theme on construction when data-theme="light"', () => {
  setUpTerminalInstanceXtermTheming()

  it('sets light theme on construction when data-theme="light"', () => {
    document.documentElement.dataset.theme = 'light'
    new TerminalInstance('ses-theme-light', 1000)
    const terminal = vi.mocked(Terminal).mock.results.at(-1)!.value
    expect(terminal.options.theme).toEqual(XTERM_THEMES.light)
  })

  it('updates terminal theme when MutationObserver fires a data-theme change', () => {
    new TerminalInstance('ses-obs', 1000)
    const terminal = vi.mocked(Terminal).mock.results.at(-1)!.value
    expect(terminal.options.theme).toEqual(XTERM_THEMES.dark)

    document.documentElement.dataset.theme = 'light'
    observerCallback([], {} as MutationObserver)

    expect(terminal.options.theme).toEqual(XTERM_THEMES.light)
  })

  it('attaches MutationObserver on document.documentElement', () => {
    new TerminalInstance('ses-obs2', 1000)
    expect(mockObserve).toHaveBeenCalledWith(
      document.documentElement,
      expect.objectContaining({ attributes: true, attributeFilter: ['data-theme'] })
    )
  })

  it('disconnects MutationObserver on dispose', () => {
    const instance = new TerminalInstance('ses-obs3', 1000)
    instance.dispose()
    expect(mockDisconnect).toHaveBeenCalled()
  })
})

describe('taking over a terminal that was already running', () => {
  it('says it is on screen, so held output is delivered rather than dropped', () => {
    // A supervised agent's terminal starts producing output before this
    // component exists. It is held until this call, and without it the operator
    // opens the tab to find the launch command and everything after it missing.
    new TerminalInstance('agent-session', 1000)
    expect(mockAttach).toHaveBeenCalledWith('agent-session')
  })

  it('subscribes before attaching, so nothing arrives with nowhere to go', () => {
    new TerminalInstance('agent-session', 1000)
    expect(mockSubscribe.mock.invocationCallOrder[0]).toBeLessThan(
      mockAttach.mock.invocationCallOrder[0]
    )
  })
})
