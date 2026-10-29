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
  AgentPermissionSettled,
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
interface AgentCalls {
  initialize(params: InitializeRequest): Promise<unknown>
  newSession(params: NewSessionRequest): Promise<NewSessionResponse>
  loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse | void>
  setSessionMode(params: SetSessionModeRequest): Promise<unknown>
  setSessionConfigOption(
    params: SetSessionConfigOptionRequest
  ): Promise<SetSessionConfigOptionResponse>
  prompt(params: PromptRequest): Promise<PromptResponse>
  cancel(params: CancelNotification): Promise<void>
  /** Aborts when the connection closes, which can come before the process's exit is seen. */
  readonly signal?: AbortSignal
}

/** A started agent process: its ACP calls, and how to learn of and force its end. @internal */
export interface AgentLink {
  agent: AgentCalls
  onExit(listener: (exitCode: number | null) => void): void
  kill(): void
  /** The last of what the process wrote to stderr: where an agent says why it failed. */
  stderrTail(): string
}

export interface AgentServiceDeps {
  /** Starts the agent's process. `client` receives the agent's requests and updates. */
  connect(request: { agentId: string; client: Client }): Promise<AgentLink>
  listAgents(): AgentDescriptor[]
  defaultAgentId(): string
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
  /** The latest `_meta` each tool call reported, by tool call id. */
  toolCallMeta: Map<string, Record<string, unknown>>
  updateListeners: Set<(update: AgentUpdate) => void>
  permissionListeners: Set<(ask: AgentPermissionAsk) => void>
  settledListeners: Set<(settled: AgentPermissionSettled) => void>
  endListeners: Set<(exitCode: number | null) => void>
  /** The prompts asked for and not answered yet, sent or still waiting to be. */
  pending: Set<Promise<unknown>>
  /** How many of them the agent has now. */
  sent: number
  /** Settles once the prompts the last cancel was for have ended. */
  cancelling: Promise<unknown>
  /** How many cancels there were; a prompt cancelled by none since it was asked was dropped. */
  cancels: number
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
function toConfigOptions(options: SessionConfigOption[] | null | undefined): AgentConfigOption[] {
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

/** Why an agent did not start: its own `data.details` when it gave one, else the message. */
class StartFailure extends Error {
  constructor(
    cause: unknown,
    readonly stderr: string
  ) {
    const details = (cause as { data?: { details?: unknown } } | null)?.data?.details
    super(typeof details === 'string' ? details : errorMessage(cause), { cause })
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function logStartFailure(error: unknown): string {
  const stderr = error instanceof StartFailure ? error.stderr : ''
  logger.error('agent did not start', { error: String(error), reason: errorMessage(error), stderr })
  return errorMessage(error)
}

const UNAVAILABLE_MESSAGE = 'The agent could not start. Check that it is installed and signed in.'

const PROMPT_FAILED_MESSAGE =
  '\n\nThe agent stopped with an error before it answered. Send the message again, or start a new agent.'

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
    toolCallMeta: new Map(),
    updateListeners: new Set(),
    permissionListeners: new Set(),
    settledListeners: new Set(),
    endListeners: new Set(),
    pending: new Set(),
    sent: 0,
    cancelling: Promise.resolve(),
    cancels: 0,
  }
}

/** How an ask ended, by the kind of the option chosen. */
function settledAs(
  ask: AgentPermissionAsk,
  outcome: RequestPermissionOutcome
): AgentPermissionSettled['outcome'] {
  if (outcome.outcome === 'cancelled') return 'cancelled'
  const kind = ask.options.find((option) => option.optionId === outcome.optionId)?.kind ?? ''
  return kind.startsWith('allow') ? 'allowed' : 'rejected'
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

/** What the conversation shows when a prompt fails: plain words, the detail is in the log. */
function failureNotice(): AgentUpdate {
  return {
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text: PROMPT_FAILED_MESSAGE },
  } as AgentUpdate
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

  private rememberToolCallMeta(session: Session, update: AgentUpdate): void {
    const { toolCallId, _meta } = update
    if (typeof toolCallId === 'string' && _meta && typeof _meta === 'object')
      session.toolCallMeta.set(toolCallId, _meta as Record<string, unknown>)
  }

  private publishUpdate(session: Session, update: AgentUpdate): void {
    this.rememberToolCallMeta(session, update)
    if (session.replaying) return
    try {
      // Nobody opens a one-shot session again, so its updates are not kept.
      if (!session.unattended) this.deps.log.append(session.id, update)
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
    const settled = { requestId, outcome: settledAs(open.ask, outcome) }
    notify(session.settledListeners, settled)
    this.deps.broadcast('agents:permission-settled', { sessionId: session.id, ...settled })
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
      toolCallId: toolCall.toolCallId,
      toolCallMeta: session.toolCallMeta.get(toolCall.toolCallId) ?? null,
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
    // Not the registered one: its start failed, or a resume took its id over.
    if (this.sessions.get(session.id) !== session) return
    this.sessions.delete(session.id)
    this.cancelAsks(session)
    session.toolCallMeta.clear()
    clearTurn(session.id)
    clearAsk(session.id)
    notify(session.endListeners, exitCode)
    this.deps.broadcast('agents:end', { sessionId: session.id, exitCode })
  }

  private async begin(session: Session, input: StartAgentInput): Promise<AgentConfigOption[]> {
    const { agent } = session.link
    await agent.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const request = { cwd: input.cwd, mcpServers: [], _meta: input.agentMeta ?? {} }
    if (input.resume === undefined) {
      const created = await agent.newSession(request)
      session.id = created.sessionId
      this.sessions.set(session.id, session)
      return toConfigOptions(created.configOptions)
    }
    // One agent per conversation: resuming a running one takes it over.
    const running = this.live(input.resume)
    if (running) this.closeSession(running)
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
      throw new StartFailure(error, link.stderrTail())
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
      input.onStartFailed?.(logStartFailure(error))
      return null
    }
  }

  async prompt(sessionId: string, text: string): Promise<{ stopReason: string }> {
    const session = this.live(sessionId)
    return session ? this.promptSession(session, text) : { stopReason: 'error' }
  }

  private promptSession(session: Session, text: string): Promise<{ stopReason: string }> {
    const turn = this.runTurn(session, text, session.cancels)
    session.pending.add(turn)
    void turn.finally(() => session.pending.delete(turn))
    return turn
  }

  private async runTurn(
    session: Session,
    text: string,
    cancelsAtAsk: number
  ): Promise<{ stopReason: string }> {
    // An agent's cancel also drops a prompt that reaches it before the cancelled turn has ended.
    await session.cancelling
    if (session.ended) return { stopReason: 'error' }
    if (session.cancels !== cancelsAtAsk) return { stopReason: 'cancelled' }
    setTurn(session.id, true)
    try {
      const first = await this.send(session, text)
      // Cancelled, but by no cancel since it was asked: the one before it dropped it.
      const dropped = first === 'cancelled' && cancelsAtAsk > 0 && session.cancels === cancelsAtAsk
      return { stopReason: dropped && !session.ended ? await this.send(session, text) : first }
    } catch (error) {
      this.promptFailed(session, error)
      return { stopReason: 'error' }
    } finally {
      if (!session.ended) setTurn(session.id, false)
    }
  }

  private promptFailed(session: Session, error: unknown): void {
    // A prompt still open when its session ended fails with the connection; the end reports it.
    if (session.ended || session.link.agent.signal?.aborted) {
      logger.info('agent prompt ended with its session', { error: String(error) })
      return
    }
    logger.error('agent prompt failed', { error: String(error) })
    // A one-shot session has no tab to show it in, and its reply is read as the answer.
    if (!session.unattended) this.publishUpdate(session, failureNotice())
  }

  private async send(session: Session, text: string): Promise<string> {
    session.sent += 1
    try {
      const prompt: PromptRequest['prompt'] = [{ type: 'text', text }]
      return (await session.link.agent.prompt({ sessionId: session.id, prompt })).stopReason
    } finally {
      session.sent -= 1
    }
  }

  cancel(sessionId: string): void {
    const session = this.live(sessionId)
    if (session) this.cancelSession(session)
  }

  private cancelSession(session: Session): void {
    if (session.ended) return
    const { id: sessionId } = session
    this.cancelAsks(session)
    if (session.pending.size === 0) return
    session.cancels += 1
    session.cancelling = Promise.all(session.pending)
    // Only prompts still waiting: they see the cancel themselves. The agent's cancel would
    // land on whichever of them reached it next.
    if (session.sent === 0) return
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
    if (session) this.closeSession(session)
  }

  private closeSession(session: Session): void {
    const registered = this.sessions.get(session.id) === session
    this.finish(session, null)
    session.link.kill()
    if (registered && session.hasTab) {
      this.deps.broadcast('terminal:close-tab', { sessionId: session.id })
    }
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
      logStartFailure(error)
      return { error: 'AGENT_UNAVAILABLE', message: UNAVAILABLE_MESSAGE }
    }
    const reply = collectReply(session)
    // Asked first, so a cancel from `onStarted` finds it.
    const turn = this.promptSession(session, prompt)
    onStarted?.(session.id)
    try {
      // An agent that ignores the cancel is killed by the close below, not waited for.
      const { stopReason } = await withinTime(turn, timeoutMs)
      return { text: reply(), stopReason, sessionId: session.id }
    } catch {
      this.cancelSession(session)
      return { error: 'TIMEOUT', message: timeoutMessage(timeoutMs) }
    } finally {
      this.closeSession(session)
    }
  }

  private async readModelOption(agentId: string): Promise<AgentConfigOption | null> {
    mkdirSync(this.deps.scratchDirectory, { recursive: true })
    try {
      const session = await this.open({ agentId, cwd: this.deps.scratchDirectory }, true)
      const option = session.configOptions.find((candidate) => candidate.id === 'model') ?? null
      this.closeSession(session)
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

  onPermissionSettled(
    sessionId: string,
    listener: (settled: AgentPermissionSettled) => void
  ): () => void {
    const session = this.live(sessionId)
    return session ? disposer(session.settledListeners, listener) : () => undefined
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
