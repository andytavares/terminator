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

interface StartProbe {
  events: string[]
  peerStarted: Promise<void>
  markPeerStarted: () => void
}
const probe = globalThis as unknown as { __startProbe: StartProbe }

describe('ExtensionHost.start', () => {
  const bundles: string[] = []

  function makeBundle(activateByExtensionId: Record<string, string>): string {
    const bundle = join(os.tmpdir(), `ext-bundle-${Date.now()}-${bundles.length}`)
    for (const [id, activateSource] of Object.entries(activateByExtensionId)) {
      const dir = join(bundle, id)
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        join(dir, 'manifest.json'),
        JSON.stringify({
          id,
          name: id,
          version: '1.0.0',
          description: 'Test extension',
          main: 'main.js',
          minAppVersion: '0.0.1',
        })
      )
      writeFileSync(join(dir, 'main.js'), `exports.activate = ${activateSource}`)
    }
    bundles.push(bundle)
    return bundle
  }

  async function newHost() {
    const { ExtensionHost } = await import('../../../src/main/extensions/extension-host')
    return new ExtensionHost()
  }

  const ready = Promise.resolve()

  beforeEach(() => {
    vi.resetModules()
    storeData.extensions = []
    let markPeerStarted = () => {}
    const peerStarted = new Promise<void>((resolve) => (markPeerStarted = resolve))
    probe.__startProbe = { events: [], peerStarted, markPeerStarted }
  })

  afterEach(() => {
    for (const bundle of bundles.splice(0)) rmSync(bundle, { recursive: true, force: true })
  })

  it('activates extensions concurrently: one waits for another to have started', async () => {
    const bundle = makeBundle({
      'com.waiter': `async () => {
        const probe = globalThis.__startProbe
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('peer never started')), 1000))
        await Promise.race([probe.peerStarted, timeout])
        probe.events.push('waiter')
      }`,
      'com.peer': `() => {
        globalThis.__startProbe.markPeerStarted()
        globalThis.__startProbe.events.push('peer')
      }`,
    })
    const host = await newHost()

    await host.start({ bundledDirectory: bundle, beforeActivation: ready })

    expect([...probe.__startProbe.events].sort()).toEqual(['peer', 'waiter'])
    expect(host.listExtensions().map((e) => e.status)).toEqual(['enabled', 'enabled'])
  })

  it('marks a failing extension as errored and still activates the others', async () => {
    const bundle = makeBundle({
      'com.broken': `() => { throw new Error('boom') }`,
      'com.healthy': `() => { globalThis.__startProbe.events.push('healthy') }`,
    })
    const host = await newHost()

    await host.start({ bundledDirectory: bundle, beforeActivation: ready })

    const byId = Object.fromEntries(host.listExtensions().map((e) => [e.id, e]))
    expect(byId['com.broken'].status).toBe('error')
    expect(byId['com.broken'].errorMessage).toBe('boom')
    expect(byId['com.healthy'].status).toBe('enabled')
    expect(probe.__startProbe.events).toEqual(['healthy'])
  })

  it('lists extensions as soon as start is called, before any is activated, and activates only after beforeActivation', async () => {
    const bundle = makeBundle({
      'com.late': `() => { globalThis.__startProbe.events.push('activated') }`,
    })
    const host = await newHost()
    let release = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))

    const started = host.start({ bundledDirectory: bundle, beforeActivation: gate })

    expect(host.listExtensions().map((e) => e.id)).toEqual(['com.late'])
    expect(probe.__startProbe.events).toEqual([])

    release()
    await started
    expect(probe.__startProbe.events).toEqual(['activated'])
  })

  it('activates an extension already stored as enabled, without registering it twice', async () => {
    const bundle = makeBundle({
      'com.stored': `() => { globalThis.__startProbe.events.push('stored') }`,
    })
    const dir = join(bundle, 'com.stored')
    storeData.extensions = [
      {
        id: 'com.stored',
        name: 'Stored',
        version: '1.0.0',
        description: '',
        entryPoint: join(dir, 'main.js'),
        status: 'enabled',
        installedAt: new Date().toISOString(),
        directoryPath: dir,
      },
    ]
    const host = await newHost()

    await host.start({ bundledDirectory: bundle, beforeActivation: ready })

    expect(probe.__startProbe.events).toEqual(['stored'])
    expect(host.listExtensions()).toHaveLength(1)
  })

  it('does not activate an extension stored as disabled', async () => {
    const bundle = makeBundle({
      'com.off': `() => { globalThis.__startProbe.events.push('off') }`,
    })
    const dir = join(bundle, 'com.off')
    storeData.extensions = [
      {
        id: 'com.off',
        name: 'Off',
        version: '1.0.0',
        description: '',
        entryPoint: join(dir, 'main.js'),
        status: 'disabled',
        installedAt: new Date().toISOString(),
        directoryPath: dir,
      },
    ]
    const host = await newHost()

    await host.start({ bundledDirectory: bundle, beforeActivation: ready })

    expect(probe.__startProbe.events).toEqual([])
  })

  it('whenActivated waits for that extension only, not for a slower one', async () => {
    const bundle = makeBundle({
      'com.quick': `() => { globalThis.__startProbe.events.push('quick') }`,
      'com.slow': `() => new Promise(() => {})`,
    })
    const host = await newHost()

    void host.start({ bundledDirectory: bundle, beforeActivation: ready })
    await host.whenActivated('com.quick')

    expect(probe.__startProbe.events).toEqual(['quick'])
  })

  it('whenActivated also waits for afterActivation, which runs once every extension is done', async () => {
    const bundle = makeBundle({
      'com.first': `() => { globalThis.__startProbe.events.push('first') }`,
      'com.second': `async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
        globalThis.__startProbe.events.push('second')
      }`,
    })
    const host = await newHost()
    const afterActivation = async () => {
      probe.__startProbe.events.push('after')
    }

    void host.start({ bundledDirectory: bundle, beforeActivation: ready, afterActivation })
    await host.whenActivated('com.first')

    expect(probe.__startProbe.events).toEqual(['first', 'second', 'after'])
  })

  it('whenActivated resolves at once for an unknown extension', async () => {
    const host = await newHost()
    await host.start({ bundledDirectory: '/nonexistent/bundle', beforeActivation: ready })
    await expect(host.whenActivated('com.unknown')).resolves.toBeUndefined()
  })
})
