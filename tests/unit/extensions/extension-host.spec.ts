import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import os from 'os'
import { FakeBackendHost, type FakeBackend } from './fake-backend-host'

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
function writeExtension(id: string, manifest: Record<string, unknown> = {}): string {
  const directory = join(root, id)
  mkdirSync(directory, { recursive: true })
  const fields = { id, name: id, version: '1.0.0', description: 'Test extension', main: 'main.js' }
  writeFileSync(
    join(directory, 'manifest.json'),
    JSON.stringify({ ...fields, minAppVersion: '0.0.1', ...manifest })
  )
  return directory
}

/** A record as an earlier run stored it. */
function storedRecord(id: string, status: 'enabled' | 'disabled') {
  const directoryPath = join(root, id)
  return {
    id,
    name: id,
    version: '1.0.0',
    description: '',
    entryPoint: join(directoryPath, 'main.js'),
    status,
    installedAt: new Date().toISOString(),
    directoryPath,
  }
}

async function newHost(backends: Record<string, FakeBackend> = {}) {
  const { ExtensionHost } = await import('../../../src/main/extensions/extension-host')
  const backendHost = new FakeBackendHost(backends)
  return { host: new ExtensionHost(backendHost), backendHost }
}

const failing =
  (message: string): FakeBackend =>
  () => {
    throw new Error(message)
  }

describe('ExtensionHost.load', () => {
  it('activates the backend in the extension host, with the API it calls kept in main', async () => {
    const { host, backendHost } = await newHost()
    const directory = writeExtension('com.hosted')

    const result = await host.load(directory)

    expect(result).toMatchObject({ extension: { id: 'com.hosted', status: 'enabled' } })
    expect(backendHost.activated).toEqual([
      { id: 'com.hosted', entryPoint: join(directory, 'main.js'), dependencies: [] },
    ])
    expect(host.hostedApi('com.hosted')).toBeDefined()
    expect(host.listExtensions().map((e) => e.id)).toEqual(['com.hosted'])
  })

  it('stores the extension as failed, with why, when its backend fails to activate', async () => {
    const { host } = await newHost({ 'com.crash': failing('activation boom') })

    const result = await host.load(writeExtension('com.crash'))

    expect(result).toMatchObject({
      extension: { status: 'error', errorMessage: 'activation boom' },
    })
    expect(host.listExtensions()[0]).toMatchObject({ status: 'error' })
    expect(host.hostedApi('com.crash')).toBeUndefined()
  })

  it('returns INVALID_MANIFEST for a directory without a manifest', async () => {
    const { host, backendHost } = await newHost()

    const result = await host.load(join(root, 'nothing-here'))

    expect(result).toEqual({ error: 'INVALID_MANIFEST', message: 'Cannot read manifest.json' })
    expect(host.listExtensions()).toHaveLength(0)
    expect(backendHost.activated).toHaveLength(0)
  })

  it('returns INVALID_MANIFEST when the manifest fails the schema', async () => {
    const { host } = await newHost()

    const result = await host.load(writeExtension('bad', { id: 'INVALID ID!' }))

    expect(result).toMatchObject({ error: 'INVALID_MANIFEST', message: expect.any(String) })
  })

  it('returns DUPLICATE_ID for an extension already stored', async () => {
    storeData.extensions = [storedRecord('com.dup', 'enabled')]
    const { host, backendHost } = await newHost()

    const result = await host.load(writeExtension('com.dup'))

    expect(result).toEqual({ error: 'DUPLICATE_ID' })
    expect(backendHost.activated).toHaveLength(0)
  })

  it.each(['99.0.0', '0.2.0'])(
    'returns VERSION_INCOMPATIBLE when the manifest needs app %s',
    async (minAppVersion) => {
      const { host } = await newHost()

      const result = await host.load(writeExtension('com.future', { minAppVersion }))

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
    const { host, backendHost } = await newHost()
    await host.load(writeExtension('com.dispose'))
    // The api server runs a backend's registrations on its API in main.
    const api = host.hostedApi('com.dispose')!
    api.commands.register({ id: 'disp-cmd', label: 'Disp' }, () => {})
    api.topBar.registerMenuItem({ id: 'disp-top', label: 'Top', onClick: () => {} })

    await host.unload('com.dispose')

    expect(backendHost.deactivated).toEqual(['com.dispose'])
    expect(globalRegistry.commandContributions.has('com.dispose.command.disp-cmd')).toBe(false)
    expect(globalRegistry.topBarItems.has('com.dispose.topbar.disp-top')).toBe(false)
    expect(host.hostedApi('com.dispose')).toBeUndefined()
  })

  it('still disposes the registrations when deactivating the backend fails', async () => {
    const { globalRegistry } = await import('../../../src/main/extensions/api')
    const { host, backendHost } = await newHost()
    await host.load(writeExtension('com.stubborn'))
    host.hostedApi('com.stubborn')!.commands.register({ id: 'cmd', label: 'Cmd' }, () => {})
    vi.spyOn(backendHost, 'deactivate').mockRejectedValue(new Error('deactivate failed'))

    await expect(host.unload('com.stubborn')).resolves.toBeUndefined()

    expect(globalRegistry.commandContributions.has('com.stubborn.command.cmd')).toBe(false)
  })

  it('does nothing for an extension that is not active', async () => {
    const { host, backendHost } = await newHost()

    await host.unload('com.unknown')

    expect(backendHost.deactivated).toEqual([])
  })
})

