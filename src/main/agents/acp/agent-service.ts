import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import type {
  CancelNotification,
  Client,
  InitializeRequest,
  LoadSessionRequest,
  LoadSessionResponse,
  NewSessionRequest,
  NewSessionResponse,
  PromptRequest,
  PromptResponse,
  SetSessionConfigOptionRequest,
  SetSessionConfigOptionResponse,
  SetSessionModeRequest,
  RequestPermissionOutcome,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionConfigOption,
} from '@agentclientprotocol/sdk'
import type {
  AgentConfigOption,
  AgentDescriptor,
  AgentPermissionAsk,
  AgentStarted,
  AgentsAPI,
  AgentUpdate,
  RunAgentOnceInput,
  RunAgentOnceResult,
  StartAgentInput,
} from '@terminator/extension-sdk'
import { makeLogger } from '../../logger.js'
import { clearTurn, setTurn } from '../agent-turns.js'
import { clearAsk, raiseAsk } from '../ask-watcher.js'
import type { AgentLog } from './agent-log.js'

const logger = makeLogger('agent-service')
const DEFAULT_TIMEOUT_MS = 300_000
const DEFAULT_START_TIMEOUT_MS = 60_000

/** The calls the service makes on an agent: a `ClientSideConnection` has them all. */
export interface AgentCalls {
  initialize(params: InitializeRequest): Promise<unknown>
  newSession(params: NewSessionRequest): Promise<NewSessionResponse>
  loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse | void>
  setSessionMode(params: SetSessionModeRequest): Promise<unknown>
  setSessionConfigOption(
    params: SetSessionConfigOptionRequest
  ): Promise<SetSessionConfigOptionResponse>
  prompt(params: PromptRequest): Promise<PromptResponse>
  cancel(params: CancelNotification): Promise<void>
}

/** A started agent process: its ACP calls, and how to learn of and force its end. */
export interface AgentLink {
  agent: AgentCalls
  onExit(listener: (exitCode: number | null) => void): void
  kill(): void
}

export interface AgentServiceDeps {
  /** Starts the agent's process. `client` receives the agent's requests and updates. */
  connect(request: { agentId: string; client: Client }): Promise<AgentLink>
  listAgents(): AgentDescriptor[]
  defaultAgentId(): string
  /** The `_meta` to send with the session, with whatever the agent needs added. */
  agentMeta(request: {
    agentId: string
    meta?: Record<string, unknown>
  }): Promise<Record<string, unknown>>
  log: AgentLog
  scratchDirectory: string
  scrollbackLimit(): number
  broadcast(channel: string, payload: unknown): void
  /** A session opened a tab: keep its conversation on the session record. */
  recordTab(session: {
    sessionId: string
    agentId: string
    cwd: string
    tab: { projectId: string; title: string }
  }): void
  now(): number
  /** How long an agent may take to open a session before it is killed. Default 60 s. */
  startTimeoutMs?: number
}

export interface AgentService extends AgentsAPI {
  /** Asks that wait for an answer now, for a view that opens after they were raised. */
  openAsks(): AgentPermissionAsk[]
  readHistory(sessionId: string): AgentUpdate[]
  disposeAll(): Promise<void>
}

interface OpenAsk {
  ask: AgentPermissionAsk
  resolve(response: RequestPermissionResponse): void
}

interface Session {
  id: string
  agentId: string
  link: AgentLink
  /** Nobody can answer: asks are rejected. */
  unattended: boolean
  hasTab: boolean
  /** A resumed session replays its history, which the log already holds. */
  replaying: boolean
  ended: boolean
  configOptions: AgentConfigOption[]
  asks: Map<string, OpenAsk>
  updateListeners: Set<(update: AgentUpdate) => void>
  permissionListeners: Set<(ask: AgentPermissionAsk) => void>
  endListeners: Set<(exitCode: number | null) => void>
}

function flattenChoices(
  choices: Array<
    { value: string; name: string } | { options: Array<{ value: string; name: string }> }
  >
) {
  return choices
    .flatMap((choice) => ('options' in choice ? choice.options : [choice]))
    .map(({ value, name }) => ({ value, name }))
}

/** The select options of a session; a toggle has no choices to show. */
export function toConfigOptions(
  options: SessionConfigOption[] | null | undefined
): AgentConfigOption[] {
  return (options ?? []).flatMap((option) =>
    'options' in option
      ? [
          {
            id: option.id,
            name: option.name,
            currentValue: option.currentValue,
            options: flattenChoices(option.options),
          },
        ]
      : []
  )
}

