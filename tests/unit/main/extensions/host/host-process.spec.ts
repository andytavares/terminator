import { describe, it, expect, vi, afterEach } from 'vitest'
import { MessageChannel, type MessagePort } from 'node:worker_threads'
import { z } from 'zod'
import { defineChannel, dispatchChannel } from '@terminator/extension-sdk'
import type { ChannelSpec, ExtensionAPI, ExtensionDB } from '@terminator/extension-sdk'

vi.mock('electron', () => ({ utilityProcess: {}, MessageChannelMain: class {} }))

import {
  ExtensionHostProcess,
  type SpawnedHost,
} from '../../../../../src/main/extensions/host/host-process'
import { HostRuntime } from '../../../../../src/main/extensions/host/host-runtime'
import { RpcEndpoint, type MessageLink } from '../../../../../src/main/extensions/host/rpc-endpoint'
import type { HostSnapshot } from '../../../../../src/main/extensions/host/snapshot'

const ports: MessagePort[] = []
afterEach(() => {
  for (const port of ports.splice(0)) port.close()
})

function link(port: MessagePort): MessageLink {
  ports.push(port)
  return { post: (m) => port.postMessage(m), listen: (receive) => port.on('message', receive) }
}

function snapshot(): HostSnapshot {
  return {
    databasePath: ':memory:',
    paths: { app: '/app', userData: '/data' },
    settings: { 'demo.greeting': 'hello' },
    workspaces: { workspaces: [], projects: {} },
    trackers: {
      linear: { transitions: true, create: true },
      jira: { transitions: true, create: false },
    },
  }
}

/** The main side of the API the server calls into: only what these backends use. */
function mainApi() {
  const channels = new Map<string, ChannelSpec>()
  const dataListeners: Array<(data: string) => void> = []
  const api = {
    ipc: {
      registerHandler: vi.fn((spec: ChannelSpec) => {
        channels.set(spec.channel, spec)
        return { dispose: () => channels.delete(spec.channel) }
      }),
    },
    pty: {
      onData: vi.fn((_session: string, listener: (data: string) => void) => {
        dataListeners.push(listener)
        return () => dataListeners.splice(dataListeners.indexOf(listener), 1)
      }),
    },
    window: { broadcast: vi.fn() },
  }
  return { api: api as unknown as ExtensionAPI, raw: api, channels, dataListeners }
}

/** A backend that registers a validated channel and relays a session's output. */
const backend = {
  activate(api: ExtensionAPI) {
    api.ipc.registerHandler(
      defineChannel({
        channel: 'demo:greet',
        schema: z.object({ name: z.string() }),
        invalid: { error: 'VALIDATION_ERROR' },
        run: ({ name }) => `${api.settings.get<string>('demo.greeting')}, ${name}`,
      })
    )
    api.pty.onData('session-1', (data) => api.window.broadcast('demo:output', data))
    return { version: 1 }
  },
}

type BackendModule = { activate(api: ExtensionAPI): unknown }

/** A host process whose "process" is a HostRuntime on the other end of a MessageChannel. */
function harness(modules: Record<string, BackendModule> = {}) {
  const main = mainApi()
  const exits: Array<(code: number) => void> = []
  const spawned = vi.fn((initial: HostSnapshot): SpawnedHost => {
    const { port1, port2 } = new MessageChannel()
    const endpoint = new RpcEndpoint(link(port2))
    const loader = { load: (entry: string) => modules[entry] ?? backend, forget: () => {} }
    new HostRuntime(endpoint, initial, {} as ExtensionDB, loader)
    return { link: link(port1), onExit: (listener) => exits.push(listener), kill: vi.fn() }
  })
  const onBackendsFailed = vi.fn()
  const process = new ExtensionHostProcess({
    spawn: spawned,
    snapshot,
    apiFor: (id) => (id === 'demo' ? main.api : undefined),
    onBackendsFailed,
    log: () => {},
  })
  const record = { id: 'demo', entryPoint: '/demo/main.cjs', directory: '/demo', dependencies: [] }
  const crash = (code: number) => exits.at(-1)!(code)
  return { main, process, record, spawned, onBackendsFailed, crash }
}

