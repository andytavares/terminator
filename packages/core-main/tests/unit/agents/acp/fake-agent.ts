import {
  agent,
  methods,
  ndJsonStream,
  type AgentApp,
  type AgentContext,
  type PromptRequest,
  type PromptResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  type SetSessionModeRequest,
  RequestError,
} from '@agentclientprotocol/sdk/unstable'
import { availableAdapterModes } from '../../../../../test-support/src/acp-modes'
import { connectClient } from '../../../../src/agents/acp/agent-connection'
import type { AgentClient, AgentLink } from '../../../../src/agents/acp/agent-service'

/** The calls the agent makes on the client. */
interface ToClient {
  sessionUpdate(params: SessionNotification): Promise<void>
  requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse>
}

export interface FakeAgent {
  /** Every request the client made, in order. */
  calls: Array<{ method: string; params: unknown }>
  /** The agent's end of the connection: it sends updates and asks for permission. */
  toClient: ToClient
  killed: boolean
  /** Ends the process as if it had exited. */
  exit(code: number | null): void
  /** Ends the connection's stream, as a dying process does before its exit is seen. */
  disconnect(): void
  /** What a prompt does; by default it ends the turn at once. */
  onPrompt: (params: PromptRequest) => Promise<PromptResponse>
  /** Errors the agent answers a request with instead of succeeding. */
  failures: { newSession?: Error; setSessionMode?: Error }
  /** Settles when the client cancels. */
  cancelled: Promise<void>
  /** What the agent advertises in its `initialize` response. */
  advertised: Advertised
  /** How the agent answers `_session/steering`; by default the text joins the running turn. */
  onSteer: (params: unknown) => Promise<{ outcome: string }>
}

export interface Advertised {
  image: boolean
  steering: boolean
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

const configOptionsAnswer = async () => ({ configOptions: CONFIG_OPTIONS })

function initializeAnswer(advertised: Advertised) {
  return {
    protocolVersion: 1,
    agentCapabilities: { promptCapabilities: { image: advertised.image } },
    _meta: advertised.steering ? { steering: { supported: true } } : undefined,
  }
}

async function extAnswer(fake: FakeAgent, method: string, params: Record<string, unknown>) {
  fake.calls.push({ method, params })
  return method === '_session/steering' ? fake.onSteer(params) : {}
}

type Recorder = <P, R>(method: string, answer: (params: P) => R) => (context: { params: P }) => R

/** Wraps an answer so the request is recorded before it is answered. */
function recorderFor(fake: FakeAgent): Recorder {
  return (method, answer) =>
    ({ params }) => {
      fake.calls.push({ method, params })
      return answer(params)
    }
}

/** The agent's answers to the session requests: open, load, mode and settings. */
function withSessionHandlers(app: AgentApp, fake: FakeAgent, recorded: Recorder): AgentApp {
  return app
    .onRequest(
      methods.agent.session.new,
      recorded('newSession', async () => {
        if (fake.failures.newSession) throw fake.failures.newSession
        return { sessionId: SESSION_ID, configOptions: CONFIG_OPTIONS }
      })
    )
    .onRequest(
      methods.agent.session.load,
      recorded('loadSession', async () => ({ configOptions: CONFIG_OPTIONS }))
    )
    .onRequest(
      methods.agent.session.setMode,
      recorded('setSessionMode', async ({ modeId }: SetSessionModeRequest) => {
        if (fake.failures.setSessionMode) throw fake.failures.setSessionMode
        // As the adapter answers over ACP: its plain Error becomes an internal error with details.
        if (!availableAdapterModes().includes(modeId))
          throw RequestError.internalError({
            details: `Mode ${modeId} is not available in this session`,
          })
        return {}
      })
    )
    .onRequest(
      methods.agent.session.setConfigOption,
      recorded('setSessionConfigOption', configOptionsAnswer)
    )
}

/** The agent's answers to the client's requests; each request is recorded first. */
function agentHandlers(fake: FakeAgent, cancel: () => void): AgentApp {
  const recorded = recorderFor(fake)
  const app = agent()
    .onRequest(
      methods.agent.initialize,
      recorded('initialize', async () => initializeAnswer(fake.advertised))
    )
    .onRequest(methods.agent.authenticate, async () => ({}))
    .onRequest(
      methods.agent.session.prompt,
      recorded('prompt', (params: PromptRequest) => fake.onPrompt(params))
    )
    .onNotification(
      methods.agent.session.cancel,
      recorded('cancel', async () => cancel())
    )
    .onRequest('*', ({ method, params }) =>
      extAnswer(fake, method, params as Record<string, unknown>)
    )
  return withSessionHandlers(app, fake, recorded)
}

function toClientOf(client: AgentContext): ToClient {
  return {
    sessionUpdate: (params) => client.notify(methods.client.session.update, params),
    requestPermission: (params) => client.request(methods.client.session.requestPermission, params),
  }
}

function newFake(
  failures: FakeAgent['failures'],
  advertised: Advertised
): { fake: FakeAgent; agentStream: ReturnType<typeof ndJsonStream> } {
  const toAgent = new TransformStream<Uint8Array, Uint8Array>()
  const toClient = new TransformStream<Uint8Array, Uint8Array>()
  let signalCancel: () => void = () => undefined
  const fake: FakeAgent = {
    calls: [],
    killed: false,
    failures,
    advertised,
    onSteer: async () => ({ outcome: 'steered' }),
    exit: () => undefined,
    disconnect: () => undefined,
    onPrompt: async () => ({ stopReason: 'end_turn' }),
    cancelled: new Promise((resolve) => (signalCancel = resolve)),
    toClient: undefined as never, // Set below, from the connection the fake's handlers serve.
  }
  const connection = agentHandlers(fake, signalCancel).connect(
    ndJsonStream(toClient.writable, toAgent.readable)
  )
  fake.toClient = toClientOf(connection.client)
  const severable = new TransformStream<Uint8Array, Uint8Array>({
    start: (controller) => void (fake.disconnect = () => controller.terminate()),
  })
  void toClient.readable.pipeTo(severable.writable).catch(() => undefined)
  return { fake, agentStream: ndJsonStream(toAgent.writable, severable.readable) }
}

/** A `connect` for the service whose agent runs in memory, over two streams, with no process.
 * `firstAgent` settles when the first agent is started. */
export function fakeConnector(
  failures: FakeAgent['failures'] = {},
  advertised: Advertised = { image: true, steering: true }
): {
  connect(request: { agentId: string; client: AgentClient }): Promise<AgentLink>
  agents: FakeAgent[]
  firstAgent: Promise<FakeAgent>
} {
  const agents: FakeAgent[] = []
  let announce: (fake: FakeAgent) => void = () => undefined
  const firstAgent = new Promise<FakeAgent>((resolve) => (announce = resolve))
  async function connect({ client }: { agentId: string; client: AgentClient }): Promise<AgentLink> {
    const { fake, agentStream } = newFake(failures, advertised)
    const exitListeners: Array<(code: number | null) => void> = []
    fake.exit = (code) => exitListeners.forEach((listener) => listener(code))
    agents.push(fake)
    announce(fake)
    return {
      agent: connectClient(client, agentStream),
      onExit: (listener) => void exitListeners.push(listener),
      kill: () => void (fake.killed = true),
      stderrTail: () => '',
    }
  }
  return { connect, agents, firstAgent }
}
