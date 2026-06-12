import { randomUUID } from 'crypto'
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import type { SocketStream } from '@fastify/websocket'
import type { PtyManager } from '../../terminal/pty-manager'
import type { WsTicketStore } from '../ws-ticket-store'
import type { WsSubscriberManager } from '../ws-subscriber-manager'

const CreateTerminalSchema = z.object({
  cwd: z.string().min(1),
  type: z.enum(['human', 'agent']).default('human'),
  tabTitle: z.string().min(1).max(100),
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
}

interface TerminalRouteOptions {
  ptyManager: PtyManager
  ticketStore: WsTicketStore
  subscriberManager: WsSubscriberManager
}

export async function registerTerminalRoutes(
  app: FastifyInstance,
  opts: TerminalRouteOptions
): Promise<void> {
  const { ptyManager, ticketStore, subscriberManager } = opts
  const sessions = new Map<string, TerminalSession>()

  app.post('/api/terminals', async (request, reply) => {
    const result = CreateTerminalSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', message: result.error.message })
    }

    const { cwd, type } = result.data
    const sessionId = randomUUID()

    const onData = (data: string) => subscriberManager.broadcast(sessionId, data)
    const onExit = () => {
      subscriberManager.destroySession(sessionId)
      sessions.delete(sessionId)
    }

    ptyManager.spawn(sessionId, cwd, process.env.SHELL || '/bin/zsh', type, onData, onExit)
    sessions.set(sessionId, { sessionId, cwd, createdAt: new Date().toISOString() })

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

  app.post<{ Params: { sessionId: string } }>(
    '/api/terminals/:sessionId/ws-ticket',
    async (request, reply) => {
      const { sessionId } = request.params
      if (!sessions.has(sessionId)) return reply.status(404).send({ error: 'NOT_FOUND' })
      const ticket = ticketStore.createTicket(sessionId)
      return reply.status(201).send({ ticket })
    }
  )

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

      const ticketSessionId = ticketStore.consumeTicket(ticket)
      if (!ticketSessionId || ticketSessionId !== sessionId) {
        ws.close(4001, 'invalid or expired ticket')
        return
      }

      if (!sessions.has(sessionId)) {
        ws.close(4002, 'session not found')
        return
      }

      subscriberManager.addSubscriber(sessionId, ws)

      ws.on('message', (msg) => {
        if (subscriberManager.isPrimary(sessionId, ws)) {
          ptyManager.write(sessionId, msg.toString())
        }
      })

      ws.on('close', () => {
        subscriberManager.removeSubscriber(sessionId, ws)
      })
    }
  )
}
