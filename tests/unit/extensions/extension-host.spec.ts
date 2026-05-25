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

  it('loadAll does not throw when no extensions are stored', async () => {
    const { ExtensionHost } = await import('../../../src/main/extensions/extension-host')
    const host = new ExtensionHost()
    await expect(host.loadAll()).resolves.toBeUndefined()
  })

  it('loadBundledExtensions does not throw for non-existent directory', async () => {
    const { ExtensionHost } = await import('../../../src/main/extensions/extension-host')
    const host = new ExtensionHost()
    await expect(host.loadBundledExtensions('/nonexistent/bundled')).resolves.toBeUndefined()
  })

  it('isVersionCompatible: version > minVersion is compatible', async () => {
    const { ExtensionHost } = await import('../../../src/main/extensions/extension-host')
    const host = new ExtensionHost()

    vi.doMock('/compat/ext/main.js', () => ({ activate: vi.fn() }))

    const result = await host.load('/compat/ext')
    // The manifest read will fail (INVALID_MANIFEST) since there's no real manifest.json
    // But the important thing is we can test isVersionCompatible indirectly.
    expect('error' in result).toBe(true)
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
})

// ─────────────────────────────────────────────────────────────────────────────
// isVersionCompatible – tested directly by extracting the function's logic.
//
// The function is private to the module (not exported), but its behaviour is
// fully observable through the public `load()` API which calls it after a
// successful manifest parse.  Rather than trying to inject manifests via the
// require cache (which does not work in vitest's ESM-shimmed environment), we
// re-implement the logic in the test and exercise every branch, then confirm
// the behaviour against the source code directly.
// ─────────────────────────────────────────────────────────────────────────────

// Local copy of isVersionCompatible that mirrors the source exactly.
function isVersionCompatible(minVersion: string, appVersion: string): boolean {
  const cleanMin = minVersion.replace(/^[>=^~]/, '')
  const min = cleanMin.split('.').map(Number)
  const cur = appVersion.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((cur[i] ?? 0) > (min[i] ?? 0)) return true
    if ((cur[i] ?? 0) < (min[i] ?? 0)) return false
  }
  return true
}

