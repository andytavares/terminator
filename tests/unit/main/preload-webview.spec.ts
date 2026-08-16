// @vitest-environment jsdom
// The preload runs in a renderer context: it needs a real `window` to attach
// the double-Escape exit listener to.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const exposed: Record<string, unknown> = {}
const mockSend = vi.fn()

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (key: string, value: unknown) => {
      exposed[key] = value
    },
  },
  ipcRenderer: {
    invoke: vi.fn(),
    send: mockSend,
    on: vi.fn(),
    removeListener: vi.fn(),
  },
}))

vi.mock('../../../src/main/shared/reserved-shortcuts.js', () => ({
  RESERVED_SHORTCUTS: new Set<string>(),
}))

describe('preload-webview', () => {
  beforeEach(async () => {
    Object.keys(exposed).forEach((k) => delete exposed[k])
    mockSend.mockClear()
    vi.resetModules()
    await import('../../../src/main/preload-webview.js')
  })

  it('exposes electronAPI via contextBridge', () => {
    expect(exposed).toHaveProperty('electronAPI')
  })

  it('exposes all required top-level namespaces', () => {
    const api = exposed['electronAPI'] as Record<string, unknown>
    const required = [
      'terminal',
      'workspace',
      'project',
      'git',
      'settings',
      'dialog',
      'extension',
      'keyboard',
      'shell',
      'fs',
      'extensionEvents',
      'app',
      'extensionBridge',
      'notifications',
      'db',
      'metrics',
      'logger',
    ]
    for (const ns of required) {
      expect(api, `namespace '${ns}' is missing`).toHaveProperty(ns)
    }
  })

  it('exposes extensionBridge.on and extensionBridge.invoke', () => {
    const api = exposed['electronAPI'] as Record<string, Record<string, unknown>>
    expect(typeof api['extensionBridge']['on']).toBe('function')
    expect(typeof api['extensionBridge']['invoke']).toBe('function')
  })

  it('exposes workspace.list as a function', () => {
    const api = exposed['electronAPI'] as Record<string, Record<string, unknown>>
    expect(typeof api['workspace']['list']).toBe('function')
  })

  describe('double-Escape exit gesture', () => {
    function pressEscape(times: number): void {
      for (let i = 0; i < times; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      }
    }

    it('stays silent on a single Escape so the extension keeps its own', () => {
      pressEscape(1)
      expect(mockSend).not.toHaveBeenCalled()
    })

    it('requests an exit on a second Escape', () => {
      pressEscape(2)
      expect(mockSend).toHaveBeenCalledWith('extension:request-exit')
    })

    it('does not let the extension cancel the gesture with preventDefault', () => {
      // The first press is genuinely the extension's; the exit is about what the
      // user does next, so a handled first Escape must not disarm the second.
      window.addEventListener('keydown', (e) => e.preventDefault())
      pressEscape(2)
      expect(mockSend).toHaveBeenCalledWith('extension:request-exit')
    })

    it('ignores other keys', () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
      expect(mockSend).not.toHaveBeenCalled()
    })
  })
})