describe('ExtensionHost lifecycle', () => {
  it('uninstall deactivates the backend and removes the extension', async () => {
    const { host, backendHost } = await newHost()
    await host.load(writeExtension('com.removable'))

    await expect(host.uninstall('com.removable')).resolves.toBe(true)

    expect(backendHost.deactivated).toEqual(['com.removable'])
    expect(host.listExtensions()).toHaveLength(0)
  })

  it('uninstall returns false for an unknown extension', async () => {
    const { host } = await newHost()
    await expect(host.uninstall('com.unknown')).resolves.toBe(false)
  })

  it('reload deactivates the backend and activates it again', async () => {
    const { host, backendHost } = await newHost()
    await host.load(writeExtension('com.reload'))

    const result = await host.reload('com.reload')

    expect(result).toMatchObject({ extension: { id: 'com.reload' } })
    expect(backendHost.deactivated).toEqual(['com.reload'])
    expect(backendHost.activated.map((record) => record.id)).toEqual(['com.reload', 'com.reload'])
  })

  it('reload returns why when the backend fails to activate again', async () => {
    let starts = 0
    const { host } = await newHost({
      'com.reload': () => {
        if (++starts > 1) throw new Error('second start failed')
      },
    })
    await host.load(writeExtension('com.reload'))

    await expect(host.reload('com.reload')).resolves.toEqual({ error: 'second start failed' })
  })

  it('reload returns NOT_FOUND for an unknown extension', async () => {
    const { host } = await newHost()
    await expect(host.reload('com.unknown')).resolves.toEqual({ error: 'NOT_FOUND' })
  })

  it('toggle off deactivates the backend; toggle on activates it again', async () => {
    const { host, backendHost } = await newHost()
    await host.load(writeExtension('com.toggle'))

    await expect(host.toggle('com.toggle', false)).resolves.toMatchObject({ status: 'disabled' })
    expect(backendHost.deactivated).toEqual(['com.toggle'])

    await expect(host.toggle('com.toggle', true)).resolves.toMatchObject({ status: 'enabled' })
    expect(backendHost.activated).toHaveLength(2)
    expect(host.hostedApi('com.toggle')).toBeDefined()
  })

  it('toggle returns null for an unknown extension', async () => {
    const { host } = await newHost()
    await expect(host.toggle('com.unknown', true)).resolves.toBeNull()
  })
})

describe('ExtensionHost when the extension host loses its backends', () => {
  it('shows them as failed, with why, until they activate again', async () => {
    const { host } = await newHost()
    await host.load(writeExtension('com.lost'))

    host.failHostedBackends(['com.lost'], 'Extension host exited with code 134')

    expect(host.listExtensions()[0]).toMatchObject({
      status: 'error',
      errorMessage: 'Extension host exited with code 134',
    })
    expect(host.hostedApi('com.lost')).toBeUndefined()

    await host.reload('com.lost')
    expect(host.listExtensions()[0]).toMatchObject({ status: 'enabled' })
    expect(host.listExtensions()[0].errorMessage).toBeUndefined()
  })
})

describe('ExtensionHost records', () => {
  it('getExtensionDirectory returns the stored directory, or null for an unknown extension', async () => {
    storeData.extensions = [storedRecord('com.dir', 'enabled')]
    const { host } = await newHost()

    expect(host.getExtensionDirectory('com.dir')).toBe(join(root, 'com.dir'))
    expect(host.getExtensionDirectory('com.unknown')).toBeNull()
  })

  it('listExtensions leaves out directoryPath and rendererRelPath', async () => {
    storeData.extensions = [
      {
        ...storedRecord('com.strip', 'enabled'),
        rendererRelPath: 'dist/renderer.js',
        rendererUrl: 'ext://com.strip/dist/renderer.js',
      },
    ]
    const { host } = await newHost()

    const [listed] = host.listExtensions()

    expect('directoryPath' in listed).toBe(false)
    expect('rendererRelPath' in listed).toBe(false)
    expect(listed.rendererUrl).toBe('ext://com.strip/dist/renderer.js')
  })
})

describe('ExtensionHost.start with an unusual bundled directory', () => {
  it('skips subdirectories without a manifest', async () => {
    mkdirSync(join(root, 'not-an-extension'))
    const { host, backendHost } = await newHost()

    await host.start({ bundledDirectory: root, beforeActivation: Promise.resolve() })

    expect(host.listExtensions()).toHaveLength(0)
    expect(backendHost.activated).toHaveLength(0)
  })

  it('copes with a bundled path that is a file', async () => {
    const file = join(root, 'not-a-directory.txt')
    writeFileSync(file, 'I am a file')
    const { host } = await newHost()

    await expect(
      host.start({ bundledDirectory: file, beforeActivation: Promise.resolve() })
    ).resolves.toBeUndefined()
    expect(host.listExtensions()).toHaveLength(0)
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
