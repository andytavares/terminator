import { describe, it, expect, vi, afterEach } from 'vitest'
import { MessageChannel, type MessagePort } from 'node:worker_threads'
import { z } from 'zod'
import { defineChannel, dispatchChannel } from '@terminator/extension-sdk'
import type {
  AgentPermissionAsk,
  AgentUpdate,
  ChannelSpec,
  ExtensionAPI,
  ExtensionDB,
} from '@terminator/extension-sdk'

vi.mock('electron', () => ({ utilityProcess: {}, MessageChannelMain: class {} }))

import {
  ExtensionHostProcess,
  type SpawnedHost,
} from '../../../../../src/main/extensions/host/host-process'
import { HostRuntime } from '../../../../../src/main/extensions/host/host-runtime'
import { RpcEndpoint } from '../../../../../src/main/extensions/host/rpc-endpoint'
import { hostSnapshot } from '../../../../support/host-snapshot'
import type { BackendModule } from '../../../../../src/main/extensions/host/backend-loader'
import { partialFake } from '../../../../support/fakes'
import { workerPortLink } from '../../../../support/message-ports'
import { eventually } from '../../../../support/eventually'

const ports: MessagePort[] = []
afterEach(() => {
  for (const port of ports.splice(0)) port.close()
})

/** An extension that forwards each `api.agents` call it is given through a channel. */
const backend: BackendModule = {
  activate(api: ExtensionAPI) {
    const channel = (name: string, run: () => unknown) =>
      api.ipc.registerHandler(
        defineChannel({ channel: `demo:${name}`, schema: z.any(), invalid: {}, run })
      )
    channel('start', () => api.agents.start({ cwd: '/work' }))
    channel('prompt', () => api.agents.prompt('s1', 'hello'))
    channel('answer', () => api.agents.answer('s1', 'r1', null))
    channel('cancel', () => api.agents.cancel('s1'))
    channel('listen', () => {
      api.agents.onUpdate('s1', (update) => api.window.broadcast('demo:update', update))
      api.agents.onPermission('s1', (ask) => api.window.broadcast('demo:ask', ask))
      api.agents.onEnd('s1', (code) => api.window.broadcast('demo:end', code))
      api.agents.onPermissionSettled('s1', (id) => api.window.broadcast('demo:settled', id))
    })
  },
}

type Listeners = {
  update?: (update: AgentUpdate) => void
  ask?: (ask: AgentPermissionAsk) => void
  end?: (exitCode: number | null) => void
  settled?: (requestId: string) => void
}

/** Main's agents: calls are spies, and the listeners an extension adds are kept for the test. */
function agentsInMain(listeners: Listeners) {
  return partialFake<ExtensionAPI['agents']>({
    start: vi.fn(async () => ({ sessionId: 's1', agentId: 'claude', configOptions: [] })),
    prompt: vi.fn(async () => ({ stopReason: 'end_turn' })),
    answer: vi.fn(async () => true),
    cancel: vi.fn(),
    onUpdate: (_session: string, listener: (update: AgentUpdate) => void) => {
      listeners.update = listener
      return () => void delete listeners.update
    },
    onPermission: (_session: string, listener: (ask: AgentPermissionAsk) => void) => {
      listeners.ask = listener
      return () => void delete listeners.ask
    },
    onPermissionSettled: (_session: string, listener: (requestId: string) => void) => {
      listeners.settled = listener
      return () => void delete listeners.settled
    },
    onEnd: (_session: string, listener: (exitCode: number | null) => void) => {
      listeners.end = listener
      return () => void delete listeners.end
    },
  })
}

function mainApi(listeners: Listeners) {
  const channels = new Map<string, ChannelSpec>()
  const broadcast = vi.fn<ExtensionAPI['window']['broadcast']>()
  const agents = agentsInMain(listeners)
  const api = partialFake<ExtensionAPI>({
    agents,
    window: partialFake<ExtensionAPI['window']>({ broadcast }),
    ipc: partialFake<ExtensionAPI['ipc']>({
      registerHandler: (spec: ChannelSpec) => {
        channels.set(spec.channel, spec)
        return { dispose: () => void channels.delete(spec.channel) }
      },
    }),
  })
  return { api, agents, broadcast, channels }
}

function harness() {
  const listeners: Listeners = {}
  const main = mainApi(listeners)
  const process = new ExtensionHostProcess({
    spawn: (initial): SpawnedHost => {
      const { port1, port2 } = new MessageChannel()
      const endpoint = new RpcEndpoint(workerPortLink(port2, ports))
      const loader = { load: () => backend, forget: () => {} }
      new HostRuntime(endpoint, { snapshot: initial, db: {} as ExtensionDB, loader })
      return { link: workerPortLink(port1, ports), onExit: () => {}, kill: vi.fn() }
    },
    snapshot: () => hostSnapshot(),
    apiFor: (id) => (id === 'demo' ? main.api : undefined),
    onBackendsFailed: vi.fn(),
    log: () => {},
  })
  const record = { id: 'demo', entryPoint: '/demo/main.cjs', directory: '/demo', dependencies: [] }
  return { ...main, listeners, process, record }
}

describe('api.agents in the extension host', () => {
  it('forwards calls to main and returns its answers', async () => {
    const { agents, channels, process, record } = harness()
    await process.activate(record)
    const call = (name: string) => dispatchChannel(channels.get(`demo:${name}`)!, {})

    await expect(call('start')).resolves.toMatchObject({ sessionId: 's1' })
    await expect(call('prompt')).resolves.toEqual({ stopReason: 'end_turn' })
    await expect(call('answer')).resolves.toBe(true)
    expect(agents.start).toHaveBeenCalledWith({ cwd: '/work' })
    expect(agents.answer).toHaveBeenCalledWith('s1', 'r1', null)
  })
})

describe('api.agents in the extension host — cancel and listeners', () => {
  it('forwards cancel without waiting for an answer', async () => {
    const { agents, channels, process, record } = harness()
    await process.activate(record)
    await dispatchChannel(channels.get('demo:cancel')!, {})
    await eventually(() => expect(agents.cancel).toHaveBeenCalledWith('s1'))
  })

  it('carries updates, asks and the end from main to the listeners', async () => {
    const { broadcast, channels, listeners, process, record } = harness()
    await process.activate(record)
    await dispatchChannel(channels.get('demo:listen')!, {})
    await eventually(() => expect(Object.keys(listeners)).toHaveLength(4))

    listeners.update?.({ sessionUpdate: 'plan' })
    listeners.ask?.({ requestId: 'r1' } as AgentPermissionAsk)
    listeners.end?.(2)
    listeners.settled?.('r1')
    await eventually(() => {
      expect(broadcast).toHaveBeenCalledWith('demo:update', { sessionUpdate: 'plan' })
      expect(broadcast).toHaveBeenCalledWith('demo:ask', { requestId: 'r1' })
      expect(broadcast).toHaveBeenCalledWith('demo:end', 2)
      expect(broadcast).toHaveBeenCalledWith('demo:settled', 'r1')
    })
  })
})
