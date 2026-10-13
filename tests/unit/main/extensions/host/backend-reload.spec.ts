import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import os from 'node:os'
import { MessageChannel, type MessagePort } from 'node:worker_threads'
import type { ExtensionDB } from '@terminator/extension-sdk'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', getVersion: () => '0.1.0' },
  utilityProcess: {},
  MessageChannelMain: class {},
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

vi.mock('../../../../../src/main/storage/extension-settings-store', () => ({
  getExtensionSetting: () => undefined,
  setExtensionSetting: vi.fn(),
  getAllExtensionSettings: () => ({}),
}))

import type { ExtensionHost } from '../../../../../src/main/extensions/extension-host'
import { ExtensionHostProcess } from '../../../../../src/main/extensions/host/host-process'
import { HostRuntime } from '../../../../../src/main/extensions/host/host-runtime'
import { requireLoader } from '../../../../../src/main/extensions/host/backend-loader'
import { RpcEndpoint, type MessageLink } from '../../../../../src/main/extensions/host/rpc-endpoint'
import { hostSnapshot } from '../../../../support/host-snapshot'

/** What the backends below write when they activate: the code that ran. */
const ran = globalThis as { backendVersion?: string }

let root: string
const ports: MessagePort[] = []

beforeEach(() => {
  vi.resetModules() // the extension store caches what it read
  storeData.extensions = []
  delete ran.backendVersion
  root = join(os.tmpdir(), `backend-reload-${Date.now()}-${Math.random()}`)
  mkdirSync(join(root, 'com.reload', 'lib'), { recursive: true })
})

afterEach(() => {
  for (const port of ports.splice(0)) port.close()
  rmSync(root, { recursive: true, force: true })
})

function link(port: MessagePort): MessageLink {
  ports.push(port)
  return { post: (m) => port.postMessage(m), listen: (receive) => port.on('message', receive) }
}

/** The extension directory: a manifest, a backend, and a module the backend requires. */
function writeExtension(): string {
  const directory = join(root, 'com.reload')
  const manifest = { id: 'com.reload', name: 'Reload', version: '1.0.0', main: 'main.cjs' }
  writeFileSync(
    join(directory, 'manifest.json'),
    JSON.stringify({ ...manifest, description: 'Reload test', minAppVersion: '0.0.1' })
  )
  writeBackend(directory, 'main')
  writeVersion(directory, 'v1')
  return directory
}

/** `main.cjs` reports `<tag>:<version from lib/version.cjs>`; `throw` makes it fail instead. */
function writeBackend(directory: string, tag: string, fails = false): void {
  const body = fails
    ? `throw new Error('broken backend')`
    : `globalThis.backendVersion = '${tag}:' + require('./lib/version.cjs')`
  writeFileSync(join(directory, 'main.cjs'), `exports.activate = () => { ${body} }\n`)
}

function writeVersion(directory: string, version: string): void {
  writeFileSync(join(directory, 'lib', 'version.cjs'), `module.exports = '${version}'\n`)
}

/** ExtensionHost over a real extension host runtime, its backends required from disk. */
async function extensionHost(): Promise<ExtensionHost> {
  const { ExtensionHost } = await import('../../../../../src/main/extensions/extension-host')
  const loader = requireLoader(createRequire(import.meta.url))
  let host: ExtensionHost | undefined = undefined
  const backends = new ExtensionHostProcess({
    spawn: (initial) => {
      const { port1, port2 } = new MessageChannel()
      new HostRuntime(new RpcEndpoint(link(port2)), {
        snapshot: initial,
        db: {} as ExtensionDB,
        loader,
      })
      return { link: link(port1), onExit: () => {}, kill: () => {} }
    },
    snapshot: () => hostSnapshot(),
    apiFor: (id) => host?.hostedApi(id),
    onBackendsFailed: () => {},
    log: () => {},
  })
  host = new ExtensionHost(backends)
  return host
}

describe('reloading a backend in the extension host', () => {
  it('runs the backend file as it is on disk now', async () => {
    const host = await extensionHost()
    const directory = writeExtension()
    await host.load(directory)
    expect(ran.backendVersion).toBe('main:v1')

    writeBackend(directory, 'edited')
    await expect(host.reload('com.reload')).resolves.toMatchObject({ extension: {} })

    expect(ran.backendVersion).toBe('edited:v1')
  })

  it('runs the modules under its directory as they are on disk now', async () => {
    const host = await extensionHost()
    const directory = writeExtension()
    await host.load(directory)

    writeVersion(directory, 'v2')
    await host.reload('com.reload')

    expect(ran.backendVersion).toBe('main:v2')
  })

  it('runs the fixed file after a version whose activate threw', async () => {
    const host = await extensionHost()
    const directory = writeExtension()
    writeBackend(directory, 'main', true)
    await host.load(directory)
    expect(ran.backendVersion).toBeUndefined()

    writeBackend(directory, 'fixed')
    await expect(host.reload('com.reload')).resolves.toMatchObject({ extension: {} })

    expect(ran.backendVersion).toBe('fixed:v1')
  })
})
