import type { FastifyInstance } from 'fastify'
import type { SocketStream } from '@fastify/websocket'
import type { FastifyRequest } from 'fastify'
import bcryptjs from 'bcryptjs'
import { bridgeEventBus } from '../bridge-event-bus.js'
import { ipcInvokeRegistry, ipcSendRegistry } from '../ipc-registry.js'

interface BridgeOptions {
  getPasswordHash: () => string
}

export async function registerBridgeRoute(
  app: FastifyInstance,
  opts: BridgeOptions
): Promise<void> {
  const { getPasswordHash } = opts

  app.get(
    '/api/bridge',
    { websocket: true },
    async (connection: SocketStream, request: FastifyRequest) => {
      const ws = connection.socket

      // Authenticate via ?token= query param (WebSocket can't send headers from browser)
      const token = (request.query as Record<string, string>).token ?? ''
      const hash = getPasswordHash()
      if (!hash || !(await bcryptjs.compare(token, hash))) {
        ws.close(4001, 'unauthorized')
        return
      }

      // Forward bridge-event-bus events to this client
      const subscribedChannels = new Set<string>()

      function forwardEvent(channel: string, ...args: unknown[]) {
        if (ws.readyState !== ws.OPEN) return
        ws.send(JSON.stringify({ type: 'event', channel, args }))
      }

      const channelForwarders = new Map<string, (...args: unknown[]) => void>()

      function subscribe(channel: string) {
        if (subscribedChannels.has(channel)) return
        subscribedChannels.add(channel)
        const forwarder = (...args: unknown[]) => forwardEvent(channel, ...args)
        channelForwarders.set(channel, forwarder)
        bridgeEventBus.on(channel, forwarder)
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
          const handler = ipcSendRegistry.get(msg.channel)
          if (handler) handler(null as never, (msg.args?.[0] ?? {}) as never)
          return
        }

        if (msg.type === 'invoke' && msg.id && msg.channel) {
          const { id, channel, args } = msg
          const handler = ipcInvokeRegistry.get(channel)
          try {
            const result = handler
              ? await handler(null as never, (args?.[0] ?? {}) as never)
              : undefined
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
        for (const [channel, forwarder] of channelForwarders) {
          bridgeEventBus.off(channel, forwarder)
        }
        channelForwarders.clear()
        subscribedChannels.clear()
      })
    }
  )
}
