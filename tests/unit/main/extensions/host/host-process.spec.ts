import { describe, it, expect, vi, afterEach } from 'vitest'
import { MessageChannel, type MessagePort } from 'node:worker_threads'
import { z } from 'zod'
import { defineChannel, dispatchChannel } from '@terminator/extension-sdk'
import type {
  ChannelSpec,
  CommandContext,
  CommandContribution,
  ExtensionAPI,
  ExtensionDB,
} from '@terminator/extension-sdk'

vi.mock('electron', () => ({ utilityProcess: {}, MessageChannelMain: class {} }))

import {
  ExtensionHostProcess,
  type SpawnedHost,
} from '../../../../../src/main/extensions/host/host-process'
import { HostRuntime } from '../../../../../src/main/extensions/host/host-runtime'
import { RpcEndpoint, type MessageLink } from '../../../../../src/main/extensions/host/rpc-endpoint'
import { hostSnapshot } from '../../../../support/host-snapshot'
import type { HostSnapshot } from '../../../../../src/main/extensions/host/snapshot'
import type { BackendModule } from '../../../../../src/main/extensions/host/backend-loader'
import { partialFake } from '../../../../support/fakes'

const ports: MessagePort[] = []
afterEach(() => {
  for (const port of ports.splice(0)) port.close()
})

function link(port: MessagePort): MessageLink {
  ports.push(port)
  return { post: (m) => port.postMessage(m), listen: (receive) => port.on('message', receive) }
}

/** Main's command registry, as far as these backends reach it. */
function commandsInMain() {
  const commands = new Map<string, (context: CommandContext, args?: unknown) => unknown>()
  const api = partialFake<ExtensionAPI['commands']>({
    register: (command: CommandContribution, handler: never) => {
      commands.set(command.id, handler)
      return { dispose: () => void commands.delete(command.id) }
    },
  })
  return { commands, api }
}

/** Main's channel registry and a session's output listeners. */
function channelsAndOutputInMain() {
  const channels = new Map<string, ChannelSpec>()
  const dataListeners: Array<(data: string) => void> = []
  const ipc = partialFake<ExtensionAPI['ipc']>({
    registerHandler: (spec: ChannelSpec) => {
      channels.set(spec.channel, spec)
      return { dispose: () => void channels.delete(spec.channel) }
    },
  })
  const pty = partialFake<ExtensionAPI['pty']>({
    onData: (_session: string, listener: (data: string) => void) => {
      dataListeners.push(listener)
      return () => void dataListeners.splice(dataListeners.indexOf(listener), 1)
    },
  })
  return { channels, dataListeners, ipc, pty }
}