function notify<T>(listeners: Set<(value: T) => void>, value: T): void {
  for (const listener of listeners) {
    try {
      listener(value)
    } catch (error) {
      logger.error('agent listener threw', { error: String(error) })
    }
  }
}

function disposer<T>(listeners: Set<(value: T) => void>, listener: (value: T) => void) {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

function textOf(update: AgentUpdate): string {
  const content = update.content as { text?: unknown } | undefined
  return typeof content?.text === 'string' ? content.text : ''
}

const UNAVAILABLE_MESSAGE = 'The agent could not start. Check that it is installed and signed in.'

const timeoutMessage = (timeoutMs: number): string =>
  `The agent did not finish within ${Math.round(timeoutMs / 1000)} seconds.`

function newSession(fields: Pick<Session, 'id' | 'agentId' | 'link' | 'unattended'>): Session {
  return {
    ...fields,
    hasTab: false,
    replaying: false,
    ended: false,
    configOptions: [],
    asks: new Map(),
    updateListeners: new Set(),
    permissionListeners: new Set(),
    endListeners: new Set(),
  }
}

/** `work`, or a rejection once `ms` pass without it settling. */
function withinTime<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer within ${ms} ms`)), ms)
  })
  return Promise.race([work, expiry]).finally(() => clearTimeout(timer))
}

/** Rejects once the agent's process ends: an agent that dies while starting has no answer to wait for. */
function whenExited(link: AgentLink): Promise<never> {
  return new Promise<never>((_, reject) =>
    link.onExit((exitCode) => reject(new Error(`the agent exited with ${exitCode}`)))
  )
}

/** Starts collecting the session's reply text; the returned function reads what came so far. */
function collectReply(session: Session): () => string {
  const chunks: string[] = []
  session.updateListeners.add((update) => {
    if (update.sessionUpdate === 'agent_message_chunk') chunks.push(textOf(update))
  })
  return () => chunks.join('')
}

class AcpAgentService implements AgentService {
  private readonly sessions = new Map<string, Session>()
  private readonly modelCache = new Map<string, Promise<AgentConfigOption | null>>()

  constructor(private readonly deps: AgentServiceDeps) {}

  private readonly client: Client = {
    requestPermission: (params) => this.requestPermission(params),
    sessionUpdate: (params) => {
      const session = this.live(params.sessionId)
      if (session) this.publishUpdate(session, params.update as AgentUpdate)
    },
  }

  private live(sessionId: string): Session | undefined {
    const session = this.sessions.get(sessionId)
    return session && !session.ended ? session : undefined
  }

  private publishUpdate(session: Session, update: AgentUpdate): void {
    if (session.replaying) return
    try {
      this.deps.log.append(session.id, update)
    } catch (error) {
      logger.error('agent log write failed', { error: String(error) })
    }
    notify(session.updateListeners, update)
    this.deps.broadcast('agents:update', { sessionId: session.id, update })
  }

  private settle(session: Session, requestId: string, outcome: RequestPermissionOutcome): boolean {
    const open = session.asks.get(requestId)
    if (!open) return false
    session.asks.delete(requestId)
    open.resolve({ outcome })
    this.deps.broadcast('agents:permission-settled', { sessionId: session.id, requestId })
    if (session.asks.size === 0) clearAsk(session.id)
    return true
  }

  private cancelAsks(session: Session): void {
    for (const requestId of [...session.asks.keys()])
      this.settle(session, requestId, { outcome: 'cancelled' })
  }

  private raise(session: Session, params: RequestPermissionRequest) {
    const { toolCall } = params
    const ask: AgentPermissionAsk = {
      sessionId: session.id,
      requestId: randomUUID(),
      title: toolCall.title ?? '',
      kind: toolCall.kind ?? null,
      rawInput: toolCall.rawInput,
      options: params.options.map(({ optionId, name, kind }) => ({ optionId, name, kind })),
    }
    return new Promise<RequestPermissionResponse>((resolve) => {
      session.asks.set(ask.requestId, { ask, resolve })
      notify(session.permissionListeners, ask)
      this.deps.broadcast('agents:permission', { sessionId: session.id, ask })
      const since = new Date(this.deps.now()).toISOString()
      raiseAsk(session.id, { message: ask.title, since })
    })
  }

  private async requestPermission(
    params: RequestPermissionRequest
  ): Promise<RequestPermissionResponse> {
    const session = this.live(params.sessionId)
    if (!session) return { outcome: { outcome: 'cancelled' } }
    if (!session.unattended) return this.raise(session, params)
    const reject = params.options.find((option) => option.kind === 'reject_once')
    const outcome: RequestPermissionOutcome = reject
      ? { outcome: 'selected', optionId: reject.optionId }
      : { outcome: 'cancelled' }
    return { outcome }
  }

  private finish(session: Session, exitCode: number | null): void {
    if (session.ended) return
    session.ended = true
    if (!this.sessions.delete(session.id)) return // It never got an id: its start failed or is failing.
    this.cancelAsks(session)
    clearTurn(session.id)
    clearAsk(session.id)
    notify(session.endListeners, exitCode)
    this.deps.broadcast('agents:end', { sessionId: session.id, exitCode })
  }

  private async begin(session: Session, input: StartAgentInput): Promise<AgentConfigOption[]> {
    const { agent } = session.link
    await agent.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const _meta = await this.deps.agentMeta({ agentId: session.agentId, meta: input.agentMeta })
    const request = { cwd: input.cwd, mcpServers: [], _meta }
    if (input.resume === undefined) {
      const created = await agent.newSession(request)
      session.id = created.sessionId
      this.sessions.set(session.id, session)
      return toConfigOptions(created.configOptions)
    }
    session.id = input.resume
    session.replaying = true
    this.sessions.set(session.id, session)
    const loaded = await agent.loadSession({ ...request, sessionId: input.resume })
    session.replaying = false
    return toConfigOptions(loaded?.configOptions)
  }

  /** The session, its options and its mode: all of it within the start time. */
  private async openSession(session: Session, input: StartAgentInput): Promise<void> {
    session.configOptions = await this.begin(session, input)
    if (input.mode !== undefined) await this.applyMode(session, input.mode)
  }

  private async applyMode(session: Session, mode: string): Promise<void> {
    await session.link.agent.setSessionMode({ sessionId: session.id, modeId: mode })
    session.configOptions = session.configOptions.map((option) =>
      option.id === 'mode' ? { ...option, currentValue: mode } : option
    )
  }

  private async open(input: StartAgentInput, unattended: boolean): Promise<Session> {
    const agentId = input.agentId ?? this.deps.defaultAgentId()
    const link = await this.deps.connect({ agentId, client: this.client })
    const session = newSession({ id: input.resume ?? '', agentId, link, unattended })
    link.onExit((exitCode) => this.finish(session, exitCode))
    try {
      const limit = this.deps.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS
      const opening = Promise.race([this.openSession(session, input), whenExited(link)])
      await withinTime(opening, limit)
      return session
    } catch (error) {
      session.ended = true
      this.sessions.delete(session.id)
      link.kill()
      throw error
    }
  }

  private showTab(session: Session, tab: NonNullable<StartAgentInput['tab']>): void {
    session.hasTab = true
    this.deps.broadcast('terminal:adopt', {
      sessionId: session.id,
      projectId: tab.projectId,
      tabTitle: tab.title,
      scrollbackLimit: this.deps.scrollbackLimit(),
      surface: 'agent',
    })
  }

  list = async (): Promise<AgentDescriptor[]> => this.deps.listAgents()

  async start(input: StartAgentInput): Promise<AgentStarted | null> {
    try {
      const session = await this.open(input, false)
      if (input.tab) {
        this.showTab(session, input.tab)
        this.deps.recordTab({
          sessionId: session.id,
          agentId: session.agentId,
          cwd: input.cwd,
          tab: input.tab,
        })
      }
      return {
        sessionId: session.id,
        agentId: session.agentId,
        configOptions: session.configOptions,
      }
    } catch (error) {
      logger.error('agent did not start', { error: String(error) })
      return null
    }
  }

  async prompt(sessionId: string, text: string): Promise<{ stopReason: string }> {
    const session = this.live(sessionId)
    if (!session) return { stopReason: 'error' }
    setTurn(sessionId, true)
    try {
      const { stopReason } = await session.link.agent.prompt({
        sessionId,
        prompt: [{ type: 'text', text }],
      })
      return { stopReason }
    } catch (error) {
      logger.error('agent prompt failed', { error: String(error) })
      return { stopReason: 'error' }
    } finally {
      if (!session.ended) setTurn(sessionId, false)
    }
  }

  cancel(sessionId: string): void {
    const session = this.live(sessionId)
    if (!session) return
    this.cancelAsks(session)
    session.link.agent.cancel({ sessionId }).catch((error) => {
      logger.error('agent cancel failed', { error: String(error) })
    })
  }

  async setConfig(sessionId: string, configId: string, value: string): Promise<boolean> {
    const session = this.live(sessionId)
    if (!session?.configOptions.some((option) => option.id === configId)) return false
    try {
      const response = await session.link.agent.setSessionConfigOption({
        sessionId,
        configId,
        value,
      })
      session.configOptions = toConfigOptions(response.configOptions)
      return true
    } catch (error) {
      logger.error('agent setting was refused', { error: String(error) })
      return false
    }
  }

  async close(sessionId: string): Promise<void> {
    const session = this.live(sessionId)
    if (!session) return
    this.finish(session, null)
    session.link.kill()
    if (session.hasTab) this.deps.broadcast('terminal:close-tab', { sessionId })
  }

  async answer(sessionId: string, requestId: string, optionId: string | null): Promise<boolean> {
    const session = this.live(sessionId)
    const open = session?.asks.get(requestId)
    if (!session || !open) return false
    if (optionId === null) return this.settle(session, requestId, { outcome: 'cancelled' })
    if (!open.ask.options.some((option) => option.optionId === optionId)) return false
    return this.settle(session, requestId, { outcome: 'selected', optionId })
  }

  async runOnce(input: RunAgentOnceInput): Promise<RunAgentOnceResult> {
    const { prompt, timeoutMs = DEFAULT_TIMEOUT_MS, onStarted, ...startInput } = input
    let session: Session
    try {
      session = await this.open(startInput, true)
    } catch (error) {
      logger.error('agent did not start', { error: String(error) })
      return { error: 'AGENT_UNAVAILABLE', message: UNAVAILABLE_MESSAGE }
    }
    const reply = collectReply(session)
    onStarted?.(session.id)
    try {
      // An agent that ignores the cancel is killed by the close below, not waited for.
      const { stopReason } = await withinTime(this.prompt(session.id, prompt), timeoutMs)
      return { text: reply(), stopReason, sessionId: session.id }
    } catch {
      this.cancel(session.id)
      return { error: 'TIMEOUT', message: timeoutMessage(timeoutMs) }
    } finally {
      await this.close(session.id)
    }
  }

  private async readModelOption(agentId: string): Promise<AgentConfigOption | null> {
    mkdirSync(this.deps.scratchDirectory, { recursive: true })
    try {
      const session = await this.open({ agentId, cwd: this.deps.scratchDirectory }, true)
      const option = session.configOptions.find((candidate) => candidate.id === 'model') ?? null
      await this.close(session.id)
      return option
    } catch (error) {
      logger.error('agent models could not be read', { error: String(error) })
      return null
    }
  }

  models(agentId?: string): Promise<AgentConfigOption | null> {
    const id = agentId ?? this.deps.defaultAgentId()
    const cached = this.modelCache.get(id)
    if (cached) return cached
    const read = this.readModelOption(id).then((option) => {
      if (option === null) this.modelCache.delete(id)
      return option
    })
    this.modelCache.set(id, read)
    return read
  }

  onUpdate(sessionId: string, listener: (update: AgentUpdate) => void): () => void {
    const session = this.live(sessionId)
    return session ? disposer(session.updateListeners, listener) : () => undefined
  }

  onPermission(sessionId: string, listener: (ask: AgentPermissionAsk) => void): () => void {
    const session = this.live(sessionId)
    return session ? disposer(session.permissionListeners, listener) : () => undefined
  }

  onEnd(sessionId: string, listener: (exitCode: number | null) => void): () => void {
    const session = this.live(sessionId)
    return session ? disposer(session.endListeners, listener) : () => undefined
  }

  openAsks(): AgentPermissionAsk[] {
    return [...this.sessions.values()].flatMap((session) =>
      [...session.asks.values()].map(({ ask }) => ask)
    )
  }

  readHistory(sessionId: string): AgentUpdate[] {
    return this.deps.log.readHistory(sessionId)
  }

  async disposeAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((sessionId) => this.close(sessionId)))
  }
}

export function createAgentService(deps: AgentServiceDeps): AgentService {
  return new AcpAgentService(deps)
}
