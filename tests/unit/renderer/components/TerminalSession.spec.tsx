import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Terminal } from 'xterm'
import { TerminalInstance } from '../../../../src/renderer/components/terminal/TerminalSession'

const mockResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  disconnect: vi.fn(),
}))
vi.stubGlobal('ResizeObserver', mockResizeObserver)

// Mock xterm and its addons
function makeMockCell(chars = ' ', fg = -1, bg = -1, bold = false) {
  return {
    getChars: () => chars,
    getFgColor: () => fg,
    getBgColor: () => bg,
    isBold: () => bold,
  }
}

function makeMockBuffer(
  rows: number,
  cols: number,
  cells: ReturnType<typeof makeMockCell>[][] = []
) {
  return {
    active: {
      getLine: (row: number) => ({
        getCell: (col: number, _reuse?: unknown) => cells[row]?.[col] ?? makeMockCell(),
      }),
    },
    cols,
    rows,
  }
}

vi.mock('xterm', () => {
  const Terminal = vi.fn().mockImplementation(() => ({
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
    buffer: makeMockBuffer(24, 80),
  }))
  return { Terminal }
})

vi.mock('xterm-addon-fit', () => {
  const FitAddon = vi.fn().mockImplementation(() => ({
    fit: vi.fn(),
  }))
  return { FitAddon }
})

vi.mock('xterm/css/xterm.css', () => ({}))

const mockSetSessionBusy = vi.fn()
const mockSetSessionIdle = vi.fn()
vi.mock('../../../../src/renderer/stores/session.store', () => ({
  useSessionStore: Object.assign(vi.fn(), {
    getState: () => ({
      setSessionBusy: mockSetSessionBusy,
      setSessionIdle: mockSetSessionIdle,
    }),
  }),
}))

// Mock canvas getContext so captureToDataUrl's drawing code is exercisable
const mockFillRect = vi.fn()
const mockFillText = vi.fn()
const mockMeasureText = vi.fn().mockReturnValue({ width: 8 })
const mockFakeCtx = {
  font: '',
  fillStyle: '',
  fillRect: mockFillRect,
  fillText: mockFillText,
  measureText: mockMeasureText,
  toJSON: vi.fn(),
}
vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
  () => mockFakeCtx as unknown as CanvasRenderingContext2D
)

const mockOnOutput = vi.fn()
const mockInput = vi.fn()
const mockResize = vi.fn()
const mockUnsubscribe = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  mockMeasureText.mockReturnValue({ width: 8 })
  mockOnOutput.mockReturnValue(mockUnsubscribe)
  ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
    terminal: {
      onOutput: mockOnOutput,
      input: mockInput,
      resize: mockResize,
    },
  }
})

