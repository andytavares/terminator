import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import os from 'os'
import { newExtensionHost, storedExtensionRecord } from './fake-backend-host'

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

// What the host writes to the main log, which `scripts/smoke-start.mjs` reads
// to tell that every bundled extension came up.
const logged: string[] = []
vi.mock('../../../src/main/logger', () => {
  const recordLogLine = (message: string) => logged.push(message)
  const log = {
    debug: recordLogLine,
    info: recordLogLine,
    warn: recordLogLine,
    error: recordLogLine,
  }
  return { makeLogger: () => log, logger: log }
})

let bundle: string

beforeEach(() => {
  vi.resetModules()
  storeData.extensions = []
  logged.length = 0
  bundle = join(os.tmpdir(), `ext-bundle-${Date.now()}-${Math.random()}`)
})

afterEach(() => rmSync(bundle, { recursive: true, force: true }))

/** Bundled extensions: a manifest each; the fake extension host holds their backends. */
function writeBundle(dependenciesById: Record<string, string[] | undefined>): string {
  for (const [id, extensionDependencies] of Object.entries(dependenciesById)) {
    const directory = join(bundle, id)
    mkdirSync(directory, { recursive: true })
    const manifest = { id, name: id, version: '1.0.0', description: 'Test extension' }
    writeFileSync(
      join(directory, 'manifest.json'),
      JSON.stringify({
        ...manifest,
        main: 'main.js',
        minAppVersion: '0.0.1',
        extensionDependencies,
      })
    )
  }
  return bundle
}

function extensionsById(host: { listAll(): Array<{ id: string }> }) {
  return Object.fromEntries(host.listAll().map((e) => [e.id, e]))
}

const ready = Promise.resolve()

describe('ExtensionHost.start', () => {
  it('activates extensions concurrently: one waits for another to have started', async () => {
    let markPeerStarted = () => {}
    const peerStarted = new Promise<void>((resolve) => (markPeerStarted = resolve))
    const { host, backendHost } = await newExtensionHost({
      // Never settles if the peer is not activated alongside it: the test's own timeout fails it.
      'com.waiter': () => peerStarted,
      'com.peer': () => markPeerStarted(),
    })

    await host.startAll({
      bundledDirectory: writeBundle({ 'com.waiter': [], 'com.peer': [] }),
      beforeActivation: ready,
    })

    expect(backendHost.activated.map((record) => record.id)).toEqual(['com.peer', 'com.waiter'])
    expect(host.listAll().map((e) => e.status)).toEqual(['enabled', 'enabled'])
  })
})

describe('ExtensionHost.start — failures and logging', () => {
  it('marks a failing extension as errored and still activates the others', async () => {
    const { host, backendHost } = await newExtensionHost({
      'com.broken': () => {
        throw new Error('boom')
      },
    })

    await host.startAll({
      bundledDirectory: writeBundle({ 'com.broken': [], 'com.healthy': [] }),
      beforeActivation: ready,
    })

    const extensions = extensionsById(host)
    expect(extensions['com.broken']).toMatchObject({ status: 'error', errorMessage: 'boom' })
    expect(extensions['com.healthy']).toMatchObject({ status: 'enabled' })
    expect(backendHost.activated.map((record) => record.id)).toEqual(['com.healthy'])
  })
})

describe('ExtensionHost.start — logging', () => {
  it('logs every extension it activates, new or stored, and never one that failed', async () => {
    writeBundle({ 'com.stored': [] })
    storeData.extensions = [storedExtensionRecord(bundle, 'com.stored', 'enabled')]
    const { host } = await newExtensionHost({
      'com.broken': () => {
        throw new Error('boom')
      },
    })

    await host.startAll({
      bundledDirectory: writeBundle({ 'com.new': [], 'com.broken': [] }),
      beforeActivation: ready,
    })

    expect(logged).toContain('Extension com.stored activated')
    expect(logged).toContain('Extension com.new activated')
    expect(logged).not.toContain('Extension com.broken activated')
    expect(logged).toContain('Extension com.broken failed to load: boom')
  })
})

describe('ExtensionHost.start — listing and stored extensions', () => {
  it('lists extensions as soon as start is called, before any is activated, and activates only after beforeActivation', async () => {
    const { host, backendHost } = await newExtensionHost()
    let releaseActivation = () => {}
    const gate = new Promise<void>((resolve) => (releaseActivation = resolve))

    const started = host.startAll({
      bundledDirectory: writeBundle({ 'com.late': [] }),
      beforeActivation: gate,
    })

    expect(host.listAll().map((e) => e.id)).toEqual(['com.late'])
    expect(backendHost.activated).toEqual([])

    releaseActivation()
    await started
    expect(backendHost.activated.map((record) => record.id)).toEqual(['com.late'])
  })

  it('activates an extension already stored as enabled, without registering it twice', async () => {
    writeBundle({ 'com.stored': [] })
    storeData.extensions = [storedExtensionRecord(bundle, 'com.stored', 'enabled')]
    const { host, backendHost } = await newExtensionHost()

    await host.startAll({ bundledDirectory: bundle, beforeActivation: ready })

    expect(backendHost.activated.map((record) => record.id)).toEqual(['com.stored'])
    expect(host.listAll()).toHaveLength(1)
  })
})

const insightsSection = { label: 'Contributions', view: 'home' }

/** The manifest after a pull: a new version that adds a renderer and an Insights section. */
const pulledManifest = {
  id: 'com.stored',
  name: 'Stored',
  version: '2.0.0',
  description: 'Updated',
  main: 'main.js',
  renderer: 'dist/index.html',
  minAppVersion: '0.0.1',
  contributes: { insightsSection },
}