describe('extension backends in the extension host', () => {
  it('answers a channel with the backend, its schema checked in the host', async () => {
    const { main, process, record } = harness()
    await process.activate(record)
    const spec = main.channels.get('demo:greet')!

    await expect(dispatchChannel(spec, { name: 'Ada' })).resolves.toBe('hello, Ada')
    await expect(dispatchChannel(spec, { name: 3 })).resolves.toEqual({ error: 'VALIDATION_ERROR' })
  })

  it('reads settings from the snapshot main pushes', async () => {
    const { main, process, record } = harness()
    await process.activate(record)
    process.pushSettings({ 'demo.greeting': 'hi' })
    const spec = main.channels.get('demo:greet')!

    await vi.waitFor(async () =>
      expect(await dispatchChannel(spec, { name: 'Ada' })).toBe('hi, Ada')
    )
  })

  it("calls the backend's listener when main's fires", async () => {
    const { main, process, record } = harness()
    await process.activate(record)
    await vi.waitFor(() => expect(main.dataListeners).toHaveLength(1))

    main.dataListeners[0]('ls\r\n')
    await vi.waitFor(() =>
      expect(main.raw.window.broadcast).toHaveBeenCalledWith('demo:output', 'ls\r\n')
    )
  })

  it('ends what a backend registered in main when it is deactivated', async () => {
    const { main, process, record } = harness()
    await process.activate(record)
    await vi.waitFor(() => expect(main.dataListeners).toHaveLength(1))

    await process.deactivate('demo')
    expect(main.channels.has('demo:greet')).toBe(false)
    expect(main.dataListeners).toHaveLength(0)
  })

  it('starts the host again once after it exits, and activates its backends again', async () => {
    const { main, process, record, spawned, crash, onBackendsFailed } = harness()
    await process.activate(record)
    crash(1)

    expect(main.channels.has('demo:greet')).toBe(false)
    await vi.waitFor(() => expect(main.channels.has('demo:greet')).toBe(true))
    expect(spawned).toHaveBeenCalledTimes(2)
    expect(onBackendsFailed).not.toHaveBeenCalled()
  })

  it('fails the backends when the restarted host exits too', async () => {
    const { process, record, spawned, crash, onBackendsFailed } = harness()
    await process.activate(record)
    crash(1)
    await vi.waitFor(() => expect(spawned).toHaveBeenCalledTimes(2))
    crash(134)

    expect(onBackendsFailed).toHaveBeenCalledWith(['demo'], 'Extension host exited with code 134')
    expect(spawned).toHaveBeenCalledTimes(2)
  })

  it('hands a backend the exports of a dependency it declared, and refuses one it did not', async () => {
    const seen: unknown[] = []
    const provider: BackendModule = { activate: () => ({ secret: 1 }) }
    const reader: BackendModule = { activate: (api) => seen.push(api.extensions.get('provider')) }
    const { process } = harness({ '/p.cjs': provider, '/r.cjs': reader })
    await process.activate({
      id: 'provider',
      entryPoint: '/p.cjs',
      directory: '/',
      dependencies: [],
    })

    await process.activate({
      id: 'declared',
      entryPoint: '/r.cjs',
      directory: '/',
      dependencies: ['provider'],
    })
    await expect(
      process.activate({ id: 'snoop', entryPoint: '/r.cjs', directory: '/', dependencies: [] })
    ).rejects.toThrow('Extension "snoop" did not declare "provider" in extensionDependencies')
    expect(seen).toEqual([{ secret: 1 }])
  })

  it('activates backends again in dependency order: a consumer sees its provider after a restart', async () => {
    const seen: unknown[] = []
    const provider: BackendModule = {
      async activate() {
        await new Promise((resolve) => setTimeout(resolve, 10))
        return { greet: () => 'hello' }
      },
    }
    const consumer: BackendModule = {
      activate: (api) => seen.push(api.extensions.get<{ greet(): string }>('provider')?.greet()),
    }
    const { process, crash, onBackendsFailed } = harness({ '/p.cjs': provider, '/c.cjs': consumer })
    await process.activate({
      id: 'provider',
      entryPoint: '/p.cjs',
      directory: '/',
      dependencies: [],
    })
    await process.activate({
      id: 'consumer',
      entryPoint: '/c.cjs',
      directory: '/',
      dependencies: ['provider'],
    })

    crash(1)

    await vi.waitFor(() => expect(seen).toHaveLength(2))
    expect(seen).toEqual(['hello', 'hello'])
    expect(onBackendsFailed).not.toHaveBeenCalled()
  })

  it('fails a consumer whose provider does not come back after a restart', async () => {
    let providerStarts = 0
    const provider: BackendModule = {
      activate() {
        if (++providerStarts > 1) throw new Error('provider broke')
        return {}
      },
    }
    const consumer: BackendModule = { activate: vi.fn() }
    const { process, crash, onBackendsFailed } = harness({ '/p.cjs': provider, '/c.cjs': consumer })
    await process.activate({
      id: 'provider',
      entryPoint: '/p.cjs',
      directory: '/',
      dependencies: [],
    })
    await process.activate({
      id: 'consumer',
      entryPoint: '/c.cjs',
      directory: '/',
      dependencies: ['provider'],
    })

    crash(1)

    await vi.waitFor(() => expect(onBackendsFailed).toHaveBeenCalledTimes(2))
    expect(onBackendsFailed).toHaveBeenCalledWith(
      ['consumer'],
      'Extension host exited with code 1; restart failed: Extension dependency "provider" failed to activate'
    )
    expect(consumer.activate).toHaveBeenCalledTimes(1)
  })
})