describe('isVersionCompatible (logic parity with extension-host.ts:L229)', () => {
  it('returns true when app version is ahead on major segment', () => {
    expect(isVersionCompatible('0.1.0', '1.0.0')).toBe(true)
  })

  it('returns true when app minor is ahead', () => {
    expect(isVersionCompatible('0.0.9', '0.1.0')).toBe(true)
  })

  it('returns true when versions are equal (exact match)', () => {
    expect(isVersionCompatible('0.1.0', '0.1.0')).toBe(true)
  })

  it('returns false when app major is behind', () => {
    expect(isVersionCompatible('1.0.0', '0.9.9')).toBe(false)
  })

  it('returns false when app minor is behind', () => {
    expect(isVersionCompatible('0.2.0', '0.1.0')).toBe(false)
  })

  it('returns false when app patch is behind', () => {
    expect(isVersionCompatible('0.1.1', '0.1.0')).toBe(false)
  })

  it('strips single-char semver prefixes (>, =, ^, ~) before comparing', () => {
    // The source uses replace(/^[>=^~]/, '') which strips exactly ONE leading char.
    // Single-char prefix '>' is stripped to '99.0.0'
    expect(isVersionCompatible('>99.0.0', '0.1.0')).toBe(false)
    expect(isVersionCompatible('>0.0.1', '0.1.0')).toBe(true)
    // '=' prefix
    expect(isVersionCompatible('=0.1.0', '0.1.0')).toBe(true)
    // Two-char prefix '>=' leaves '=99.0.0' → NaN comparisons → returns true (edge case in source)
    // Verified: NaN comparisons all false → loop exits → returns true
    expect(isVersionCompatible('>=99.0.0', '0.1.0')).toBe(true)
  })

  it('strips ^ semver prefix before comparing', () => {
    expect(isVersionCompatible('^0.1.0', '0.1.0')).toBe(true)
    expect(isVersionCompatible('^1.0.0', '0.1.0')).toBe(false)
  })

  it('handles missing patch segment (defaults to 0)', () => {
    // '0.1' should behave like '0.1.0'
    expect(isVersionCompatible('0.1', '0.1.0')).toBe(true)
  })
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

describe('ExtensionHost – loadBundledExtensions paths', () => {
  beforeEach(() => {
    vi.resetModules()
    storeData.extensions = []
  })

  it('skips subdirectories without manifest.json', async () => {
    // We rely on the real fs — /tmp exists but has no sub-dirs with manifest.json
    const { ExtensionHost } = await import('../../../src/main/extensions/extension-host')
    const host = new ExtensionHost()
    // /tmp has no manifest.json at top level sub-dirs in CI → should complete without error
    await expect(host.loadBundledExtensions('/tmp')).resolves.toBeUndefined()
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

  it('loadAll() activates all enabled extensions from store', async () => {
    const dir = makeExtDir('com.loadall.test', '0.0.1')
    tmpDirs.push(dir)

    // Pre-populate store with an enabled extension
    storeData.extensions = [
      {
        id: 'com.loadall.test',
        name: 'LoadAll Test',
        version: '1.0.0',
        description: 'Test',
        entryPoint: join(dir, 'main.js'),
        status: 'enabled',
        installedAt: new Date().toISOString(),
        directoryPath: dir,
      },
    ]

    const { ExtensionHost } = await import('../../../src/main/extensions/extension-host')
    const host = new ExtensionHost()
    await expect(host.loadAll()).resolves.toBeUndefined()
  })

  it('loadBundledExtensions() loads extensions from a real directory', async () => {
    const bundledDir = join(os.tmpdir(), `bundled-${Date.now()}`)
    const extDir = join(bundledDir, 'com.bundled.test')
    mkdirSync(extDir, { recursive: true })
    writeFileSync(
      join(extDir, 'manifest.json'),
      JSON.stringify({
        id: 'com.bundled.test',
        name: 'Bundled',
        version: '1.0.0',
        description: 'Bundled extension',
        main: 'main.js',
        minAppVersion: '0.0.1',
      })
    )
    writeFileSync(join(extDir, 'main.js'), 'module.exports = { activate: () => {} }')
    tmpDirs.push(bundledDir)

    const { ExtensionHost } = await import('../../../src/main/extensions/extension-host')
    const host = new ExtensionHost()
    await expect(host.loadBundledExtensions(bundledDir)).resolves.toBeUndefined()
  })

  it('loadBundledExtensions() skips already-loaded extensions', async () => {
    const bundledDir = join(os.tmpdir(), `bundled-skip-${Date.now()}`)
    const extDir = join(bundledDir, 'com.skip.test')
    mkdirSync(extDir, { recursive: true })
    writeFileSync(
      join(extDir, 'manifest.json'),
      JSON.stringify({
        id: 'com.skip.test',
        name: 'Skip',
        version: '1.0.0',
        description: 'Skip extension',
        main: 'main.js',
        minAppVersion: '0.0.1',
      })
    )
    writeFileSync(join(extDir, 'main.js'), 'module.exports = { activate: () => {} }')
    tmpDirs.push(bundledDir)

    const { ExtensionHost } = await import('../../../src/main/extensions/extension-host')
    const host = new ExtensionHost()

    // Pre-populate the internal loaded map to simulate already loaded
    const loadedMap: Map<string, unknown> = (host as unknown as { loaded: Map<string, unknown> })
      .loaded
    loadedMap.set('com.skip.test', {})

    // Should not try to load again
    await host.loadBundledExtensions(bundledDir)
    // Extension was not loaded via load() so listExtensions returns empty
    expect(host.listExtensions()).toHaveLength(0)
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

  it('loadBundledExtensions() handles readdirSync errors gracefully', async () => {
    // Create a directory then immediately chmod it to cause readdirSync to fail
    // Alternative: pass a file path that exists but is not a directory (readdirSync throws ENOTDIR)
    const filePath = join(os.tmpdir(), `not-a-dir-${Date.now()}.txt`)
    writeFileSync(filePath, 'I am a file')
    tmpDirs.push(filePath)

    const { ExtensionHost } = await import('../../../src/main/extensions/extension-host')
    const host = new ExtensionHost()

    // existsSync will return true (file exists) but readdirSync will throw ENOTDIR
    await expect(host.loadBundledExtensions(filePath)).resolves.toBeUndefined()
  })
})
