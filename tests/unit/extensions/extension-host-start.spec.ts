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

// What the host writes to the main log, which `scripts/smoke-start.mjs` reads
// to tell that every bundled extension came up.
const logged: string[] = []
vi.mock('../../../src/main/logger', () => {
  const write = (message: string) => logged.push(message)
  const log = { debug: write, info: write, warn: write, error: write }
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

function storedRecord(id: string, status: 'enabled' | 'disabled') {
  const directoryPath = join(bundle, id)
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

function byId(host: { listExtensions(): Array<{ id: string }> }) {
  return Object.fromEntries(host.listExtensions().map((e) => [e.id, e]))
}

const ready = Promise.resolve()

describe('ExtensionHost.start', () => {
  it('activates extensions concurrently: one waits for another to have started', async () => {
    let markPeerStarted = () => {}
    const peerStarted = new Promise<void>((resolve) => (markPeerStarted = resolve))
    const { host, backendHost } = await newHost({
      'com.waiter': async () => {
        // Started here, not before newHost: importing the host can take longer
        // than the timeout, and a rejection nothing awaits yet fails the run.
        // Cleared once the race is decided, for the same reason.
        let timer: ReturnType<typeof setTimeout> | undefined
        const timeout = new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('peer never started')), 1000)
        })
        await Promise.race([peerStarted, timeout]).finally(() => clearTimeout(timer))
      },
      'com.peer': () => markPeerStarted(),
    })

    await host.start({
      bundledDirectory: writeBundle({ 'com.waiter': [], 'com.peer': [] }),
      beforeActivation: ready,
    })

    expect(backendHost.activated.map((record) => record.id)).toEqual(['com.peer', 'com.waiter'])
    expect(host.listExtensions().map((e) => e.status)).toEqual(['enabled', 'enabled'])
  })

  it('marks a failing extension as errored and still activates the others', async () => {
    const { host, backendHost } = await newHost({
      'com.broken': () => {
        throw new Error('boom')
      },
    })

    await host.start({
      bundledDirectory: writeBundle({ 'com.broken': [], 'com.healthy': [] }),
      beforeActivation: ready,
    })

    const extensions = byId(host)
    expect(extensions['com.broken']).toMatchObject({ status: 'error', errorMessage: 'boom' })
    expect(extensions['com.healthy']).toMatchObject({ status: 'enabled' })
    expect(backendHost.activated.map((record) => record.id)).toEqual(['com.healthy'])
  })

  it('logs every extension it activates, new or stored, and never one that failed', async () => {
    writeBundle({ 'com.stored': [] })
    storeData.extensions = [storedRecord('com.stored', 'enabled')]
    const { host } = await newHost({
      'com.broken': () => {
        throw new Error('boom')
      },
    })

    await host.start({
      bundledDirectory: writeBundle({ 'com.new': [], 'com.broken': [] }),
      beforeActivation: ready,
    })

    expect(logged).toContain('Extension com.stored activated')
    expect(logged).toContain('Extension com.new activated')
    expect(logged).not.toContain('Extension com.broken activated')
    expect(logged).toContain('Extension com.broken failed to load: boom')
  })

  it('lists extensions as soon as start is called, before any is activated, and activates only after beforeActivation', async () => {
    const { host, backendHost } = await newHost()
    let release = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))

    const started = host.start({
      bundledDirectory: writeBundle({ 'com.late': [] }),
      beforeActivation: gate,
    })

    expect(host.listExtensions().map((e) => e.id)).toEqual(['com.late'])
    expect(backendHost.activated).toEqual([])

    release()
    await started
    expect(backendHost.activated.map((record) => record.id)).toEqual(['com.late'])
  })

  it('activates an extension already stored as enabled, without registering it twice', async () => {
    writeBundle({ 'com.stored': [] })
    storeData.extensions = [storedRecord('com.stored', 'enabled')]
    const { host, backendHost } = await newHost()

    await host.start({ bundledDirectory: bundle, beforeActivation: ready })

    expect(backendHost.activated.map((record) => record.id)).toEqual(['com.stored'])
    expect(host.listExtensions()).toHaveLength(1)
  })

  it('does not activate an extension stored as disabled', async () => {
    writeBundle({ 'com.off': [] })
    storeData.extensions = [storedRecord('com.off', 'disabled')]
    const { host, backendHost } = await newHost()

    await host.start({ bundledDirectory: bundle, beforeActivation: ready })

    expect(backendHost.activated).toEqual([])
  })

  it('whenActivated waits for that extension only, not for a slower one', async () => {
    const { host, backendHost } = await newHost({ 'com.slow': () => new Promise(() => {}) })

    void host.start({
      bundledDirectory: writeBundle({ 'com.quick': [], 'com.slow': [] }),
      beforeActivation: ready,
    })
    await host.whenActivated('com.quick')

    expect(backendHost.activated.map((record) => record.id)).toEqual(['com.quick'])
  })

  it('whenActivated also waits for afterActivation, which runs once every extension is done', async () => {
    const events: string[] = []
    const { host } = await newHost({
      'com.first': () => {
        events.push('first')
      },
      'com.second': async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
        events.push('second')
      },
    })
    const afterActivation = async () => {
      events.push('after')
    }

    void host.start({
      bundledDirectory: writeBundle({ 'com.first': [], 'com.second': [] }),
      beforeActivation: ready,
      afterActivation,
    })
    await host.whenActivated('com.first')

    expect(events).toEqual(['first', 'second', 'after'])
  })

  it('whenActivated resolves at once for an unknown extension', async () => {
    const { host } = await newHost()
    await host.start({ bundledDirectory: '/nonexistent/bundle', beforeActivation: ready })
    await expect(host.whenActivated('com.unknown')).resolves.toBeUndefined()
  })
})

