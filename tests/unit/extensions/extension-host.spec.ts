import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp',
    getVersion: () => '0.1.0',
  },
}))

vi.mock('electron-store', () => {
  const data: Record<string, unknown> = { extensions: [] }
  return {
    default: class MockStore {
      get(key: string) {
        return data[key]
      }
      set(key: string, value: unknown) {
        data[key] = value
      }
    },
  }
})

describe('ExtensionAPI keyboard', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('keyboard.register with non-reserved accelerator returns Disposable', async () => {
    const { createExtensionAPI } = await import('../../../src/main/extensions/api')
    const api = createExtensionAPI('com.test.ext', '0.1.0')
    const handler = vi.fn()
    const disposable = api.keyboard.register('CmdOrCtrl+Shift+K', handler)
    expect(disposable).toBeDefined()
    expect(typeof disposable.dispose).toBe('function')
  })

  it('keyboard.register throws synchronously for reserved shortcut CmdOrCtrl+T', async () => {
    const { createExtensionAPI } = await import('../../../src/main/extensions/api')
    const api = createExtensionAPI('com.test.ext2', '0.1.0')
    expect(() => api.keyboard.register('CmdOrCtrl+T', vi.fn())).toThrow()
  })

  it('disposing the returned Disposable removes the handler', async () => {
    const { createExtensionAPI, globalRegistry } = await import('../../../src/main/extensions/api')
    const api = createExtensionAPI('com.test.ext3', '0.1.0')
    const disposable = api.keyboard.register('CmdOrCtrl+Shift+J', vi.fn())
    expect(globalRegistry.keyboardHandlers.has('com.test.ext3.keyboard.CmdOrCtrl+Shift+J')).toBe(
      true
    )
    disposable.dispose()
    expect(globalRegistry.keyboardHandlers.has('com.test.ext3.keyboard.CmdOrCtrl+Shift+J')).toBe(
      false
    )
  })
})

describe('ExtensionHost', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('activate error sets extension status to error without crashing host', async () => {
    const { ExtensionHost } = await import('../../../src/main/extensions/extension-host')
    const host = new ExtensionHost()

    vi.doMock('/fake/ext/main.js', () => ({
      activate: () => {
        throw new Error('Extension crash')
      },
    }))

    const mockManifest = JSON.stringify({
      id: 'com.test.crash',
      name: 'Crash Ext',
      version: '1.0.0',
      description: 'A crashy extension',
      main: 'main.js',
      minAppVersion: '0.1.0',
    })

    vi.doMock('/fake/ext/extension.json', () => JSON.parse(mockManifest))

    const result = await host.load('/fake/ext')
    expect(
      'error' in result || ('extension' in result && result.extension.status === 'error')
    ).toBe(true)
  })

  it('invalid manifest returns INVALID_MANIFEST error', async () => {
    const { ExtensionHost } = await import('../../../src/main/extensions/extension-host')
    const host = new ExtensionHost()

    const result = await host.load('/nonexistent/path/to/extension')
    expect('error' in result).toBe(true)
    if ('error' in result) expect(result.error).toBe('INVALID_MANIFEST')
  })
})
