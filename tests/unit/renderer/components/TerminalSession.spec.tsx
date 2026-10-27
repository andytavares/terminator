import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Terminal, type IBuffer, type IBufferNamespace, type IBufferLine } from '@xterm/xterm'
import {
  TerminalInstance,
  XTERM_THEMES,
} from '../../../../src/renderer/components/terminal/TerminalSession'
import { MAX_WEBGL_CONTEXTS } from '../../../../src/renderer/terminal/webgl-contexts'
import { installElectronApi } from '../../../support/electron-api'
import { partialFake } from '../../../support/fakes'

const mockResizeObserver = vi.fn()

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
  mockResizeObserver.mockImplementation(function () {
    return { observe: vi.fn(), disconnect: vi.fn() }
  })
  vi.stubGlobal('ResizeObserver', mockResizeObserver)
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

describe('TerminalInstance — reports keystrokes to its hook', () => {
  it('tells its onInput hook what was typed', () => {
    const onInput = vi.fn()
    new TerminalInstance('ses-input', 1000, { onInput })
    const instance = vi.mocked(Terminal).mock.results[0].value
    instance.onData.mock.calls[0][0]('ls\r')
    expect(onInput).toHaveBeenCalledWith('ls\r')
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

/** A container in another document, as a window.open() child window would hold. */
function containerInOtherWindow(view: Window | null): HTMLElement {
  const otherDocument = document.implementation.createHTMLDocument('breakout')
  Object.defineProperty(otherDocument, 'defaultView', { value: view })
  const container = otherDocument.createElement('div')
  otherDocument.body.appendChild(container)
  return container
}

describe('TerminalInstance — unmount(from) — after the terminal moved to another container', () => {
  it('leaves the element in the newer container when the older one unmounts late', () => {
    const instance = new TerminalInstance('ses-1', 1000)
    const mainContainer = document.createElement('div')
    const breakoutContainer = containerInOtherWindow(null)
    instance.mount(mainContainer)
    instance.mount(breakoutContainer)
    instance.unmount(mainContainer)
    expect(breakoutContainer.contains(instance.element)).toBe(true)
  })

  it('removes the element from the container it is still in', () => {
    const instance = new TerminalInstance('ses-1', 1000)
    const container = document.createElement('div')
    instance.mount(container)
    instance.unmount(container)
    expect(container.contains(instance.element)).toBe(false)
  })
})

describe('TerminalInstance — mount() — into a container of another window', () => {
  it('opens the terminal again, with WebGL off first, when the document differs', () => {
    webglAddons.length = 0
    const instance = new TerminalInstance('ses-1', 1000)
    instance.mount(document.createElement('div'))
    const open = vi.mocked(instance.terminal.open)
    const other = containerInOtherWindow(null)
    instance.mount(other)
    expect(other.contains(instance.element)).toBe(true)
    expect(open).toHaveBeenCalledTimes(2)
    expect(open).toHaveBeenLastCalledWith(instance.element)
    expect(webglAddons[0]?.dispose).toHaveBeenCalled()
  })

  it('opens only once when remounted into the same other document', () => {
    const instance = new TerminalInstance('ses-1', 1000)
    const other = containerInOtherWindow(null)
    instance.mount(other)
    instance.unmount()
    instance.mount(other)
    expect(instance.terminal.open).toHaveBeenCalledTimes(1)
  })

  it('opens again when it returns to the main document', () => {
    const instance = new TerminalInstance('ses-1', 1000)
    instance.mount(containerInOtherWindow(null))
    instance.mount(document.createElement('div'))
    expect(instance.terminal.open).toHaveBeenCalledTimes(2)
  })
})

describe('TerminalInstance — mount() — in the window of its container', () => {
  it('observes and schedules the scroll pin with the container window, not the main one', () => {
    const observe = vi.fn()
    const childResizeObserver = vi.fn(function () {
      return { observe, disconnect: vi.fn() }
    })
    const childFrame = vi.fn()
    const view = partialFake<Window & typeof globalThis>({
      ResizeObserver: childResizeObserver as unknown as typeof ResizeObserver,
      requestAnimationFrame: childFrame,
    })
    const container = containerInOtherWindow(view)
    const instance = new TerminalInstance('ses-1', 1000)
    instance.mount(container)
    expect(childResizeObserver).toHaveBeenCalledTimes(1)
    expect(observe).toHaveBeenCalledWith(container)
    expect(mockResizeObserver).not.toHaveBeenCalled()
    expect(childFrame).toHaveBeenCalledTimes(1)
  })

  it('disconnects the previous observer when mounted again without unmount', () => {
    const disconnect = vi.fn()
    mockResizeObserver.mockImplementation(function () {
      return { observe: vi.fn(), disconnect }
    })
    const instance = new TerminalInstance('ses-1', 1000)
    instance.mount(document.createElement('div'))
    instance.mount(document.createElement('div'))
    expect(disconnect).toHaveBeenCalledTimes(1)
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

describe('TerminalInstance — link providers (visual decoration) — URL provider returns undefined for a line with no URLs', () => {
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

interface ProvidedLink {
  text: string
  range: { start: { x: number }; end: { x: number } }
  decorations: { underline: boolean; pointerCursor: boolean }
  activate: (event: MouseEvent, text: string) => void
  hover: (event: MouseEvent, text: string) => void
  leave: (event: MouseEvent, text: string) => void
}

/** A terminal whose buffer rows (0-based) read `lines`; xterm's providers are asked 1-based. */
function terminalWithLines(lines: Record<number, string>) {
  const instance = new TerminalInstance('ses-link', 1000)
  const termMock = vi.mocked(Terminal).mock.results.at(-1)!.value
  Object.defineProperty(termMock, 'buffer', {
    value: {
      active: {
        viewportY: 0,
        getLine: (row: number) =>
          lines[row] === undefined ? undefined : { translateToString: () => lines[row] },
      },
    },
    configurable: true,
  })
  return { instance, termMock }
}

/** The link xterm would pick at 0-based `col` of 1-based buffer line `y`: the first provider's. */
function linkAtColumn(termMock: Record<string, unknown>, col: number, y = 1) {
  const registerCalls = (termMock.registerLinkProvider as ReturnType<typeof vi.fn>).mock.calls
  for (const [provider] of registerCalls) {
    let links: ProvidedLink[] | undefined
    provider.provideLinks(y, (found: ProvidedLink[] | undefined) => (links = found))
    const hit = links?.find((link) => col + 1 >= link.range.start.x && col + 1 <= link.range.end.x)
    if (hit) return hit
  }
  return undefined
}

function cmdClick(line: string, col: number, init: MouseEventInit = { metaKey: true }) {
  const { termMock } = terminalWithLines({ 0: line })
  const link = linkAtColumn(termMock, col)
  link?.activate(new MouseEvent('mouseup', init), link.text)
  return link
}

const press = (type: 'keydown' | 'keyup', key: string, init: KeyboardEventInit = {}) =>
  document.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, ...init }))

describe('TerminalInstance — links — the provider order and rows', () => {
  it('asks for the 1-based line xterm passes: row 5 of the buffer is line 6', () => {
    const { termMock } = terminalWithLines({ 5: 'https://example.com/row-five' })
    expect(linkAtColumn(termMock, 2, 6)?.text).toBe('https://example.com/row-five')
    expect(linkAtColumn(termMock, 2, 5)).toBeUndefined()
  })

  it('places the range on the 1-based columns of the link', () => {
    const { termMock } = terminalWithLines({ 0: 'see https://example.com' })
    const link = linkAtColumn(termMock, 5)
    expect([link?.range.start.x, link?.range.end.x]).toEqual([5, 23])
  })

  it('prefers the full URL over the domain inside it', () => {
    cmdClick('https://example.com/a', 10)
    expect(mockOpenExternal).toHaveBeenCalledWith('https://example.com/a')
  })

  it('finds nothing on a row past the end of the buffer', () => {
    const { termMock } = terminalWithLines({})
    expect(linkAtColumn(termMock, 0)).toBeUndefined()
  })
})

function hoveredLink(init: MouseEventInit) {
  const { termMock } = terminalWithLines({ 0: 'https://example.com' })
  const link = linkAtColumn(termMock, 2)!
  link.hover(new MouseEvent('mousemove', init), link.text)
  return link
}

describe('TerminalInstance — links — hover decorations follow the modifier key', () => {
  it('shows no underline and no pointer cursor without cmd', () => {
    const { termMock } = terminalWithLines({ 0: 'https://example.com' })
    expect(linkAtColumn(termMock, 2)?.decorations).toEqual({
      underline: false,
      pointerCursor: false,
    })
  })

  it('underlines when cmd is pressed while the link is hovered, and stops on release', () => {
    const link = hoveredLink({})
    press('keydown', 'Meta', { metaKey: true })
    expect(link.decorations).toEqual({ underline: true, pointerCursor: true })
    press('keyup', 'Meta')
    expect(link.decorations).toEqual({ underline: false, pointerCursor: false })
  })

  it('underlines a link found while cmd is already held', () => {
    const { termMock } = terminalWithLines({ 0: 'https://example.com' })
    press('keydown', 'Meta', { metaKey: true })
    expect(linkAtColumn(termMock, 2)?.decorations.underline).toBe(true)
    press('keyup', 'Meta')
  })
})

describe('TerminalInstance — links — hover decorations after the pointer leaves or the terminal is gone', () => {
  it('ignores a modifier change after the pointer left the link', () => {
    const link = hoveredLink({})
    link.leave(new MouseEvent('mousemove'), link.text)
    press('keydown', 'Meta', { metaKey: true })
    expect(link.decorations.underline).toBe(false)
    press('keyup', 'Meta')
  })

  it('stops listening to the keyboard on dispose', () => {
    const { instance, termMock } = terminalWithLines({ 0: 'https://example.com' })
    const link = linkAtColumn(termMock, 2)!
    link.hover(new MouseEvent('mousemove'), link.text)
    instance.dispose()
    press('keydown', 'Meta', { metaKey: true })
    expect(link.decorations.underline).toBe(false)
    press('keyup', 'Meta')
  })

  it('uses Ctrl off macOS', () => {
    mockPlatform = 'Win32'
    const link = hoveredLink({})
    press('keydown', 'Meta', { metaKey: true })
    expect(link.decorations.underline).toBe(false)
    press('keydown', 'Control', { ctrlKey: true })
    expect(link.decorations.underline).toBe(true)
    press('keyup', 'Control')
  })
})

describe('TerminalInstance — links — activate on cmd+click', () => {
  it('opens a URL with openExternal', () => {
    cmdClick('https://example.com', 1)
    expect(mockOpenExternal).toHaveBeenCalledWith('https://example.com')
  })

  it('opens the full URL including balanced parentheses', () => {
    const url = 'https://en.wikipedia.org/wiki/Foo_(bar)'
    cmdClick(url, 1)
    expect(mockOpenExternal).toHaveBeenCalledWith(url)
  })

  it('opens the inner path of a quoted string with a space', () => {
    cmdClick('see "/Users/foo bar/x.ts"', 6)
    expect(mockOpenPath).toHaveBeenCalledWith('/Users/foo bar/x.ts')
    cmdClick("see '/Users/foo bar/x.ts'", 6)
    expect(mockOpenPath).toHaveBeenCalledTimes(2)
  })
})

describe('TerminalInstance — links — activate on cmd+click — what is opened', () => {
  it.each([
    ['draft PR https://github.com/x/y/pull/208. Lint', 12, 'https://github.com/x/y/pull/208'],
    ['see https://example.com/a, then', 8, 'https://example.com/a'],
    ['(https://example.com/a)', 4, 'https://example.com/a'],
    ['is it https://example.com/a?', 10, 'https://example.com/a'],
    ['go to https://example.com/a!', 10, 'https://example.com/a'],
    ['with https://example.com/a; and', 10, 'https://example.com/a'],
    ['per https://example.com/a: yes', 8, 'https://example.com/a'],
    ['quoted "https://example.com/a".', 10, 'https://example.com/a'],
    ['check www.google.com.', 8, 'https://www.google.com'],
    ['check google.com.', 8, 'https://google.com'],
  ])('opens %j without the punctuation that ends it', (line, col, url) => {
    cmdClick(line, col)
    expect(mockOpenExternal).toHaveBeenCalledWith(url)
  })
})

describe('TerminalInstance — links — activate on cmd+click — punctuation and paths', () => {
  it('keeps punctuation inside a URL', () => {
    const url = 'https://example.com/a.b?q=1,2&x=y#frag.c'
    cmdClick(`${url}.`, 3)
    expect(mockOpenExternal).toHaveBeenCalledWith(url)
  })

  it.each([
    ['/Users/foo/bar', '/Users/foo/bar'],
    ['/Users/foo/bar.ts:12:3', '/Users/foo/bar.ts'],
    ['/home/user/file.go:99', '/home/user/file.go'],
    ['Wrote /Users/foo/bar.ts.', '/Users/foo/bar.ts'],
    ['Fixed in /Users/foo/bar.ts:12.', '/Users/foo/bar.ts'],
    ['File "/Users/foo/bar.ts:10:3"', '/Users/foo/bar.ts'],
    ['File "/Users/Jane Doe/foo.py", line 5', '/Users/Jane Doe/foo.py'],
  ])('opens the path in %j with openPath, without its position', (line, path) => {
    cmdClick(line, line.indexOf('/') + 2)
    expect(mockOpenPath).toHaveBeenCalledWith(path)
  })

  it('opens www. and bare domain links with https:// prepended', () => {
    cmdClick('www.google.com', 0)
    cmdClick('google.com', 0)
    expect(mockOpenExternal.mock.calls).toEqual([
      ['https://www.google.com'],
      ['https://google.com'],
    ])
  })
})

describe('TerminalInstance — links — activate on cmd+click — what is not opened', () => {
  it.each(['//example.com/path', 'src/renderer/foo.ts', 'just some output text'])(
    'recognises no link in %j',
    (line) => {
      expect(cmdClick(line, 0)).toBeUndefined()
      expect(mockOpenExternal).not.toHaveBeenCalled()
      expect(mockOpenPath).not.toHaveBeenCalled()
    }
  )
})

describe('TerminalInstance — links — activate on cmd+click — the modifier', () => {
  it('opens nothing without cmd, and nothing for ctrl on macOS', () => {
    cmdClick('https://example.com', 1, {})
    cmdClick('https://example.com', 1, { ctrlKey: true })
    expect(mockOpenExternal).not.toHaveBeenCalled()
  })

  it('opens with ctrl off macOS, and not with cmd', () => {
    mockPlatform = 'Win32'
    cmdClick('https://example.com', 1, { metaKey: true })
    expect(mockOpenExternal).not.toHaveBeenCalled()
    cmdClick('https://example.com', 1, { ctrlKey: true })
    expect(mockOpenExternal).toHaveBeenCalledWith('https://example.com')
  })

  it('swallows a refusal to open, so a click never throws', async () => {
    mockOpenExternal.mockRejectedValueOnce(new Error('no browser'))
    mockOpenPath.mockRejectedValueOnce(new Error('no app'))
    cmdClick('https://example.com', 0)
    cmdClick('/tmp/a.txt', 0)
    await Promise.allSettled(
      [...mockOpenExternal.mock.results, ...mockOpenPath.mock.results].map((call) => call.value)
    )
    expect(mockOpenExternal).toHaveBeenCalledWith('https://example.com')
    expect(mockOpenPath).toHaveBeenCalledWith('/tmp/a.txt')
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
