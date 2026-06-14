import type { FastifyInstance } from 'fastify'
import type { SocketStream } from '@fastify/websocket'
import type { FastifyRequest } from 'fastify'
import type WebSocket from 'ws'
import type { WsTicketStore } from '../ws-ticket-store.js'

interface BridgeOptions {
  ticketStore: WsTicketStore
  invokeChannel: (channel: string, payload: unknown) => Promise<unknown>
  sendChannel: (channel: string, payload: unknown) => void
  onWindowEvent: (channel: string, handler: (...args: unknown[]) => void) => () => void
}

export async function registerBridgeRoute(
  app: FastifyInstance,
  opts: BridgeOptions
): Promise<{ disconnectAll: () => void }> {
  const { ticketStore, invokeChannel, sendChannel, onWindowEvent } = opts
  const bridgeConnections = new Set<WebSocket>()

  app.post('/api/bridge-ticket', async (_request, reply) => {
    const ticket = ticketStore.createTicket('__bridge__', 'bridge')
    return reply.status(201).send({ ticket })
  })

  app.get(
    '/api/bridge',
    { websocket: true },
    async (connection: SocketStream, request: FastifyRequest) => {
      const ws = connection.socket

      const ticket = (request.query as Record<string, string>).ticket ?? ''
      const sessionId = ticketStore.consumeTicket(ticket, 'bridge')
      if (!sessionId) {
        ws.close(4001, 'unauthorized')
        return
      }

      bridgeConnections.add(ws)

      const subscribedChannels = new Set<string>()
      const unsubscribers = new Map<string, () => void>()

      function forwardEvent(channel: string, ...args: unknown[]) {
        if (ws.readyState !== ws.OPEN) return
        ws.send(JSON.stringify({ type: 'event', channel, args }))
      }

      function subscribe(channel: string) {
        if (subscribedChannels.has(channel)) return
        subscribedChannels.add(channel)
        const unsub = onWindowEvent(channel, (...args) => forwardEvent(channel, ...args))
        unsubscribers.set(channel, unsub)
      }

      ws.on('message', async (raw) => {
        let msg: { type: string; id?: string; channel?: string; args?: unknown[] }
        try {
          msg = JSON.parse(raw.toString())
        } catch {
          return
        }

        if (msg.type === 'subscribe' && msg.channel) {
          subscribe(msg.channel)
          return
        }

        if (msg.type === 'send' && msg.channel) {
          sendChannel(msg.channel, (msg.args?.[0] ?? {}) as unknown)
          return
        }

        if (msg.type === 'invoke' && msg.id && msg.channel) {
          const { id, channel, args } = msg
          try {
            const result = await invokeChannel(channel, args?.[0] ?? {})
            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({ type: 'result', id, result }))
            }
          } catch (err) {
            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({ type: 'error', id, error: String(err) }))
            }
          }
          return
        }
      })

      ws.on('close', () => {
        bridgeConnections.delete(ws)
        for (const unsub of unsubscribers.values()) unsub()
        unsubscribers.clear()
        subscribedChannels.clear()
      })
    }
  )

  return {
    disconnectAll() {
      for (const conn of bridgeConnections) conn.terminate()
      bridgeConnections.clear()
    },
  }
}
