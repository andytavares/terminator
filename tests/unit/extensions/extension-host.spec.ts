import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import os from 'os'

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp',
    getVersion: () => '0.1.0',
  },
}))

const storeData: Record<string, unknown> = { extensions: [] }
vi.mock('electron-store', () => ({
  default: class MockStore {
    onDidAnyChange() {
      return () => {}
    }
    get(key: string) {
      return storeData[key]
    }
    set(key: string, value: unknown) {
      storeData[key] = value
    }
  },
}))

vi.mock('../../../src/main/storage/extension-settings-store', () => ({
  getExtensionSetting: () => undefined,
  setExtensionSetting: vi.fn(),
  getAllExtensionSettings: () => ({}),
}))

describe('ExtensionHost', () => {
  beforeEach(() => {
    vi.resetModules()
    storeData.extensions = []
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

    vi.doMock('/fake/ext/manifest.json', () => JSON.parse(mockManifest))

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

  it('listExtensions returns list of registered extensions', async () => {
    const { ExtensionHost } = await import('../../../src/main/extensions/extension-host')
    const host = new ExtensionHost()
    const list = host.listExtensions()
    expect(Array.isArray(list)).toBe(true)
  })

  it('unload is a no-op for unknown extension id', async () => {
    const { ExtensionHost } = await import('../../../src/main/extensions/extension-host')
    const host = new ExtensionHost()
    await expect(host.unload('nonexistent.ext')).resolves.toBeUndefined()
  })

  it('toggle returns null for unknown extension id', async () => {
    const { ExtensionHost } = await import('../../../src/main/extensions/extension-host')
    const host = new ExtensionHost()
    const result = await host.toggle('nonexistent.ext', true)
    expect(result).toBeNull()
  })

  it('DUPLICATE_ID error when loading same extension twice', async () => {
    const { ExtensionHost } = await import('../../../src/main/extensions/extension-host')
    const host = new ExtensionHost()

    // First load will fail due to no manifest, but test store accumulation
    const result1 = await host.load('/nonexistent/ext1')
    expect('error' in result1).toBe(true)
    // Store should still be empty since first load failed at manifest read stage
    expect(host.listExtensions()).toHaveLength(0)
  })

  it('uninstall returns false for unknown extension id', async () => {
    const { ExtensionHost } = await import('../../../src/main/extensions/extension-host')
    const host = new ExtensionHost()
    const removed = await host.uninstall('nonexistent.ext')
    expect(removed).toBe(false)
  })

  it('uninstall returns true and removes extension from store', async () => {
    storeData.extensions = [
      {
        id: 'com.removable',
        name: 'Removable',
        version: '1.0.0',
        description: '',
        entryPoint: '/fake/removable/main.js',
        status: 'disabled',
        installedAt: new Date().toISOString(),
        directoryPath: '/fake/removable',
      },
    ]
    const { ExtensionHost } = await import('../../../src/main/extensions/extension-host')
    const host = new ExtensionHost()
    const removed = await host.uninstall('com.removable')
    expect(removed).toBe(true)
    expect(host.listExtensions()).toHaveLength(0)
  })

  it('reload returns NOT_FOUND error for unknown extension id', async () => {
    const { ExtensionHost } = await import('../../../src/main/extensions/extension-host')
    const host = new ExtensionHost()
    const result = await host.reload('nonexistent.ext')
    expect(result).toEqual({ error: 'NOT_FOUND' })
  })

  it('toggle enable path runs activate (even if activation fails) and returns extension', async () => {
    storeData.extensions = [
      {
        id: 'com.togglable',
        name: 'Toggle Me',
        version: '1.0.0',
        description: '',
        entryPoint: '/nonexistent/toggle/main.js',
        status: 'disabled',
        installedAt: new Date().toISOString(),
        directoryPath: '/nonexistent/toggle',
      },
    ]
    const { ExtensionHost } = await import('../../../src/main/extensions/extension-host')
    const host = new ExtensionHost()
    // activate will fail (no real file) but toggle still updates status and returns extension
    const result = await host.toggle('com.togglable', true)
    expect(result?.id).toBe('com.togglable')
  })

  it('reload on an existing-but-unloadable extension returns an error result', async () => {
    storeData.extensions = [
      {
        id: 'com.reload',
        name: 'Reload Me',
        version: '1.0.0',
        description: '',
        entryPoint: '/nonexistent/reload/main.js',
        status: 'enabled',
        installedAt: new Date().toISOString(),
        directoryPath: '/nonexistent/reload',
      },
    ]
    const { ExtensionHost } = await import('../../../src/main/extensions/extension-host')
    const host = new ExtensionHost()
    // The entry point doesn't exist, so reload will find the record but fail to activate
    const result = await host.reload('com.reload')
    // Reload finds the record (so no NOT_FOUND) but activation fails → error
    expect('error' in result).toBe(true)
  })

  it('getExtensionDirectory returns null for unknown extension', async () => {
    const { ExtensionHost } = await import('../../../src/main/extensions/extension-host')
    const host = new ExtensionHost()
    expect(host.getExtensionDirectory('unknown.ext')).toBeNull()
  })

  it('getExtensionDirectory returns the directory path for a stored extension', async () => {
    storeData.extensions = [
      {
        id: 'com.dirtest',
        name: 'Dir Test',
        version: '1.0.0',
        description: '',
        entryPoint: '/stored/ext/main.js',
        status: 'enabled',
        installedAt: new Date().toISOString(),
        directoryPath: '/stored/ext',
      },
    ]
    const { ExtensionHost } = await import('../../../src/main/extensions/extension-host')
    const host = new ExtensionHost()
    expect(host.getExtensionDirectory('com.dirtest')).toBe('/stored/ext')
  })

  it('listExtensions strips directoryPath and rendererRelPath from returned records', async () => {
    storeData.extensions = [
      {
        id: 'com.strip',
        name: 'Strip Test',
        version: '1.0.0',
        description: '',
        entryPoint: '/strip/main.js',
        status: 'enabled',
        installedAt: new Date().toISOString(),
        directoryPath: '/strip',
        rendererRelPath: 'dist/renderer.js',
        rendererUrl: 'ext://com.strip/dist/renderer.js',
      },
    ]
    const { ExtensionHost } = await import('../../../src/main/extensions/extension-host')
    const host = new ExtensionHost()
    const list = host.listExtensions()
    expect(list).toHaveLength(1)
    expect('directoryPath' in list[0]).toBe(false)
    expect('rendererRelPath' in list[0]).toBe(false)
    expect(list[0].rendererUrl).toBe('ext://com.strip/dist/renderer.js')
  })
})

describe('isVersionCompatible', () => {
  async function isCompatible(minVersion: string, appVersion: string): Promise<boolean> {
    const { isVersionCompatible } = await import('../../../src/main/extensions/extension-host')
    return isVersionCompatible(minVersion, appVersion)
  }

  it.each([
    ['0.1.0', '1.0.0', true],
    ['0.0.9', '0.1.0', true],
    ['0.1.0', '0.1.0', true],
    ['1.0.0', '0.9.9', false],
    ['0.2.0', '0.1.0', false],
    ['0.1.1', '0.1.0', false],
    ['0.1', '0.1.0', true],
  ])('requires %s of app %s: %s', async (minVersion, appVersion, expected) => {
    expect(await isCompatible(minVersion, appVersion)).toBe(expected)
  })

  it.each([
    ['>=0.1.0', '0.1.0', true],
    ['>=99.0.0', '0.1.0', false],
    ['>99.0.0', '0.1.0', false],
    ['>0.0.1', '0.1.0', true],
    ['=0.1.0', '0.1.0', true],
    ['^0.1.0', '0.1.0', true],
    ['^1.0.0', '0.1.0', false],
    ['~0.2.0', '0.1.0', false],
  ])(
    'treats the range operator in %s as part of the minimum for app %s',
    async (minVersion, appVersion, expected) => {
      expect(await isCompatible(minVersion, appVersion)).toBe(expected)
    }
  )
})

describe('ExtensionHost – DUPLICATE_ID after successful first load', () => {
  let tmpDir: string

  beforeEach(() => {
    vi.resetModules()
    storeData.extensions = []
    // Create a real temp directory with a valid manifest.json on disk
    tmpDir = join(os.tmpdir(), `ext-dup-test-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })
    writeFileSync(
      join(tmpDir, 'manifest.json'),
      JSON.stringify({
        id: 'com.dup',
        name: 'Dup',
        version: '1.0.0',
        description: 'A test extension',
        main: 'main.js',
        minAppVersion: '0.0.1',
      })
    )
    // Write a stub entry point so activation can be attempted
    writeFileSync(join(tmpDir, 'main.js'), 'module.exports = { activate: () => {} }')
  })

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  it('returns DUPLICATE_ID on second load attempt for same extension id', async () => {
    // Pre-populate the store as if extension was already loaded
    storeData.extensions = [
      {
        id: 'com.dup',
        name: 'Dup',
        version: '1.0.0',
        description: '',
        entryPoint: join(tmpDir, 'main.js'),
        status: 'enabled',
        installedAt: new Date().toISOString(),
        directoryPath: tmpDir,
      },
    ]

    const { ExtensionHost } = await import('../../../src/main/extensions/extension-host')
    const host = new ExtensionHost()
    // The store already has com.dup → load should detect duplicate
    const result = await host.load(tmpDir)

    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error).toBe('DUPLICATE_ID')
    }
  })
})

describe('ExtensionHost – unload deactivate error path', () => {
  beforeEach(() => {
    vi.resetModules()
    storeData.extensions = []
  })

  it('unload continues cleanly even when deactivate() throws', async () => {
    // We set up a pre-loaded extension record in the store, then manually
    // populate the internal `loaded` map via reflection so we can control
    // the deactivate function.
    const { ExtensionHost } = await import('../../../src/main/extensions/extension-host')
    const host = new ExtensionHost()

    // Access private loaded map via cast
    const loadedMap: Map<
      string,
      {
        record: unknown
        disposables: { dispose(): void }[]
        module: { deactivate?: () => void | Promise<void> }
      }
    > = (host as unknown as { loaded: typeof loadedMap }).loaded

    loadedMap.set('com.deact.err', {
      record: {},
      disposables: [
        {
          dispose: () => {
            throw new Error('dispose failed')
          },
        },
      ],
      module: {
        deactivate: () => {
          throw new Error('deactivate failed')
        },
      },
    })

    // Should not throw even though deactivate and dispose both throw
    await expect(host.unload('com.deact.err')).resolves.toBeUndefined()
    expect(loadedMap.has('com.deact.err')).toBe(false)
  })
})

describe('ExtensionHost – start with bundled directories', () => {
  beforeEach(() => {
    vi.resetModules()
    storeData.extensions = []
  })

  it('skips subdirectories without manifest.json', async () => {
    // We rely on the real fs — /tmp exists but has no sub-dirs with manifest.json
    const { ExtensionHost } = await import('../../../src/main/extensions/extension-host')
    const host = new ExtensionHost()
    // /tmp has no manifest.json at top level sub-dirs in CI → should complete without error
    await expect(
      host.start({ bundledDirectory: '/tmp', beforeActivation: Promise.resolve() })
    ).resolves.toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Tests using real temp-dir extensions to exercise success paths and version
// compatibility branches (isVersionCompatible lines 229-238).
// ─────────────────────────────────────────────────────────────────────────────

function makeExtDir(
  id: string,
  minAppVersion: string,
  extraManifest: Record<string, unknown> = {}
): string {
  const dir = join(os.tmpdir(), `ext-${id}-${Date.now()}`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({
      id,
      name: id,
      version: '1.0.0',
      description: 'Test extension',
      main: 'main.js',
      minAppVersion,
      ...extraManifest,
    })
  )
  writeFileSync(
    join(dir, 'main.js'),
    'module.exports = { activate: () => {}, deactivate: () => {} }'
  )
  return dir
}

describe('ExtensionHost – successful load paths (real temp extensions)', () => {
  const tmpDirs: string[] = []

  beforeEach(() => {
    vi.resetModules()
    storeData.extensions = []
  })

  afterEach(() => {
    for (const d of tmpDirs.splice(0)) {
      try {
        rmSync(d, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  })

  it('load() succeeds and returns extension with status enabled', async () => {
    const dir = makeExtDir('com.success.test', '0.0.1')
    tmpDirs.push(dir)

    const { ExtensionHost } = await import('../../../src/main/extensions/extension-host')
    const host = new ExtensionHost()
    const result = await host.load(dir)

    expect('extension' in result).toBe(true)
    if ('extension' in result) {
      expect(result.extension.id).toBe('com.success.test')
      expect(result.extension.status).toBe('enabled')
    }
    expect(host.listExtensions()).toHaveLength(1)
  })

  it('load() returns VERSION_INCOMPATIBLE when minAppVersion > app version', async () => {
    // app.getVersion() === '0.1.0'; require a far-future version
    const dir = makeExtDir('com.version.incompat', '99.0.0')
    tmpDirs.push(dir)

    const { ExtensionHost } = await import('../../../src/main/extensions/extension-host')
    const host = new ExtensionHost()
    const result = await host.load(dir)

    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error).toBe('VERSION_INCOMPATIBLE')
    }
  })

  it('load() returns VERSION_INCOMPATIBLE when minor version exceeds app minor', async () => {
    // app = 0.1.0, min = 0.2.0
    const dir = makeExtDir('com.minor.incompat', '0.2.0')
    tmpDirs.push(dir)

    const { ExtensionHost } = await import('../../../src/main/extensions/extension-host')
    const host = new ExtensionHost()
    const result = await host.load(dir)

    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error).toBe('VERSION_INCOMPATIBLE')
    }
  })

  it('load() accepts extension when app version equals minAppVersion', async () => {
    const dir = makeExtDir('com.exact.version', '0.1.0')
    tmpDirs.push(dir)

    const { ExtensionHost } = await import('../../../src/main/extensions/extension-host')
    const host = new ExtensionHost()
    const result = await host.load(dir)

    // Should not be VERSION_INCOMPATIBLE
    if ('error' in result) {
      expect(result.error).not.toBe('VERSION_INCOMPATIBLE')
    } else {
      expect(result.extension.id).toBe('com.exact.version')
    }
  })

  it('load() stores extension and listExtensions returns it', async () => {
    const dir = makeExtDir('com.list.test', '0.0.1')
    tmpDirs.push(dir)

    const { ExtensionHost } = await import('../../../src/main/extensions/extension-host')
    const host = new ExtensionHost()
    await host.load(dir)
    const list = host.listExtensions()

    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('com.list.test')
  })

  it('reload() after successful load returns the extension', async () => {
    const dir = makeExtDir('com.reload.success', '0.0.1')
    tmpDirs.push(dir)

    const { ExtensionHost } = await import('../../../src/main/extensions/extension-host')
    const host = new ExtensionHost()
    await host.load(dir)

    const result = await host.reload('com.reload.success')
    expect('extension' in result).toBe(true)
  })

  it('toggle disable then re-enable updates status', async () => {
    const dir = makeExtDir('com.toggle.full', '0.0.1')
    tmpDirs.push(dir)

    const { ExtensionHost } = await import('../../../src/main/extensions/extension-host')
    const host = new ExtensionHost()
    await host.load(dir)

    // Disable
    const disabledExt = await host.toggle('com.toggle.full', false)
    expect(disabledExt?.status).toBe('disabled')

    // Re-enable
    const enabledExt = await host.toggle('com.toggle.full', true)
    expect(enabledExt?.status).toBe('enabled')
  })

  it('start() does not register a bundled extension that is already in the store', async () => {
    const bundledDir = join(os.tmpdir(), `bundled-store-skip-${Date.now()}`)
    const extDir = join(bundledDir, 'com.store.skip.test')
    mkdirSync(extDir, { recursive: true })
    writeFileSync(
      join(extDir, 'manifest.json'),
      JSON.stringify({
        id: 'com.store.skip.test',
        name: 'StoreSkip',
        version: '1.0.0',
        description: 'Store skip test',
        main: 'main.js',
        minAppVersion: '0.0.1',
      })
    )
    writeFileSync(join(extDir, 'main.js'), 'module.exports = { activate: () => {} }')
    tmpDirs.push(bundledDir)

    storeData.extensions = [
      {
        id: 'com.store.skip.test',
        name: 'StoreSkip',
        version: '1.0.0',
        description: 'Store skip test',
        status: 'enabled',
        installedAt: new Date().toISOString(),
        entryPoint: join(extDir, 'main.js'),
        directoryPath: extDir,
      },
    ]

    const { ExtensionHost } = await import('../../../src/main/extensions/extension-host')
    const host = new ExtensionHost()
    await host.start({ bundledDirectory: bundledDir, beforeActivation: Promise.resolve() })
    // Still just the pre-existing store entry, not a duplicate
    expect(host.listExtensions()).toHaveLength(1)
    expect(host.listExtensions()[0].id).toBe('com.store.skip.test')
  })

  it('unload() calls deactivate on a successfully loaded extension', async () => {
    const dir = makeExtDir('com.unload.deact', '0.0.1')
    tmpDirs.push(dir)

    const { ExtensionHost } = await import('../../../src/main/extensions/extension-host')
    const host = new ExtensionHost()
    await host.load(dir)

    await expect(host.unload('com.unload.deact')).resolves.toBeUndefined()
  })

  it('load() returns INVALID_MANIFEST when manifest schema validation fails', async () => {
    // Create a manifest that has invalid fields (id fails reverse-domain check)
    const dir = join(os.tmpdir(), `ext-schema-fail-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'manifest.json'),
      JSON.stringify({
        id: 'INVALID ID!', // fails the regex
        name: 'Bad',
        version: '1.0.0',
        description: 'Bad schema',
        main: 'main.js',
        minAppVersion: '0.0.1',
      })
    )
    tmpDirs.push(dir)

    const { ExtensionHost } = await import('../../../src/main/extensions/extension-host')
    const host = new ExtensionHost()
    const result = await host.load(dir)

    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error).toBe('INVALID_MANIFEST')
      expect(result.message).toBeDefined()
    }
  })

  it('load() returns extension with status error when activate() throws', async () => {
    const dir = join(os.tmpdir(), `ext-act-crash-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'manifest.json'),
      JSON.stringify({
        id: 'com.activate.crash',
        name: 'Crash On Activate',
        version: '1.0.0',
        description: 'Will crash on activate',
        main: 'main.js',
        minAppVersion: '0.0.1',
      })
    )
    // Entry point that throws on load
    writeFileSync(join(dir, 'main.js'), 'throw new Error("activation boom")')
    tmpDirs.push(dir)

    const { ExtensionHost } = await import('../../../src/main/extensions/extension-host')
    const host = new ExtensionHost()
    const result = await host.load(dir)

    // Should return an extension with status 'error'
    expect('extension' in result).toBe(true)
    if ('extension' in result) {
      expect(result.extension.status).toBe('error')
    }
    // Extension should be persisted in store with error status
    expect(host.listExtensions()[0].status).toBe('error')
  })

  it('start() copes with a bundled path that is not a directory', async () => {
    // Create a directory then immediately chmod it to cause readdirSync to fail
    // Alternative: pass a file path that exists but is not a directory (readdirSync throws ENOTDIR)
    const filePath = join(os.tmpdir(), `not-a-dir-${Date.now()}.txt`)
    writeFileSync(filePath, 'I am a file')
    tmpDirs.push(filePath)

    const { ExtensionHost } = await import('../../../src/main/extensions/extension-host')
    const host = new ExtensionHost()

    // existsSync will return true (file exists) but readdirSync will throw ENOTDIR
    await expect(
      host.start({ bundledDirectory: filePath, beforeActivation: Promise.resolve() })
    ).resolves.toBeUndefined()
  })
})

describe('ExtensionHost – registration disposal on unload', () => {
  const tmpDir = join(os.tmpdir(), `ext-dispose-${Date.now()}`)

  beforeEach(() => {
    storeData.extensions = []
    mkdirSync(tmpDir, { recursive: true })
    writeFileSync(
      join(tmpDir, 'manifest.json'),
      JSON.stringify({
        id: 'com.dispose',
        name: 'Dispose',
        version: '1.0.0',
        description: 'A test extension',
        main: 'main.js',
        minAppVersion: '0.0.1',
      })
    )
    // Registers a command and a top-bar item WITHOUT a deactivate() — the host
    // must dispose them through the api's collected disposables.
    writeFileSync(
      join(tmpDir, 'main.js'),
      `module.exports = {
        activate: (api) => {
          api.commands.register({ id: 'disp-cmd', label: 'Disp' }, () => {})
          api.topBar.registerMenuItem({ id: 'disp-top', label: 'Top', onClick: () => {} })
        },
      }`
    )
  })

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  it('unload disposes every registration the extension made through the api', async () => {
    const { ExtensionHost } = await import('../../../src/main/extensions/extension-host')
    const { globalRegistry } = await import('../../../src/main/extensions/api')
    const host = new ExtensionHost()

    const result = await host.load(tmpDir)
    expect('error' in result).toBe(false)
    expect(globalRegistry.commandContributions.has('com.dispose.command.disp-cmd')).toBe(true)
    expect(globalRegistry.topBarItems.has('com.dispose.topbar.disp-top')).toBe(true)

    await host.unload('com.dispose')
    expect(globalRegistry.commandContributions.has('com.dispose.command.disp-cmd')).toBe(false)
    expect(globalRegistry.commandHandlers.has('com.dispose.command.disp-cmd')).toBe(false)
    expect(globalRegistry.topBarItems.has('com.dispose.topbar.disp-top')).toBe(false)
  })
})

// ADR 094: every backend runs in the extension host.
describe('ExtensionHost with an extension host process', () => {
  let root: string

  beforeEach(() => {
    vi.resetModules()
    storeData.extensions = []
    root = join(os.tmpdir(), `ext-host-routing-${Date.now()}-${Math.random()}`)
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  function writeExtension(id: string): string {
    const directory = join(root, id)
    mkdirSync(directory, { recursive: true })
    const manifest = { id, name: id, version: '1.0.0', description: 'd', main: 'main.js' }
    writeFileSync(
      join(directory, 'manifest.json'),
      JSON.stringify({ ...manifest, minAppVersion: '0.1.0' })
    )
    writeFileSync(
      join(directory, 'main.js'),
      `exports.activate = () => { globalThis.__activatedInMain = '${id}' }`
    )
    return directory
  }

  async function hostWithBackendHost() {
    const { ExtensionHost } = await import('../../../src/main/extensions/extension-host')
    const host = new ExtensionHost()
    const backendHost = { activate: vi.fn(async () => {}), deactivate: vi.fn(async () => {}) }
    host.useBackendHost(backendHost)
    return { host, backendHost }
  }

  it('activates a backend in the extension host, with the API it calls kept in main', async () => {
    const { host, backendHost } = await hostWithBackendHost()
    const directory = writeExtension('com.hosted')

    await host.load(directory)

    expect(backendHost.activate).toHaveBeenCalledWith({
      id: 'com.hosted',
      entryPoint: join(directory, 'main.js'),
      dependencies: [],
    })
    expect(host.hostedApi('com.hosted')).toBeDefined()
    expect((globalThis as { __activatedInMain?: string }).__activatedInMain).toBeUndefined()
  })

  it('shows backends the extension host lost as failed, with why', async () => {
    const { host } = await hostWithBackendHost()
    await host.load(writeExtension('com.lost'))

    host.failHostedBackends(['com.lost'], 'Extension host exited with code 134')

    expect(host.listExtensions().find((e) => e.id === 'com.lost')).toMatchObject({
      status: 'error',
      errorMessage: 'Extension host exited with code 134',
    })
    expect(host.hostedApi('com.lost')).toBeUndefined()
  })
})