describe('ExtensionHost.start with extensionDependencies (ADR 094)', () => {
  it('activates a dependency first and tells the extension host what the dependant declared', async () => {
    const events: string[] = []
    const { host, backendHost } = await newHost({
      'com.a-consumer': () => {
        events.push('consumer')
      },
      'com.z-provider': async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        events.push('provider')
      },
    })

    // Directory order would activate the consumer first.
    await host.start({
      bundledDirectory: writeBundle({ 'com.a-consumer': ['com.z-provider'], 'com.z-provider': [] }),
      beforeActivation: ready,
    })

    expect(events).toEqual(['provider', 'consumer'])
    expect(backendHost.activated.find((record) => record.id === 'com.a-consumer')).toMatchObject({
      dependencies: ['com.z-provider'],
    })
    expect(byId(host)['com.a-consumer']).toMatchObject({ status: 'enabled' })
  })

  it('fails activation with a clear message when a dependency is not installed', async () => {
    const { host, backendHost } = await newHost()

    await host.start({
      bundledDirectory: writeBundle({ 'com.orphan': ['com.missing'] }),
      beforeActivation: ready,
    })

    expect(byId(host)['com.orphan']).toMatchObject({
      status: 'error',
      errorMessage: 'Missing extension dependency "com.missing"',
    })
    expect(backendHost.activated).toEqual([])
  })

  it('fails activation when a dependency itself failed to activate', async () => {
    const { host, backendHost } = await newHost({
      'com.broken': () => {
        throw new Error('boom')
      },
    })

    await host.start({
      bundledDirectory: writeBundle({ 'com.broken': [], 'com.dependant': ['com.broken'] }),
      beforeActivation: ready,
    })

    expect(byId(host)['com.dependant']).toMatchObject({
      status: 'error',
      errorMessage: 'Extension dependency "com.broken" failed to activate',
    })
    expect(backendHost.activated).toEqual([])
  })

  it('fails every extension in a dependency cycle, naming the cycle, and activates the rest', async () => {
    const { host, backendHost } = await newHost()

    await host.start({
      bundledDirectory: writeBundle({
        'com.one': ['com.two'],
        'com.two': ['com.one'],
        'com.free': [],
      }),
      beforeActivation: ready,
    })

    const extensions = byId(host)
    expect(extensions['com.one']).toMatchObject({
      errorMessage: 'Extension dependency cycle: com.one -> com.two -> com.one',
    })
    expect(extensions['com.two']).toMatchObject({
      errorMessage: 'Extension dependency cycle: com.two -> com.one -> com.two',
    })
    expect(backendHost.activated.map((record) => record.id)).toEqual(['com.free'])
  })
})
