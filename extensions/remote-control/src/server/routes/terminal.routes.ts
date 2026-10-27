import { randomUUID } from 'crypto'
import { homedir } from 'os'
import { z } from 'zod'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type WebSocket from 'ws'
import { MISSING_CWD_ERROR } from '../../types.js'
import type { PtyManagerAPI } from '@terminator/extension-sdk'
import type { WsTicketStore } from '../ws-ticket-store.js'
import type { WsSubscriberManager } from '../ws-subscriber-manager.js'
import type { ConnectedDeviceRegistry } from '../connected-devices'
import { watchForBrokenConnection } from '../heartbeat.js'

const CreateTerminalSchema = z.object({
  cwd: z.string().min(1),
  type: z.enum(['human', 'agent']).default('human'),
  tabTitle: z.string().min(1).max(100).optional(),
  scrollbackLimit: z.number().int().min(1000).max(100000).optional().default(10000),
})

const ResizeSchema = z.object({
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
})

const AssignWorkspaceSchema = z.object({
  workspaceId: z.string().nullable(),
})

interface TerminalRouteOptions {
  ptyManager: PtyManagerAPI
  ticketStore: WsTicketStore
  subscriberManager: WsSubscriberManager
  /**
   * Who is watching, for the Remote Control view. Optional so existing callers
   * are unaffected; without it the view simply shows nothing connected.
   */
  deviceRegistry?: ConnectedDeviceRegistry
  getMaxSubscribers: () => number
}

type SpawnOptions = Parameters<PtyManagerAPI['spawnSession']>[0]
type SessionParams = { Params: { sessionId: string } }
type SocketRoute = SessionParams & { Querystring: { ticket?: string } }

interface TerminalRouteContext extends TerminalRouteOptions {
  streams: SessionStreams
}

/** One open terminal socket; `deviceId` is set once the socket is admitted. */
interface TerminalSocket {
  ws: WebSocket
  sessionId: string
  userAgent: string | undefined
  deviceId: string | null
}

// PtyManager is the single session authority (ADR-024): it owns session
// metadata (origin, cwd, createdAt, workspaceId) and the data/exit fan-out.
// This module only manages its own WebSocket subscribers and the one broadcast
// listener it attaches per session. Sessions this surface created have origin
// 'remote' and may be killed here; 'app' sessions belong to the Electron app
// and are never killed by remote teardown.
export async function registerTerminalRoutes(
  app: FastifyInstance,
  opts: TerminalRouteOptions
): Promise<{ cleanup: () => Promise<void> }> {
  const streams = new SessionStreams(opts.ptyManager, opts.subscriberManager)
  const context: TerminalRouteContext = { ...opts, streams }
  registerCollectionRoutes(app, context)
  registerSessionRoutes(app, context)
  registerSessionUpdateRoutes(app, context)
  registerTerminalSocket(app, context)
  return { cleanup: () => streams.cleanup() }
}

/** The broadcast listeners and pending teardowns of the sessions this surface streams. */
class SessionStreams {
  // One output-broadcast listener per session this surface is streaming.
  private broadcastDisposers = new Map<string, () => void>()
  // Pending grace-period teardown timers per session, so they can be
  // cancelled if the same session reconnects before the window expires.
  private gracePeriodTimers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(
    private ptyManager: PtyManagerAPI,
    private subscriberManager: WsSubscriberManager
  ) {}

  attachBroadcast(sessionId: string): void {
    if (this.broadcastDisposers.has(sessionId)) return
    const disposeData = this.ptyManager.onData(sessionId, (data) =>
      this.subscriberManager.broadcast(sessionId, data)
    )
    const disposeExit = this.ptyManager.onExit(sessionId, () => {
      this.broadcastDisposers.delete(sessionId)
      this.subscriberManager.destroySession(sessionId)
    })
    // Store BOTH disposers: detaching only onData would let a later reconnect
    // stack a second exit listener on a still-live app session.
    this.broadcastDisposers.set(sessionId, () => {
      disposeData()
      disposeExit()
    })
  }

  detachBroadcast(sessionId: string): void {
    const dispose = this.broadcastDisposers.get(sessionId)
    if (!dispose) return
    dispose()
    this.broadcastDisposers.delete(sessionId)
  }