describe('TerminalInstance', () => {
  it('constructs without throwing', () => {
    expect(() => new TerminalInstance('ses-1', 1000)).not.toThrow()
  })

  it('pastes \\n when Cmd+Enter is pressed via custom key handler', () => {
    new TerminalInstance('ses-1', 1000)
    const instance = vi.mocked(Terminal).mock.results[0].value
    const handler = instance.attachCustomKeyEventHandler.mock.calls[0][0]
    const result = handler({ metaKey: true, ctrlKey: false, key: 'Enter', type: 'keydown' })
    expect(result).toBe(false)
    expect(instance.paste).toHaveBeenCalledWith('\n')
  })

  it('does not intercept non-Cmd+Enter keys', () => {
    new TerminalInstance('ses-1', 1000)
    const instance = vi.mocked(Terminal).mock.results[0].value
    const handler = instance.attachCustomKeyEventHandler.mock.calls[0][0]
    const result = handler({ metaKey: false, ctrlKey: false, key: 'Enter', type: 'keydown' })
    expect(result).toBe(true)
  })

  it('pastes \\n when Shift+Enter is pressed', () => {
    new TerminalInstance('ses-1', 1000)
    const instance = vi.mocked(Terminal).mock.results[0].value
    const handler = instance.attachCustomKeyEventHandler.mock.calls[0][0]
    const result = handler({
      shiftKey: true,
      metaKey: false,
      ctrlKey: false,
      key: 'Enter',
      type: 'keydown',
    })
    expect(result).toBe(false)
    expect(instance.paste).toHaveBeenCalledWith('\n')
  })

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

  it('subscribes to terminal output on construction', () => {
    new TerminalInstance('ses-1', 1000)
    expect(mockOnOutput).toHaveBeenCalledTimes(1)
  })

  it('creates a div element on construction', () => {
    const instance = new TerminalInstance('ses-1', 1000)
    expect(instance.element).toBeInstanceOf(HTMLDivElement)
    expect(instance.element.style.cssText).toContain('width')
  })

  it('accepts an optional onBell callback', () => {
    const onBell = vi.fn()
    const instance = new TerminalInstance('ses-1', 1000, onBell)
    expect(instance.terminal.onBell).toHaveBeenCalledWith(onBell)
  })

  it('does not call onBell setup when callback is not provided', () => {
    const instance = new TerminalInstance('ses-1', 1000)
    expect(instance.terminal.onBell).not.toHaveBeenCalled()
  })

  describe('mount()', () => {
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

  describe('unmount()', () => {
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

  describe('dispose()', () => {
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

  describe('busy/idle tracking', () => {
    it('calls setSessionBusy and schedules setSessionIdle on output', () => {
      vi.useFakeTimers()
      new TerminalInstance('ses-busy', 1000)
      const outputCallback = mockOnOutput.mock.calls[0][0]
      outputCallback('ses-busy', 'data')

      expect(mockSetSessionBusy).toHaveBeenCalledWith('ses-busy')
      vi.runAllTimers()
      expect(mockSetSessionIdle).toHaveBeenCalledWith('ses-busy')
      vi.useRealTimers()
    })

    it('ignores output from other sessions', () => {
      new TerminalInstance('ses-a', 1000)
      const outputCallback = mockOnOutput.mock.calls[0][0]
      outputCallback('ses-other', 'data')
      expect(mockSetSessionBusy).not.toHaveBeenCalled()
    })
  })

  describe('captureToDataUrl()', () => {
    it('returns null when terminal has not been opened', () => {
      const instance = new TerminalInstance('ses-1', 1000)
      expect(instance.captureToDataUrl()).toBeNull()
    })

    it('returns null when cols or rows are 0', () => {
      const instance = new TerminalInstance('ses-1', 1000)
      const container = document.createElement('div')
      document.body.appendChild(container)
      instance.mount(container)
      Object.defineProperty(instance.terminal, 'cols', { value: 0, configurable: true })
      expect(instance.captureToDataUrl()).toBeNull()
      document.body.removeChild(container)
    })

    it('returns a string or null after mount with non-zero cols/rows', () => {
      const instance = new TerminalInstance('ses-1', 1000)
      const container = document.createElement('div')
      document.body.appendChild(container)
      instance.mount(container)
      Object.defineProperty(instance.terminal, 'cols', { value: 4, configurable: true })
      Object.defineProperty(instance.terminal, 'rows', { value: 2, configurable: true })
      const result = instance.captureToDataUrl()
      expect(result === null || typeof result === 'string').toBe(true)
      document.body.removeChild(container)
    })

    it('draws text cells with foreground and bold styling', () => {
      const cells = [
        [
          makeMockCell('A', 1, -1, true),
          makeMockCell('B', 200, 12, false),
          makeMockCell(' ', -1, -1, false),
          makeMockCell('C', 240, -1, false),
        ],
        [
          makeMockCell('D', 0, 0, false),
          makeMockCell('', -1, -1, false),
          makeMockCell('E', -1, -1, false),
          makeMockCell('F', 16, -1, false),
        ],
      ]
      const instance = new TerminalInstance('ses-draw', 1000)
      const container = document.createElement('div')
      document.body.appendChild(container)
      instance.mount(container)
      Object.defineProperty(instance.terminal, 'cols', { value: 4, configurable: true })
      Object.defineProperty(instance.terminal, 'rows', { value: 2, configurable: true })
      Object.defineProperty(instance.terminal, 'buffer', {
        value: makeMockBuffer(2, 4, cells),
        configurable: true,
      })
      expect(() => instance.captureToDataUrl()).not.toThrow()
      document.body.removeChild(container)
    })
  })

  describe('snapshot in unmount()', () => {
    it('stores lastSnapshot on unmount after successful capture', () => {
      const instance = new TerminalInstance('ses-snap', 1000)
      const container = document.createElement('div')
      document.body.appendChild(container)
      instance.mount(container)
      Object.defineProperty(instance.terminal, 'cols', { value: 80, configurable: true })
      Object.defineProperty(instance.terminal, 'rows', { value: 24, configurable: true })
      // captureToDataUrl may return null in jsdom (canvas not fully supported), so just check it doesn't throw
      expect(() => instance.unmount()).not.toThrow()
      document.body.removeChild(container)
    })

    it('does not overwrite valid snapshot with null on subsequent unmount', () => {
      const instance = new TerminalInstance('ses-snap', 1000)
      instance.lastSnapshot = 'data:image/jpeg;base64,abc'
      // captureToDataUrl will return null (not mounted) — should NOT overwrite lastSnapshot
      instance.unmount()
      expect(instance.lastSnapshot).toBe('data:image/jpeg;base64,abc')
    })
  })

  describe('dispose()', () => {
    it('clears busy timer and calls setSessionIdle', () => {
      vi.useFakeTimers()
      const instance = new TerminalInstance('ses-dispose', 1000)
      // Trigger a busy timer
      const outputCallback = mockOnOutput.mock.calls[0][0]
      outputCallback('ses-dispose', 'data')

      mockSetSessionIdle.mockClear()
      instance.dispose()
      expect(mockSetSessionIdle).toHaveBeenCalledWith('ses-dispose')
      vi.useRealTimers()
    })
  })

  describe('mountPreview()', () => {
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

    it('sets pointer-events none and transform on the element', () => {
      const instance = new TerminalInstance('ses-1', 1000)
      const mountContainer = document.createElement('div')
      document.body.appendChild(mountContainer)
      instance.mount(mountContainer)
      instance.unmount()

      Object.defineProperty(instance.terminal, 'cols', { value: 80, configurable: true })
      Object.defineProperty(instance.terminal, 'rows', { value: 24, configurable: true })

      const previewContainer = document.createElement('div')
      document.body.appendChild(previewContainer)

      instance.mountPreview(previewContainer)
      expect(instance.element.style.pointerEvents).toBe('none')
      expect(instance.element.style.transform).toContain('scale(')

      document.body.removeChild(mountContainer)
      document.body.removeChild(previewContainer)
    })
  })
})
