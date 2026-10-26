import {
  AgentSideConnection,
  ClientSideConnection,
  ndJsonStream,
  type Agent,
  type Client,
  type PromptRequest,
  type PromptResponse,
} from '@agentclientprotocol/sdk'
import type { AgentLink } from '../../../../src/main/agents/acp/agent-service'

export interface FakeAgent {
  /** Every request the client made, in order. */
  calls: Array<{ method: string; params: unknown }>
  /** The agent's end of the connection: it sends updates and asks for permission. */
  toClient: AgentSideConnection
  killed: boolean
  /** Ends the process as if it had exited. */
  exit(code: number | null): void
  /** What a prompt does; by default it ends the turn at once. */
  onPrompt: (params: PromptRequest) => Promise<PromptResponse>
  /** Settles when the client cancels. */
  cancelled: Promise<void>
}

export const SESSION_ID = 'session-1'

const CONFIG_OPTIONS = [
  {
    id: 'mode',
    name: 'Mode',
    type: 'select' as const,
    currentValue: 'auto',
    options: [
      { value: 'auto', name: 'Auto' },
      { value: 'default', name: 'Default' },
    ],
  },
  {
    id: 'model',
    name: 'Model',
    type: 'select' as const,
    currentValue: 'opus',
    options: [
      { group: 'g', name: 'Group', options: [{ value: 'opus', name: 'Opus' }] },
      { group: 'h', name: 'Other', options: [{ value: 'haiku', name: 'Haiku' }] },
    ],
  },
  { id: 'fast', name: 'Fast', type: 'boolean' as const, currentValue: false },
]

/** The agent's answers to the client's requests; each request is recorded first. */
function agentHandlers(fake: FakeAgent, cancel: () => void): Agent {
  const recorded = <P, R>(method: string, answer: (params: P) => R) => {
    return (params: P): R => {
      fake.calls.push({ method, params })
      return answer(params)
    }
  }
  return {
    initialize: recorded('initialize', async () => ({ protocolVersion: 1 })),
    authenticate: async () => ({}),
    newSession: recorded('newSession', async () => ({
      sessionId: SESSION_ID,
      configOptions: CONFIG_OPTIONS,
    })),
    loadSession: recorded('loadSession', async () => ({ configOptions: CONFIG_OPTIONS })),
    setSessionMode: recorded('setSessionMode', async () => ({})),
    setSessionConfigOption: recorded('setSessionConfigOption', async () => ({
      configOptions: CONFIG_OPTIONS,
    })),
    prompt: recorded('prompt', (params: PromptRequest) => fake.onPrompt(params)),
    cancel: recorded('cancel', async () => cancel()),
  }
}

function newFake(): { fake: FakeAgent; agentStream: ReturnType<typeof ndJsonStream> } {
  const toAgent = new TransformStream<Uint8Array, Uint8Array>()
  const toClient = new TransformStream<Uint8Array, Uint8Array>()
  let signalCancel: () => void = () => undefined
  const fake: FakeAgent = {
    calls: [],
    killed: false,
    exit: () => undefined,
    onPrompt: async () => ({ stopReason: 'end_turn' }),
    cancelled: new Promise((resolve) => (signalCancel = resolve)),
    toClient: undefined as never, // Set below: the connection asks for its handlers at once.
  }
  fake.toClient = new AgentSideConnection(
    () => agentHandlers(fake, signalCancel),
    ndJsonStream(toClient.writable, toAgent.readable)
  )
  return { fake, agentStream: ndJsonStream(toAgent.writable, toClient.readable) }
}

/** A `connect` for the service whose agent runs in memory, over two streams, with no process.
 * `firstAgent` settles when the first agent is started. */
export function fakeConnector(): {
  connect(request: { agentId: string; client: Client }): Promise<AgentLink>
  agents: FakeAgent[]
  firstAgent: Promise<FakeAgent>
} {
  const agents: FakeAgent[] = []
  let announce: (fake: FakeAgent) => void = () => undefined
  const firstAgent = new Promise<FakeAgent>((resolve) => (announce = resolve))
  async function connect({ client }: { agentId: string; client: Client }): Promise<AgentLink> {
    const { fake, agentStream } = newFake()
    const exitListeners: Array<(code: number | null) => void> = []
    fake.exit = (code) => exitListeners.forEach((listener) => listener(code))
    agents.push(fake)
    announce(fake)
    return {
      agent: new ClientSideConnection(() => client, agentStream),
      onExit: (listener) => void exitListeners.push(listener),
      kill: () => void (fake.killed = true),
    }
  }
  return { connect, agents, firstAgent }
}