  // Grace period: mobile clients navigate away (unmounting the view) without
  // intending to end the session. Wait 30s before tearing down the PTY so
  // navigating back reconnects to the live process.
  scheduleTeardown(sessionId: string): void {
    if (this.gracePeriodTimers.has(sessionId)) return
    const timer = setTimeout(async () => {
      this.gracePeriodTimers.delete(sessionId)
      if (this.subscriberManager.getCount(sessionId) !== 0) return
      const session = await this.ptyManager.getSession(sessionId)
      // App-owned sessions keep running in Electron — never kill them here.
      if (session?.origin === 'remote') this.ptyManager.kill(sessionId)
    }, 30_000)
    this.gracePeriodTimers.set(sessionId, timer)
  }

  cancelTeardown(sessionId: string): void {
    const pending = this.gracePeriodTimers.get(sessionId)
    if (pending === undefined) return
    clearTimeout(pending)
    this.gracePeriodTimers.delete(sessionId)
  }

  async cleanup(): Promise<void> {
    for (const timer of this.gracePeriodTimers.values()) clearTimeout(timer)
    this.gracePeriodTimers.clear()
    for (const [sessionId, dispose] of this.broadcastDisposers) {
      dispose()
      this.subscriberManager.destroySession(sessionId)
    }
    this.broadcastDisposers.clear()
    for (const session of await this.ptyManager.listSessions()) {
      if (session.origin === 'remote') this.ptyManager.kill(session.sessionId)
    }
  }
}

function registerCollectionRoutes(app: FastifyInstance, context: TerminalRouteContext): void {
  app.get('/api/terminals', async () => {
    return (await context.ptyManager.listSessions()).map((s) => ({
      sessionId: s.sessionId,
      cwd: s.cwd,
      createdAt: s.createdAt,
      workspaceId: s.workspaceId,
    }))
  })

  app.post('/api/terminals', (request, reply) => postTerminal(context, request, reply))
}

async function postTerminal(
  context: TerminalRouteContext,
  request: FastifyRequest,
  reply: FastifyReply
) {
  const result = CreateTerminalSchema.safeParse(request.body)
  if (!result.success) {
    return reply.status(400).send({ error: 'VALIDATION_ERROR', message: result.error.message })
  }

  const sessionId = randomUUID()
  try {
    await context.ptyManager.spawnSession(remoteSpawnOptions(sessionId, result.data))
  } catch (err) {
    // The requested folder is not there — a client error, and the caller
    // needs the path back to make sense of it. Anything else is ours.
    if (err instanceof Error && err.name === MISSING_CWD_ERROR) {
      return reply.status(400).send({ error: 'CWD_MISSING', message: err.message })
    }
    throw err
  }
  context.streams.attachBroadcast(sessionId)
  return reply.status(201).send({ sessionId })
}

function remoteSpawnOptions(
  sessionId: string,
  { cwd, type }: { cwd: string; type: 'human' | 'agent' }
): SpawnOptions {
  const resolvedCwd = cwd.startsWith('~') ? cwd.replace(/^~/, homedir()) : cwd
  const shell = process.env.SHELL || '/bin/zsh'
  return { sessionId, cwd: resolvedCwd, shell, type, origin: 'remote' }
}

function registerSessionRoutes(app: FastifyInstance, context: TerminalRouteContext): void {
  const { ptyManager, subscriberManager, streams } = context
  app.get<SessionParams>('/api/terminals/:sessionId', async (request, reply) => {
    const session = await ptyManager.getSession(request.params.sessionId)
    if (!session) return reply.status(404).send({ error: 'NOT_FOUND' })
    return {
      sessionId: session.sessionId,
      cwd: session.cwd,
      createdAt: session.createdAt,
      workspaceId: session.workspaceId,
      subscriberCount: subscriberManager.getCount(request.params.sessionId),
    }
  })

  app.delete<SessionParams>('/api/terminals/:sessionId', async (request, reply) => {
    const { sessionId } = request.params
    const session = await ptyManager.getSession(sessionId)
    if (!session) return reply.status(404).send({ error: 'NOT_FOUND' })
    // App-owned sessions keep running in Electron; only stop streaming them.
    if (session.origin === 'remote') ptyManager.kill(sessionId)
    subscriberManager.destroySession(sessionId)
    streams.detachBroadcast(sessionId)
    return { ok: true }
  })
}