describe('ExtensionHost.start — stored records follow their manifest', () => {
  it('lists a stored extension with what its manifest declares now, not when it was stored', async () => {
    const directory = join(writeBundle({ 'com.stored': [] }), 'com.stored')
    storeData.extensions = [storedExtensionRecord(bundle, 'com.stored', 'enabled')]
    writeFileSync(join(directory, 'manifest.json'), JSON.stringify(pulledManifest))
    const { host } = await newExtensionHost()

    await host.startAll({ bundledDirectory: bundle, beforeActivation: ready })

    expect(host.listAll()[0]).toMatchObject({
      version: '2.0.0',
      rendererUrl: 'ext://com.stored/dist/index.html',
      contributes: { insightsSection },
    })
    expect(host.getExtensionContributes('com.stored')).toMatchObject({ insightsSection })
  })

  it('keeps a stored extension whose manifest no longer parses as it was stored', async () => {
    const directory = join(writeBundle({ 'com.stored': [] }), 'com.stored')
    const stored = storedExtensionRecord(bundle, 'com.stored', 'enabled')
    storeData.extensions = [stored]
    writeFileSync(join(directory, 'manifest.json'), '{ not json')
    const { host } = await newExtensionHost()

    await host.startAll({ bundledDirectory: bundle, beforeActivation: ready })

    expect(host.listAll()[0]).toMatchObject({ id: 'com.stored', version: stored.version })
  })
})

describe('ExtensionHost.start — disabled extensions and whenActivated', () => {
  it('does not activate an extension stored as disabled', async () => {
    writeBundle({ 'com.off': [] })
    storeData.extensions = [storedExtensionRecord(bundle, 'com.off', 'disabled')]
    const { host, backendHost } = await newExtensionHost()

    await host.startAll({ bundledDirectory: bundle, beforeActivation: ready })

    expect(backendHost.activated).toEqual([])
  })

  it('whenActivated waits for that extension only, not for a slower one', async () => {
    let finishSlow = () => {}
    const { host, backendHost } = await newExtensionHost({
      'com.slow': () => new Promise<void>((resolve) => (finishSlow = resolve)),
    })

    const started = host.startAll({
      bundledDirectory: writeBundle({ 'com.quick': [], 'com.slow': [] }),
      beforeActivation: ready,
    })
    await host.whenActivated('com.quick')

    expect(backendHost.activated.map((record) => record.id)).toEqual(['com.quick'])
    finishSlow()
    await started
  })
})

describe('ExtensionHost.whenActivated', () => {
  it('whenActivated resolves at once for an unknown extension', async () => {
    const { host } = await newExtensionHost()
    await host.startAll({ bundledDirectory: '/nonexistent/bundle', beforeActivation: ready })
    await expect(host.whenActivated('com.unknown')).resolves.toBeUndefined()
  })
})

describe('ExtensionHost.start with extensionDependencies (ADR 094)', () => {
  it('activates a dependency first and tells the extension host what the dependant declared', async () => {
    const events: string[] = []
    const { host, backendHost } = await newExtensionHost({
      'com.a-consumer': () => {
        events.push('consumer')
      },
      'com.z-provider': async () => {
        events.push('provider')
      },
    })

    // Directory order would activate the consumer first.
    await host.startAll({
      bundledDirectory: writeBundle({ 'com.a-consumer': ['com.z-provider'], 'com.z-provider': [] }),
      beforeActivation: ready,
    })

    expect(events).toEqual(['provider', 'consumer'])
    expect(backendHost.activated.find((record) => record.id === 'com.a-consumer')).toMatchObject({
      dependencies: ['com.z-provider'],
    })
    expect(extensionsById(host)['com.a-consumer']).toMatchObject({ status: 'enabled' })
  })
})

describe('ExtensionHost.start with extensionDependencies — missing dependencies', () => {
  it('fails activation with a clear message when a dependency is not installed', async () => {
    const { host, backendHost } = await newExtensionHost()

    await host.startAll({
      bundledDirectory: writeBundle({ 'com.orphan': ['com.missing'] }),
      beforeActivation: ready,
    })

    expect(extensionsById(host)['com.orphan']).toMatchObject({
      status: 'error',
      errorMessage: 'Missing extension dependency "com.missing"',
    })
    expect(backendHost.activated).toEqual([])
  })

  it('fails activation when a dependency itself failed to activate', async () => {
    const { host, backendHost } = await newExtensionHost({
      'com.broken': () => {
        throw new Error('boom')
      },
    })

    await host.startAll({
      bundledDirectory: writeBundle({ 'com.broken': [], 'com.dependant': ['com.broken'] }),
      beforeActivation: ready,
    })

    expect(extensionsById(host)['com.dependant']).toMatchObject({
      status: 'error',
      errorMessage: 'Extension dependency "com.broken" failed to activate',
    })
    expect(backendHost.activated).toEqual([])
  })
})

describe('ExtensionHost.start with extensionDependencies — cycles', () => {
  it('fails every extension in a dependency cycle, naming the cycle, and activates the rest', async () => {
    const { host, backendHost } = await newExtensionHost()

    await host.startAll({
      bundledDirectory: writeBundle({
        'com.one': ['com.two'],
        'com.two': ['com.one'],
        'com.free': [],
      }),
      beforeActivation: ready,
    })

    const extensions = extensionsById(host)
    expect(extensions['com.one']).toMatchObject({
      errorMessage: 'Extension dependency cycle: com.one -> com.two -> com.one',
    })
    expect(extensions['com.two']).toMatchObject({
      errorMessage: 'Extension dependency cycle: com.two -> com.one -> com.two',
    })
    expect(backendHost.activated.map((record) => record.id)).toEqual(['com.free'])
  })
})
