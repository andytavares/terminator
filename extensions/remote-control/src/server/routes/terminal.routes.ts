import { randomUUID } from 'crypto'
import { homedir } from 'os'
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import type { SocketStream } from '@fastify/websocket'
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

interface TerminalSession {
  sessionId: string
  cwd: string
  createdAt: string
  workspaceId?: string
}

interface TerminalRouteOptions {
  ptyManager: PtyManagerAPI
  ticketStore: WsTicketStore
  subscriberManager: WsSubscriberManager
  getMaxSubscribers: () => number
}

const AssignWorkspaceSchema = z.object({
  workspaceId: z.string().nullable(),
})

export async function registerTerminalRoutes(
  app: FastifyInstance,
  opts: TerminalRouteOptions
): Promise<{ cleanup: () => void }> {
  const { ptyManager, ticketStore, subscriberManager, getMaxSubscribers } = opts
  const sessions = new Map<string, TerminalSession>()
  // Manual workspace overrides keyed by sessionId
  const workspaceOverrides = new Map<string, string>()
  // Sessions adopted from the Electron app — must not be killed on grace-period expiry
  const adoptedSessions = new Set<string>()
  // Cleanup callbacks for adopted session data listeners
  const adoptedSessionDisposers = new Map<string, () => void>()

  app.get('/api/terminals', async () => {
    const remote = Array.from(sessions.values()).map((s) => ({
      ...s,
      workspaceId: workspaceOverrides.get(s.sessionId),
    }))
    const remoteIds = new Set(remote.map((s) => s.sessionId))
    const existing = ptyManager
      .listSessions()
      .filter((s) => !remoteIds.has(s.sessionId))
      .map((s) => ({
        sessionId: s.sessionId,
        cwd: s.cwd,
        createdAt: '',
        workspaceId: workspaceOverrides.get(s.sessionId),
      }))
    return [...remote, ...existing]
  })

  app.post('/api/terminals', async (request, reply) => {
    const result = CreateTerminalSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', message: result.error.message })
    }

    const { cwd, type } = result.data
    const sessionId = randomUUID()
    const resolvedCwd = cwd.startsWith('~') ? cwd.replace(/^~/, homedir()) : cwd

    const onData = (data: string) => subscriberManager.broadcast(sessionId, data)
    const onExit = () => {
      subscriberManager.destroySession(sessionId)
      sessions.delete(sessionId)
    }

    ptyManager.spawn(sessionId, resolvedCwd, process.env.SHELL || '/bin/zsh', type, onData, onExit)
    sessions.set(sessionId, { sessionId, cwd: resolvedCwd, createdAt: new Date().toISOString() })

    return reply.status(201).send({ sessionId })
  })

  app.get<{ Params: { sessionId: string } }>(
    '/api/terminals/:sessionId',
    async (request, reply) => {
      const session = sessions.get(request.params.sessionId)
      if (!session) return reply.status(404).send({ error: 'NOT_FOUND' })
      return {
        ...session,
        subscriberCount: subscriberManager.getCount(request.params.sessionId),
      }
    }
  )

  app.delete<{ Params: { sessionId: string } }>(
    '/api/terminals/:sessionId',
    async (request, reply) => {
      const { sessionId } = request.params
      if (!sessions.has(sessionId)) return reply.status(404).send({ error: 'NOT_FOUND' })
      ptyManager.kill(sessionId)
      subscriberManager.destroySession(sessionId)
      sessions.delete(sessionId)
      return { ok: true }
    }
  )

  app.post<{ Params: { sessionId: string } }>(
    '/api/terminals/:sessionId/resize',
    async (request, reply) => {
      const { sessionId } = request.params
      if (!sessions.has(sessionId)) return reply.status(404).send({ error: 'NOT_FOUND' })
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
      const isRemote = sessions.has(sessionId)
      const isExisting =
        !isRemote && ptyManager.listSessions().some((s) => s.sessionId === sessionId)
      if (!isRemote && !isExisting) return reply.status(404).send({ error: 'NOT_FOUND' })
      const result = AssignWorkspaceSchema.safeParse(request.body)
      if (!result.success) {
        return reply.status(400).send({ error: 'VALIDATION_ERROR', message: result.error.message })
      }
      const { workspaceId } = result.data
      if (workspaceId === null) {
        workspaceOverrides.delete(sessionId)
      } else {
        workspaceOverrides.set(sessionId, workspaceId)
      }
      return { ok: true }
    }
  )

  app.post<{ Params: { sessionId: string } }>(
    '/api/terminals/:sessionId/ws-ticket',
    async (request, reply) => {
      const { sessionId } = request.params
      const isKnown =
        sessions.has(sessionId) || ptyManager.listSessions().some((s) => s.sessionId === sessionId)
      if (!isKnown) return reply.status(404).send({ error: 'NOT_FOUND' })
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
    (connection: SocketStream, request) => {
      const { sessionId } = request.params
      const { ticket } = request.query
      const ws = connection.socket

      if (!ticket) {
        ws.close(4001, 'ticket required')
        return
      }

      const ticketSessionId = ticketStore.consumeTicket(ticket, 'terminal')
      if (!ticketSessionId || ticketSessionId !== sessionId) {
        ws.close(4001, 'invalid or expired ticket')
        return
      }

      if (!sessions.has(sessionId)) {
        // Adopt an existing ptyManager session on first remote connect
        const existing = ptyManager.listSessions().find((s) => s.sessionId === sessionId)
        if (!existing) {
          ws.close(4002, 'session not found')
          return
        }
        sessions.set(sessionId, {
          sessionId,
          cwd: existing.cwd,
          createdAt: new Date().toISOString(),
        })
        adoptedSessions.add(sessionId)
        const dispose = ptyManager.attachOnData(sessionId, (data) =>
          subscriberManager.broadcast(sessionId, data)
        )
        // Keep the broadcast callback alive across reconnects — do NOT tie it to ws close.
        if (dispose) adoptedSessionDisposers.set(sessionId, dispose)
      }

      const accepted = subscriberManager.addSubscriber(sessionId, ws, getMaxSubscribers())
      if (!accepted) return

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
        if (subscriberManager.getCount(sessionId) === 0 && sessions.has(sessionId)) {
          // Grace period: mobile clients navigate away (unmounting the view) without
          // intending to end the session. Wait 30s before tearing down the PTY so
          // navigating back reconnects to the live process.
          const timer = setTimeout(() => {
            gracePeriodTimers.delete(sessionId)
            if (subscriberManager.getCount(sessionId) === 0 && sessions.has(sessionId)) {
              if (!adoptedSessions.has(sessionId)) {
                ptyManager.kill(sessionId)
              }
              const disposer = adoptedSessionDisposers.get(sessionId)
              if (disposer) {
                disposer()
                adoptedSessionDisposers.delete(sessionId)
              }
              adoptedSessions.delete(sessionId)
              sessions.delete(sessionId)
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
      for (const sessionId of sessions.keys()) {
        if (!adoptedSessions.has(sessionId)) {
          ptyManager.kill(sessionId)
        }
        subscriberManager.destroySession(sessionId)
      }
      for (const disposer of adoptedSessionDisposers.values()) disposer()
      adoptedSessionDisposers.clear()
      adoptedSessions.clear()
      sessions.clear()
    },
  }
}