function registerSessionUpdateRoutes(app: FastifyInstance, context: TerminalRouteContext): void {
  const { ptyManager, ticketStore } = context
  app.post<SessionParams>('/api/terminals/:sessionId/resize', async (request, reply) => {
    const { sessionId } = request.params
    if (!(await ptyManager.getSession(sessionId))) {
      return reply.status(404).send({ error: 'NOT_FOUND' })
    }
    const result = ResizeSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', message: result.error.message })
    }
    ptyManager.resize(sessionId, result.data.cols, result.data.rows)
    return { ok: true }
  })

  app.patch<SessionParams>('/api/terminals/:sessionId', (request, reply) =>
    assignWorkspace(ptyManager, request, reply)
  )

  app.post<SessionParams>('/api/terminals/:sessionId/ws-ticket', async (request, reply) => {
    const { sessionId } = request.params
    if (!(await ptyManager.getSession(sessionId))) {
      return reply.status(404).send({ error: 'NOT_FOUND' })
    }
    return reply.status(201).send({ ticket: ticketStore.createTicket(sessionId, 'terminal') })
  })
}

async function assignWorkspace(
  ptyManager: PtyManagerAPI,
  request: FastifyRequest<SessionParams>,
  reply: FastifyReply
) {
  const { sessionId } = request.params
  const result = AssignWorkspaceSchema.safeParse(request.body)
  if (!result.success) {
    return reply.status(400).send({ error: 'VALIDATION_ERROR', message: result.error.message })
  }
  if (!(await ptyManager.setWorkspace(sessionId, result.data.workspaceId))) {
    return reply.status(404).send({ error: 'NOT_FOUND' })
  }
  return { ok: true }
}

function registerTerminalSocket(app: FastifyInstance, context: TerminalRouteContext): void {
  app.get<SocketRoute>('/ws/terminals/:sessionId', { websocket: true }, (ws: WebSocket, request) =>
    acceptTerminalSocket(context, ws, request)
  )
}

function acceptTerminalSocket(
  context: TerminalRouteContext,
  ws: WebSocket,
  request: FastifyRequest<SocketRoute>
): void {
  const { ptyManager, subscriberManager, deviceRegistry, streams } = context
  const { sessionId } = request.params
  if (!hasValidTicket(context.ticketStore, ws, request)) return
  watchForBrokenConnection(ws)

  const userAgent = request.headers['user-agent']
  const socket: TerminalSocket = { ws, sessionId, userAgent, deviceId: null }

  // Attached before the session is looked up, so nothing the socket says is
  // missed; only the primary subscriber's keystrokes reach the PTY.
  ws.on('message', (msg) => {
    if (subscriberManager.isPrimary(sessionId, ws)) ptyManager.write(sessionId, msg.toString())
  })

  ws.on('close', () => {
    if (socket.deviceId !== null) deviceRegistry?.remove(socket.deviceId)
    subscriberManager.removeSubscriber(sessionId, ws)
    if (subscriberManager.getCount(sessionId) === 0) streams.scheduleTeardown(sessionId)
  })

  void ptyManager.getSession(sessionId).then((session) => admitSocket(context, socket, session))
}

function hasValidTicket(
  ticketStore: WsTicketStore,
  ws: WebSocket,
  request: FastifyRequest<SocketRoute>
): boolean {
  const { ticket } = request.query
  if (!ticket) {
    ws.close(4001, 'ticket required')
    return false
  }
  const ticketSessionId = ticketStore.consumeTicket(ticket, 'terminal')
  if (!ticketSessionId || ticketSessionId !== request.params.sessionId) {
    ws.close(4001, 'invalid or expired ticket')
    return false
  }
  return true
}

function admitSocket(context: TerminalRouteContext, socket: TerminalSocket, session: unknown) {
  const { ws, sessionId } = socket
  if (ws.readyState !== ws.OPEN) return
  if (!session) {
    ws.close(4002, 'session not found')
    return
  }
  if (!context.subscriberManager.addSubscriber(sessionId, ws, context.getMaxSubscribers())) return

  // The socket is the device's identity for as long as it is open, which is
  // exactly as long as the view should list it.
  socket.deviceId = `${sessionId}:${randomUUID()}`
  context.deviceRegistry?.add({
    id: socket.deviceId,
    userAgent: socket.userAgent,
    viewing: sessionId,
    close: () => ws.close(4004, 'disconnected from the app'),
  })

  // First remote viewer of an app-owned session starts the broadcast, which lives
  // as long as the session. Attached only after acceptance so a rejected
  // connection leaves no listener broadcasting to zero subscribers.
  context.streams.attachBroadcast(sessionId)
  // Cancel any pending grace-period teardown — client reconnected in time
  context.streams.cancelTeardown(sessionId)
}