/** The main side of the API the server calls into: only what these backends use. */
function mainApi() {
  const broadcast = vi.fn<ExtensionAPI['window']['broadcast']>()
  const transition = vi.fn<ExtensionAPI['issues']['transition']>(async () => undefined)
  const setSetting = vi.fn<ExtensionAPI['settings']['set']>()
  const { commands, api: commandsApi } = commandsInMain()
  const { channels, dataListeners, ipc, pty } = channelsAndOutputInMain()
  const api = partialFake<ExtensionAPI>({
    issues: partialFake<ExtensionAPI['issues']>({ transition }),
    settings: partialFake<ExtensionAPI['settings']>({
      set: setSetting,
      register: () => ({ dispose: () => {} }),
    }),
    commands: commandsApi,
    ipc,
    pty,
    window: partialFake<ExtensionAPI['window']>({ broadcast }),
  })
  return { api, broadcast, channels, commands, dataListeners, setSetting, transition }
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

/** A backend that answers `demo.signOff` as it applies to the path it is asked about. */
const signOffReader: BackendModule = {
  activate(api: ExtensionAPI) {
    api.settings.register({
      label: 'Demo',
      properties: {
        'demo.signOff': {
          type: 'boolean',
          label: 'Sign off',
          default: false,
          workspaceScoped: true,
        },
      },
    })
    api.ipc.registerHandler(
      defineChannel({
        channel: 'demo:sign-off',
        schema: z.object({ repoPath: z.string().optional() }),
        invalid: { error: 'VALIDATION_ERROR' },
        run: ({ repoPath }) =>
          api.settings.get<boolean>('demo.signOff', repoPath ? { repoPath } : undefined),
      })
    )
  },
}

/** A host process whose "process" is a HostRuntime on the other end of a MessageChannel. */
function harness(modules: Record<string, BackendModule> = {}) {
  const main = mainApi()
  const exits: Array<(code: number) => void> = []
  const spawned = vi.fn((initial: HostSnapshot): SpawnedHost => {
    const { port1, port2 } = new MessageChannel()
    const endpoint = new RpcEndpoint(link(port2))
    const loader = { load: (entry: string) => modules[entry] ?? backend, forget: () => {} }
    new HostRuntime(endpoint, { snapshot: initial, db: {} as ExtensionDB, loader })
    return { link: link(port1), onExit: (listener) => exits.push(listener), kill: vi.fn() }
  })
  const onBackendsFailed = vi.fn()
  const process = new ExtensionHostProcess({
    spawn: spawned,
    snapshot: () =>
      hostSnapshot({ settings: { global: { 'demo.greeting': 'hello' }, workspaces: {} } }),
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

  it("gives the backend the app's directory and its own folder under userData", async () => {
    const paths = {
      activate(api: ExtensionAPI) {
        api.ipc.registerHandler(
          defineChannel({
            channel: 'demo:paths',
            schema: z.object({}),
            invalid: { error: 'VALIDATION_ERROR' },
            run: () => api.paths,
          })
        )
      },
    }
    const { main, process, record } = harness({ '/demo/main.cjs': paths })
    await process.activate(record)

    await expect(dispatchChannel(main.channels.get('demo:paths')!, {})).resolves.toEqual({
      app: '/app',
      globalStorage: '/data/extensions/demo',
    })
  })
})

describe('extension backends — settings and listeners', () => {
  it('reads settings from the snapshot main pushes', async () => {
    const { main, process, record } = harness()
    await process.activate(record)
    process.pushSettings({ global: { 'demo.greeting': 'hi' }, workspaces: {} })
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
    await vi.waitFor(() => expect(main.broadcast).toHaveBeenCalledWith('demo:output', 'ls\r\n'))
  })

  it('ends what a backend registered in main when it is deactivated', async () => {
    const { main, process, record } = harness()
    await process.activate(record)
    await vi.waitFor(() => expect(main.dataListeners).toHaveLength(1))

    await process.deactivate('demo')
    expect(main.channels.has('demo:greet')).toBe(false)
    expect(main.dataListeners).toHaveLength(0)
  })
})

describe('extension backends — workspace-scoped settings', () => {
  it("reads a workspace's own value for a path in it, else the global value, else the default", async () => {
    const { main, process, record } = harness({ '/demo/main.cjs': signOffReader })
    await process.activate(record)
    process.pushWorkspaces({
      workspaces: [
        { id: 'ws-api', name: 'API', folderPath: '/code/api' },
        { id: 'ws-web', name: 'Web', folderPath: '/code/web' },
      ],
      projects: {},
    })
    const spec = main.channels.get('demo:sign-off')!
    await expect(dispatchChannel(spec, { repoPath: '/code/api' })).resolves.toBe(false)

    process.pushSettings({
      global: { 'demo.signOff': true },
      workspaces: { 'ws-api': { demo: { 'demo.signOff': false } } },
    })
    await vi.waitFor(async () =>
      expect(await dispatchChannel(spec, { repoPath: '/code/api' })).toBe(false)
    )
    await expect(dispatchChannel(spec, { repoPath: '/code/web' })).resolves.toBe(true)
    await expect(dispatchChannel(spec, {})).resolves.toBe(true)
  })
})

describe('extension backends — restarts', () => {
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
})

describe('extension backends — dependencies', () => {
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
})

/** Activates /p.cjs as "provider", then /c.cjs as "consumer", which depends on it. */
async function activateProviderThenConsumer(process: ExtensionHostProcess): Promise<void> {
  await process.activate({ id: 'provider', entryPoint: '/p.cjs', directory: '/', dependencies: [] })
  await process.activate({
    id: 'consumer',
    entryPoint: '/c.cjs',
    directory: '/',
    dependencies: ['provider'],
  })
}

describe('extension backends — dependencies across a restart', () => {
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
    await activateProviderThenConsumer(process)

    crash(1)

    await vi.waitFor(() => expect(seen).toHaveLength(2))
    expect(seen).toEqual(['hello', 'hello'])
    expect(onBackendsFailed).not.toHaveBeenCalled()
  })
})

describe('extension backends — a provider that does not come back', () => {
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
    await activateProviderThenConsumer(process)

    crash(1)

    await vi.waitFor(() => expect(onBackendsFailed).toHaveBeenCalledTimes(2))
    expect(onBackendsFailed).toHaveBeenCalledWith(
      ['consumer'],
      'Extension host exited with code 1; restart failed: Extension dependency "provider" failed to activate'
    )
    expect(consumer.activate).toHaveBeenCalledTimes(1)
  })
})

const NO_CONTEXT: CommandContext = { projectId: null, sessionId: null, repoRoot: null }

describe('calls a backend makes to main', () => {
  it('carries every argument of a call to main and waits for its answer', async () => {
    const mover: BackendModule = {
      activate: (api) => api.issues.transition('linear', 'TAV-1', 'started', 'opt-1'),
    }
    const { main, process, record } = harness({ '/demo/main.cjs': mover })
    await process.activate(record)
    expect(main.transition).toHaveBeenCalledWith('linear', 'TAV-1', 'started', 'opt-1')
  })

  it('delivers a call that does not wait for an answer', async () => {
    const setter: BackendModule = { activate: (api) => api.settings.set('demo.size', 3) }
    const { main, process, record } = harness({ '/demo/main.cjs': setter })
    await process.activate(record)
    await vi.waitFor(() => expect(main.setSetting).toHaveBeenCalledWith('demo.size', 3))
  })
})

describe('commands a backend registers', () => {
  it('runs the backend handler when main runs the command, with its arguments', async () => {
    const ran: unknown[] = []
    const greeter: BackendModule = {
      activate: (api) =>
        void api.commands.register(
          { id: 'hello', label: 'Hello', args: z.object({ name: z.string() }) },
          (_context, args) => void ran.push(args)
        ),
    }
    const { main, process, record } = harness({ '/demo/main.cjs': greeter })
    await process.activate(record)
    await vi.waitFor(() => expect(main.commands.has('hello')).toBe(true))
    await main.commands.get('hello')!(NO_CONTEXT, { name: 'Ada' })
    expect(ran).toEqual([{ name: 'Ada' }])
  })

  it('ends the registration in main when the backend disposes it', async () => {
    const once: BackendModule = {
      activate: (api) => api.commands.register({ id: 'once', label: 'Once' }, () => {}).dispose(),
    }
    const { main, process, record } = harness({ '/demo/main.cjs': once })
    await process.activate(record)
    await vi.waitFor(() => expect(main.commands.has('once')).toBe(false))
  })
})
