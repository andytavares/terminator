import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// loader.ts uses import.meta.glob which is a Vite build-time feature.
// We test `initExtensions` directly by injecting `renderers` and `dynamicLoader`
// via the optional parameter object — this exercises all branches of the real function.

const fakeLoad = vi.fn().mockResolvedValue(undefined)
const fakeDynamicImport = vi.fn().mockResolvedValue(undefined)

const fakeRenderers: Record<string, () => Promise<unknown>> = {
  '../../../extensions/git-integration/src/renderer.tsx': fakeLoad,
  '../../../extensions/task-vault/src/renderer.tsx': fakeLoad,
  '../../../extensions/speckit-pilot/src/renderer.tsx': fakeLoad,
  // An entry that doesn't match the pattern — exercises the `if (!match) continue` branch
  '../../../extensions/no-match/renderer.js': fakeLoad,
}

const mockList = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  ;(globalThis as unknown as Record<string, unknown>).window = {
    electronAPI: { extension: { list: mockList } },
  }
})

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).window
})

async function callInit(
  extensions: { id: string; status: string; rendererUrl?: string }[]
): Promise<void> {
  mockList.mockResolvedValue({ extensions })
  const { initExtensions } = await import('../../../../src/renderer/extensions/loader')
  return initExtensions({ renderers: fakeRenderers, dynamicLoader: fakeDynamicImport })
}

describe('initExtensions — bundled extension loading', () => {
  it('calls list to get active extensions', async () => {
    await callInit([])
    expect(mockList).toHaveBeenCalledTimes(1)
  })

  it('loads renderer for enabled extension matching directory name exactly', async () => {
    await callInit([{ id: 'git-integration', status: 'enabled' }])
    expect(fakeLoad).toHaveBeenCalledTimes(1)
  })

  it('loads renderer for enabled extension matched by last dot-segment of id', async () => {
    await callInit([{ id: 'terminator.task-vault', status: 'enabled' }])
    expect(fakeLoad).toHaveBeenCalledTimes(1)
  })

  it('loads multiple renderers when multiple extensions are enabled', async () => {
    await callInit([
      { id: 'git-integration', status: 'enabled' },
      { id: 'task-vault', status: 'enabled' },
    ])
    expect(fakeLoad).toHaveBeenCalledTimes(2)
  })

  it('does not load renderer for disabled extension', async () => {
    await callInit([{ id: 'git-integration', status: 'disabled' }])
    expect(fakeLoad).not.toHaveBeenCalled()
  })

  it('does not load renderer when no extensions are active', async () => {
    await callInit([])
    expect(fakeLoad).not.toHaveBeenCalled()
  })

  it('does not load renderer for an extension id that does not match any directory', async () => {
    await callInit([{ id: 'nonexistent-extension', status: 'enabled' }])
    expect(fakeLoad).not.toHaveBeenCalled()
  })

  it('loads all enabled renderers and skips disabled ones', async () => {
    await callInit([
      { id: 'git-integration', status: 'enabled' },
      { id: 'speckit-pilot', status: 'disabled' },
    ])
    expect(fakeLoad).toHaveBeenCalledTimes(1)
  })

  it('skips entries whose path does not match the expected renderer pattern', async () => {
    await callInit([{ id: 'no-match', status: 'enabled' }])
    // The no-match entry uses renderer.js (not renderer.tsx), so regex won't match
    expect(fakeLoad).not.toHaveBeenCalled()
  })
})

describe('initExtensions — external extension loading', () => {
  it('dynamically imports external extension renderer when rendererUrl is set', async () => {
    await callInit([
      {
        id: 'com.example.my-plugin',
        status: 'enabled',
        rendererUrl: 'ext://com.example.my-plugin/dist/renderer.js',
      },
    ])
    expect(fakeLoad).not.toHaveBeenCalled()
    expect(fakeDynamicImport).toHaveBeenCalledWith('ext://com.example.my-plugin/dist/renderer.js')
  })

  it('does not dynamically import bundled extensions even if they have rendererUrl', async () => {
    await callInit([
      {
        id: 'git-integration',
        status: 'enabled',
        rendererUrl: 'ext://git-integration/dist/renderer.js',
      },
    ])
    expect(fakeLoad).toHaveBeenCalledTimes(1)
    expect(fakeDynamicImport).not.toHaveBeenCalled()
  })

  it('skips external extension with no rendererUrl', async () => {
    await callInit([{ id: 'com.example.no-renderer', status: 'enabled' }])
    expect(fakeDynamicImport).not.toHaveBeenCalled()
  })

  it('loads multiple external renderers', async () => {
    await callInit([
      { id: 'com.a', status: 'enabled', rendererUrl: 'ext://com.a/renderer.js' },
      { id: 'com.b', status: 'enabled', rendererUrl: 'ext://com.b/renderer.js' },
    ])
    expect(fakeDynamicImport).toHaveBeenCalledTimes(2)
  })
})

// Test the real module import + the window exposure global
describe('initExtensions (real module)', () => {
  it('exports an initExtensions function', async () => {
    const mod = await import('../../../../src/renderer/extensions/loader')
    expect(typeof mod.initExtensions).toBe('function')
  })

  it('sets __terminatorRegistry on window when window is defined', async () => {
    vi.resetModules()
    const fakeWindow: Record<string, unknown> = {}
    ;(globalThis as unknown as { window: unknown }).window = fakeWindow
    await import('../../../../src/renderer/extensions/loader')
    expect(fakeWindow.__terminatorRegistry).toBeDefined()
    delete (globalThis as unknown as { window?: unknown }).window
    vi.resetModules()
  })

  it('can be called with electronAPI returning empty list', async () => {
    const mockElectronAPI = {
      extension: { list: vi.fn().mockResolvedValue({ extensions: [] }) },
    }
    ;(globalThis as unknown as { window: unknown }).window = { electronAPI: mockElectronAPI }
    const { initExtensions } = await import('../../../../src/renderer/extensions/loader')
    await expect(initExtensions({ renderers: {}, dynamicLoader: vi.fn() })).resolves.toBeUndefined()
    delete (globalThis as unknown as { window?: unknown }).window
  })

  it('default dynamicLoader is invoked for external extensions', async () => {
    vi.resetModules()
    const mockElectronAPI = {
      extension: {
        list: vi.fn().mockResolvedValue({
          extensions: [
            { id: 'com.ext.test', status: 'enabled', rendererUrl: 'ext://com.ext.test/r.js' },
          ],
        }),
      },
    }
    ;(globalThis as unknown as { window: unknown }).window = { electronAPI: mockElectronAPI }
    const { initExtensions } = await import('../../../../src/renderer/extensions/loader')
    // No dynamicLoader injected — the default (url => import(url)) is used.
    // It will reject in Node since ext:// is not a resolvable module specifier.
    await expect(initExtensions({ renderers: {} })).rejects.toBeDefined()
    delete (globalThis as unknown as { window?: unknown }).window
    vi.resetModules()
  })
})
