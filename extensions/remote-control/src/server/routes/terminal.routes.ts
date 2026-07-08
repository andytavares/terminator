import { randomUUID } from 'crypto'
import { homedir } from 'os'
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import type WebSocket from 'ws'
import type { PtyManagerAPI } from '../../types.js'
import type { WsTicketStore } from '../ws-ticket-store.js'
import type { WsSubscriberManager } from '../ws-subscriber-manager.js'

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
  getMaxSubscribers: () => number
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
): Promise<{ cleanup: () => void }> {
  const { ptyManager, ticketStore, subscriberManager, getMaxSubscribers } = opts

  // One output-broadcast listener per session this surface is streaming.
  const broadcastDisposers = new Map<string, () => void>()

  function attachBroadcast(sessionId: string): void {
    if (broadcastDisposers.has(sessionId)) return
    const disposeData = ptyManager.onData(sessionId, (data) =>
      subscriberManager.broadcast(sessionId, data)
    )
    if (!disposeData) return
    const disposeExit = ptyManager.onExit(sessionId, () => {
      broadcastDisposers.delete(sessionId)
      subscriberManager.destroySession(sessionId)
    })
    // Store BOTH disposers: detaching only onData would let a later reconnect
    // stack a second exit listener on a still-live app session.
    broadcastDisposers.set(sessionId, () => {
      disposeData()
      disposeExit?.()
    })
  }

  app.get('/api/terminals', async () => {
    return ptyManager.listSessions().map((s) => ({
      sessionId: s.sessionId,
      cwd: s.cwd,
      createdAt: s.createdAt,
      workspaceId: s.workspaceId,
    }))
  })

  app.post('/api/terminals', async (request, reply) => {
    const result = CreateTerminalSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', message: result.error.message })
    }

    const { cwd, type } = result.data
    const sessionId = randomUUID()
    const resolvedCwd = cwd.startsWith('~') ? cwd.replace(/^~/, homedir()) : cwd

    ptyManager.spawnSession({
      sessionId,
      cwd: resolvedCwd,
      shell: process.env.SHELL || '/bin/zsh',
      type,
      origin: 'remote',
    })
    attachBroadcast(sessionId)

    return reply.status(201).send({ sessionId })
  })

  app.get<{ Params: { sessionId: string } }>(
    '/api/terminals/:sessionId',
    async (request, reply) => {
      const session = ptyManager.getSession(request.params.sessionId)
      if (!session) return reply.status(404).send({ error: 'NOT_FOUND' })
      return {
        sessionId: session.sessionId,
        cwd: session.cwd,
        createdAt: session.createdAt,
        workspaceId: session.workspaceId,
        subscriberCount: subscriberManager.getCount(request.params.sessionId),
      }
    }
  )

  app.delete<{ Params: { sessionId: string } }>(
    '/api/terminals/:sessionId',
    async (request, reply) => {
      const { sessionId } = request.params
      const session = ptyManager.getSession(sessionId)
      if (!session) return reply.status(404).send({ error: 'NOT_FOUND' })
      // App-owned sessions keep running in Electron; only stop streaming them.
      if (session.origin === 'remote') {
        ptyManager.kill(sessionId)
      }
      subscriberManager.destroySession(sessionId)
      const dispose = broadcastDisposers.get(sessionId)
      if (dispose) {
        dispose()
        broadcastDisposers.delete(sessionId)
      }
      return { ok: true }
    }
  )

  app.post<{ Params: { sessionId: string } }>(
    '/api/terminals/:sessionId/resize',
    async (request, reply) => {
      const { sessionId } = request.params
      if (!ptyManager.getSession(sessionId)) return reply.status(404).send({ error: 'NOT_FOUND' })
      const result = ResizeSchema.safeParse(request.body)
      if (!result.success) {
        return reply.status(400).send({ error: 'VALIDATION_ERROR', message: result.error.message })
      }
      ptyManager.resize(sessionId, result.data.cols, result.data.rows)
      return { ok: true }
    }
  )

  app.patch<{ Params: { sessionId: string } }>(
    '/api/terminals/:sessionId',
    async (request, reply) => {
      const { sessionId } = request.params
      const result = AssignWorkspaceSchema.safeParse(request.body)
      if (!result.success) {
        return reply.status(400).send({ error: 'VALIDATION_ERROR', message: result.error.message })
      }
      if (!ptyManager.setWorkspace(sessionId, result.data.workspaceId)) {
        return reply.status(404).send({ error: 'NOT_FOUND' })
      }
      return { ok: true }
    }
  )

  app.post<{ Params: { sessionId: string } }>(
    '/api/terminals/:sessionId/ws-ticket',
    async (request, reply) => {
      const { sessionId } = request.params
      if (!ptyManager.getSession(sessionId)) return reply.status(404).send({ error: 'NOT_FOUND' })
      const ticket = ticketStore.createTicket(sessionId, 'terminal')
      return reply.status(201).send({ ticket })
    }
  )

  // Track pending grace-period teardown timers per session so they can be
  // cancelled if the same session reconnects before the window expires.
  const gracePeriodTimers = new Map<string, ReturnType<typeof setTimeout>>()

  app.get<{ Params: { sessionId: string }; Querystring: { ticket?: string } }>(
    '/ws/terminals/:sessionId',
    { websocket: true },
    (ws: WebSocket, request) => {
      const { sessionId } = request.params
      const { ticket } = request.query

      if (!ticket) {
        ws.close(4001, 'ticket required')
        return
      }

      const ticketSessionId = ticketStore.consumeTicket(ticket, 'terminal')
      if (!ticketSessionId || ticketSessionId !== sessionId) {
        ws.close(4001, 'invalid or expired ticket')
        return
      }

      if (!ptyManager.getSession(sessionId)) {
        ws.close(4002, 'session not found')
        return
      }

      const accepted = subscriberManager.addSubscriber(sessionId, ws, getMaxSubscribers())
      if (!accepted) return

      // First remote viewer of an app-owned session starts the broadcast; the
      // listener stays attached across reconnects and dies with the session.
      // Attached only after acceptance so a rejected connection leaves no
      // listener broadcasting to zero subscribers.
      attachBroadcast(sessionId)

      // Cancel any pending grace-period teardown — client reconnected in time
      const pending = gracePeriodTimers.get(sessionId)
      if (pending !== undefined) {
        clearTimeout(pending)
        gracePeriodTimers.delete(sessionId)
      }

      ws.on('message', (msg) => {
        if (subscriberManager.isPrimary(sessionId, ws)) {
          ptyManager.write(sessionId, msg.toString())
        }
      })

      ws.on('close', () => {
        subscriberManager.removeSubscriber(sessionId, ws)
        if (subscriberManager.getCount(sessionId) === 0 && ptyManager.getSession(sessionId)) {
          // Grace period: mobile clients navigate away (unmounting the view) without
          // intending to end the session. Wait 30s before tearing down the PTY so
          // navigating back reconnects to the live process.
          const timer = setTimeout(() => {
            gracePeriodTimers.delete(sessionId)
            if (subscriberManager.getCount(sessionId) !== 0) return
            const session = ptyManager.getSession(sessionId)
            // App-owned sessions keep running in Electron — never kill them here.
            if (session?.origin === 'remote') {
              ptyManager.kill(sessionId)
            }
          }, 30_000)
          gracePeriodTimers.set(sessionId, timer)
        }
      })
    }
  )

  return {
    cleanup() {
      for (const timer of gracePeriodTimers.values()) clearTimeout(timer)
      gracePeriodTimers.clear()
      for (const session of ptyManager.listSessions()) {
        if (session.origin === 'remote') {
          ptyManager.kill(session.sessionId)
        }
      }
      for (const [sessionId, dispose] of broadcastDisposers) {
        dispose()
        subscriberManager.destroySession(sessionId)
      }
      broadcastDisposers.clear()
    },
  }
}
