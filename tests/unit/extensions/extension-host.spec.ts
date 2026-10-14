import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import os from 'os'
import { newExtensionHost, storedExtensionRecord, type FakeBackend } from './fake-backend-host'

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

let root: string

beforeEach(() => {
  vi.resetModules()
  storeData.extensions = []
  root = join(os.tmpdir(), `ext-host-${Date.now()}-${Math.random()}`)
  mkdirSync(root, { recursive: true })
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

/** An extension directory: only its manifest, since the backend is the fake host's. */
function writeManifestOnly(id: string, manifest: Record<string, unknown> = {}): string {
  const directory = join(root, id)
  mkdirSync(directory, { recursive: true })
  const fields = { id, name: id, version: '1.0.0', description: 'Test extension', main: 'main.js' }
  writeFileSync(
    join(directory, 'manifest.json'),
    JSON.stringify({ ...fields, minAppVersion: '0.0.1', ...manifest })
  )
  return directory
}

const failingBackend =
  (message: string): FakeBackend =>
  () => {
    throw new Error(message)
  }

describe('ExtensionHost.load', () => {
  it('activates the backend in the extension host, with the API it calls kept in main', async () => {
    const { host, backendHost } = await newExtensionHost()
    const directory = writeManifestOnly('com.hosted')

    const result = await host.load(directory)

    expect(result).toMatchObject({ extension: { id: 'com.hosted', status: 'enabled' } })
    expect(backendHost.activated).toEqual([
      { id: 'com.hosted', entryPoint: join(directory, 'main.js'), directory, dependencies: [] },
    ])
    expect(host.apiOf('com.hosted')).toBeDefined()
    expect(host.listAll().map((e) => e.id)).toEqual(['com.hosted'])
  })

  it('stores the extension as failed, with why, when its backend fails to activate', async () => {
    const { host } = await newExtensionHost({ 'com.crash': failingBackend('activation boom') })

    const result = await host.load(writeManifestOnly('com.crash'))

    expect(result).toMatchObject({
      extension: { status: 'error', errorMessage: 'activation boom' },
    })
    expect(host.listAll()[0]).toMatchObject({ status: 'error' })
    expect(host.apiOf('com.crash')).toBeUndefined()
  })
})

describe('ExtensionHost.load — invalid manifests', () => {
  it('returns INVALID_MANIFEST for a directory without a manifest', async () => {
    const { host, backendHost } = await newExtensionHost()

    const result = await host.load(join(root, 'nothing-here'))

    expect(result).toEqual({ error: 'INVALID_MANIFEST', message: 'Cannot read manifest.json' })
    expect(host.listAll()).toHaveLength(0)
    expect(backendHost.activated).toHaveLength(0)
  })

  it('returns INVALID_MANIFEST when the manifest fails the schema', async () => {
    const { host } = await newExtensionHost()

    const result = await host.load(writeManifestOnly('bad', { id: 'INVALID ID!' }))

    expect(result).toMatchObject({ error: 'INVALID_MANIFEST', message: expect.any(String) })
  })

  it('refuses a manifest that declares a shell root setting outside its own settings', async () => {
    const { host, backendHost } = await newExtensionHost()
    const manifest = { contributes: { shellRoots: ['com.other.cloneFolder'] } }

    const result = await host.load(writeManifestOnly('com.greedy', manifest))

    expect(result).toMatchObject({
      error: 'INVALID_MANIFEST',
      message: expect.stringContaining('com.other.cloneFolder'),
    })
    expect(host.listAll()).toHaveLength(0)
    expect(backendHost.activated).toHaveLength(0)
  })
})

describe('ExtensionHost.load — shell roots and duplicates', () => {
  it('loads a manifest that declares a shell root setting of its own', async () => {
    const { host } = await newExtensionHost()
    const manifest = { contributes: { shellRoots: ['com.owner.cloneFolder'] } }

    const result = await host.load(writeManifestOnly('com.owner', manifest))

    expect(result).toMatchObject({ extension: { id: 'com.owner', status: 'enabled' } })
  })

  it('returns DUPLICATE_ID for an extension already stored', async () => {
    storeData.extensions = [storedExtensionRecord(root, 'com.dup', 'enabled')]
    const { host, backendHost } = await newExtensionHost()

    const result = await host.load(writeManifestOnly('com.dup'))

    expect(result).toEqual({ error: 'DUPLICATE_ID' })
    expect(backendHost.activated).toHaveLength(0)
  })

  it.each(['99.0.0', '0.2.0'])(
    'returns VERSION_INCOMPATIBLE when the manifest needs app %s',
    async (minAppVersion) => {
      const { host } = await newExtensionHost()

      const result = await host.load(writeManifestOnly('com.future', { minAppVersion }))

      expect(result).toEqual({
        error: 'VERSION_INCOMPATIBLE',
        message: `Requires app >= ${minAppVersion}, got 0.1.0`,
      })
    }
  )
})

describe('ExtensionHost.unload', () => {
  it('deactivates the backend and disposes what it registered in main', async () => {
    const { globalRegistry } = await import('../../../src/main/extensions/api')
    const { host, backendHost } = await newExtensionHost()
    await host.load(writeManifestOnly('com.dispose'))
    // The api server runs a backend's registrations on its API in main.
    const api = host.apiOf('com.dispose')!
    api.commands.register({ id: 'disp-cmd', label: 'Disp' }, () => {})

    await host.unload('com.dispose')

    expect(backendHost.deactivated).toEqual(['com.dispose'])
    expect(globalRegistry.commandContributions.has('com.dispose.command.disp-cmd')).toBe(false)
    expect(host.apiOf('com.dispose')).toBeUndefined()
  })

  it('still disposes the registrations when deactivating the backend fails', async () => {
    const { globalRegistry } = await import('../../../src/main/extensions/api')
    const { host, backendHost } = await newExtensionHost()
    await host.load(writeManifestOnly('com.stubborn'))
    host.apiOf('com.stubborn')!.commands.register({ id: 'cmd', label: 'Cmd' }, () => {})
    vi.spyOn(backendHost, 'deactivate').mockRejectedValue(new Error('deactivate failed'))

    await expect(host.unload('com.stubborn')).resolves.toBeUndefined()

    expect(globalRegistry.commandContributions.has('com.stubborn.command.cmd')).toBe(false)
  })

  it('does nothing for an extension that is not active', async () => {
    const { host, backendHost } = await newExtensionHost()

    await host.unload('com.unknown')

    expect(backendHost.deactivated).toEqual([])
  })
})

describe('ExtensionHost lifecycle', () => {
  it('uninstall deactivates the backend and removes the extension', async () => {
    const { host, backendHost } = await newExtensionHost()
    await host.load(writeManifestOnly('com.removable'))

    await expect(host.uninstallExtension('com.removable')).resolves.toBe(true)

    expect(backendHost.deactivated).toEqual(['com.removable'])
    expect(host.listAll()).toHaveLength(0)
  })

  it('uninstall returns false for an unknown extension', async () => {
    const { host } = await newExtensionHost()
    await expect(host.uninstallExtension('com.unknown')).resolves.toBe(false)
  })
})

describe('ExtensionHost lifecycle — reload', () => {
  it('reload deactivates the backend and activates it again', async () => {
    const { host, backendHost } = await newExtensionHost()
    await host.load(writeManifestOnly('com.reload'))

    const result = await host.reloadExtension('com.reload')

    expect(result).toMatchObject({ extension: { id: 'com.reload' } })
    expect(backendHost.deactivated).toEqual(['com.reload'])
    expect(backendHost.activated.map((record) => record.id)).toEqual(['com.reload', 'com.reload'])
  })

  it('reload returns why when the backend fails to activate again', async () => {
    let starts = 0
    const { host } = await newExtensionHost({
      'com.reload': () => {
        if (++starts > 1) throw new Error('second start failed')
      },
    })
    await host.load(writeManifestOnly('com.reload'))

    await expect(host.reloadExtension('com.reload')).resolves.toEqual({
      error: 'second start failed',
    })
  })

  it('reload returns NOT_FOUND for an unknown extension', async () => {
    const { host } = await newExtensionHost()
    await expect(host.reloadExtension('com.unknown')).resolves.toEqual({ error: 'NOT_FOUND' })
  })
})

describe('ExtensionHost lifecycle — toggle', () => {
  it('toggle off deactivates the backend; toggle on activates it again', async () => {
    const { host, backendHost } = await newExtensionHost()
    await host.load(writeManifestOnly('com.toggle'))

    await expect(host.setEnabled('com.toggle', false)).resolves.toMatchObject({
      status: 'disabled',
    })
    expect(backendHost.deactivated).toEqual(['com.toggle'])

    await expect(host.setEnabled('com.toggle', true)).resolves.toMatchObject({ status: 'enabled' })
    expect(backendHost.activated).toHaveLength(2)
    expect(host.apiOf('com.toggle')).toBeDefined()
  })

  it('toggle returns null for an unknown extension', async () => {
    const { host } = await newExtensionHost()
    await expect(host.setEnabled('com.unknown', true)).resolves.toBeNull()
  })
})

describe('ExtensionHost when the extension host loses its backends', () => {
  it('shows them as failed, with why, until they activate again', async () => {
    const { host } = await newExtensionHost()
    await host.load(writeManifestOnly('com.lost'))

    host.failHostedBackends(['com.lost'], 'Extension host exited with code 134')

    expect(host.listAll()[0]).toMatchObject({
      status: 'error',
      errorMessage: 'Extension host exited with code 134',
    })
    expect(host.apiOf('com.lost')).toBeUndefined()

    await host.reloadExtension('com.lost')
    expect(host.listAll()[0]).toMatchObject({ status: 'enabled' })
    expect(host.listAll()[0].errorMessage).toBeUndefined()
  })
})

// Settings -> Extensions stays open while a backend fails or comes back, so it
// re-reads the list on this event rather than only when it opens.
async function watchedHost(backends: Record<string, FakeBackend> = {}) {
  const created = await newExtensionHost(backends)
  const broadcastToWindows = vi.fn()
  created.host.setDeps({ broadcastToWindows })
  const listChanges = () =>
    broadcastToWindows.mock.calls.filter(([channel]) => channel === 'extension:list-changed')
  return { ...created, broadcastToWindows, listChanges }
}

describe('ExtensionHost tells the windows when the extension list changes', () => {
  it('when the extension host loses its backends for good', async () => {
    const { host, listChanges } = await watchedHost()
    await host.load(writeManifestOnly('com.lost'))
    const before = listChanges().length

    host.failHostedBackends(['com.lost'], 'Extension host exited with code 134')

    expect(listChanges()).toHaveLength(before + 1)
    expect(listChanges().at(-1)).toEqual(['extension:list-changed', null])
  })

  it('when a failed backend activates again', async () => {
    const { host, listChanges } = await watchedHost()
    await host.load(writeManifestOnly('com.lost'))
    host.failHostedBackends(['com.lost'], 'Extension host exited with code 134')
    const before = listChanges().length

    await host.reloadExtension('com.lost')

    expect(listChanges().length).toBeGreaterThan(before)
  })
})

describe('ExtensionHost tells the windows — not for unchanged statuses', () => {
  it('not when a running backend is reloaded and its status stays the same', async () => {
    const { host, listChanges } = await watchedHost()
    await host.load(writeManifestOnly('com.steady'))
    const before = listChanges().length

    await host.reloadExtension('com.steady')

    expect(listChanges()).toHaveLength(before)
  })

  it('not for an extension the host never had', async () => {
    const { host, broadcastToWindows } = await watchedHost()

    host.failHostedBackends(['com.unknown'], 'Extension host exited with code 134')

    expect(broadcastToWindows).not.toHaveBeenCalled()
  })
})

describe('ExtensionHost tells the windows — install, failure, toggle and uninstall', () => {
  it('when an extension is installed, fails to activate, is toggled or uninstalled', async () => {
    const { host, listChanges } = await watchedHost({ 'com.crash': failingBackend('boom') })
    const counts: number[] = []
    const countListChanges = async (action: () => Promise<unknown>) => {
      const before = listChanges().length
      await action()
      counts.push(listChanges().length - before)
    }

    await countListChanges(() => host.load(writeManifestOnly('com.crash')))
    await countListChanges(() => host.load(writeManifestOnly('com.toggle')))
    await countListChanges(() => host.setEnabled('com.toggle', false))
    await countListChanges(() => host.uninstallExtension('com.toggle'))

    expect(counts.every((count) => count > 0)).toBe(true)
  })
})

describe('ExtensionHost records', () => {
  it('getExtensionDirectory returns the stored directory, or null for an unknown extension', async () => {
    storeData.extensions = [storedExtensionRecord(root, 'com.dir', 'enabled')]
    const { host } = await newExtensionHost()

    expect(host.getExtensionDirectory('com.dir')).toBe(join(root, 'com.dir'))
    expect(host.getExtensionDirectory('com.unknown')).toBeNull()
  })

  it('listExtensions leaves out directoryPath and rendererRelPath', async () => {
    storeData.extensions = [
      {
        ...storedExtensionRecord(root, 'com.strip', 'enabled'),
        rendererRelPath: 'dist/renderer.js',
        rendererUrl: 'ext://com.strip/dist/renderer.js',
      },
    ]
    const { host } = await newExtensionHost()

    const [listed] = host.listAll()

    expect('directoryPath' in listed).toBe(false)
    expect('rendererRelPath' in listed).toBe(false)
    expect(listed.rendererUrl).toBe('ext://com.strip/dist/renderer.js')
  })
})

describe('ExtensionHost.start with an unusual bundled directory', () => {
  it('skips subdirectories without a manifest', async () => {
    mkdirSync(join(root, 'not-an-extension'))
    const { host, backendHost } = await newExtensionHost()

    await host.startAll({ bundledDirectory: root, beforeActivation: Promise.resolve() })

    expect(host.listAll()).toHaveLength(0)
    expect(backendHost.activated).toHaveLength(0)
  })

  it('copes with a bundled path that is a file', async () => {
    const file = join(root, 'not-a-directory.txt')
    writeFileSync(file, 'I am a file')
    const { host } = await newExtensionHost()

    await expect(
      host.startAll({ bundledDirectory: file, beforeActivation: Promise.resolve() })
    ).resolves.toBeUndefined()
    expect(host.listAll()).toHaveLength(0)
  })
})

async function isCompatible(minVersion: string, appVersion: string): Promise<boolean> {
  const { isVersionCompatible } = await import('../../../src/main/extensions/extension-host')
  return isVersionCompatible(minVersion, appVersion)
}

describe('isVersionCompatible', () => {
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
