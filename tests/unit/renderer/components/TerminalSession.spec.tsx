import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TerminalInstance } from '../../../../src/renderer/components/terminal/TerminalSession'

const mockResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  disconnect: vi.fn(),
}))
vi.stubGlobal('ResizeObserver', mockResizeObserver)

// Mock xterm and its addons
vi.mock('xterm', () => {
  const Terminal = vi.fn().mockImplementation(() => ({
    loadAddon: vi.fn(),
    onData: vi.fn(),
    onResize: vi.fn(),
    onBell: vi.fn(),
    open: vi.fn(),
    focus: vi.fn(),
    write: vi.fn(),
    dispose: vi.fn(),
    scrollToBottom: vi.fn(),
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

const mockOnOutput = vi.fn()
const mockInput = vi.fn()
const mockResize = vi.fn()
const mockUnsubscribe = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
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
})
