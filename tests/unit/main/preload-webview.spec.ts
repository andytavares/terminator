import { describe, it, expect, vi, beforeEach } from 'vitest'

const exposed: Record<string, unknown> = {}

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (key: string, value: unknown) => {
      exposed[key] = value
    },
  },
  ipcRenderer: {
    invoke: vi.fn(),
    send: vi.fn(),
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
      'notification',
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
})
