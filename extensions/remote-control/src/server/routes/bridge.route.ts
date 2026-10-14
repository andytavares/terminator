import type { FastifyInstance } from 'fastify'
import type { FastifyRequest } from 'fastify'
import type WebSocket from 'ws'
import type { WsTicketStore } from '../ws-ticket-store.js'

interface BridgeOptions {
  ticketStore: WsTicketStore
  invokeChannel: (channel: string, payload: unknown) => Promise<unknown>
  sendChannel: (channel: string, payload: unknown) => void
  onWindowEvent: (channel: string, handler: (...args: unknown[]) => void) => () => void
  isRemoteAccessible: (channel: string) => Promise<boolean>
}

interface BridgeMessage {
  type: string
  id?: string
  channel?: string
  args?: unknown[]
}

export async function registerBridgeRoute(
  app: FastifyInstance,
  opts: BridgeOptions
): Promise<{ disconnectAll: () => void }> {
  const { ticketStore } = opts
  const bridgeConnections = new Set<WebSocket>()

  app.post('/api/bridge-ticket', async (_request, reply) => {
    const ticket = ticketStore.createTicket('__bridge__', 'bridge')
    return reply.status(201).send({ ticket })
  })

  app.get('/api/bridge', { websocket: true }, async (ws: WebSocket, request: FastifyRequest) => {
    const ticket = (request.query as Record<string, string>).ticket ?? ''
    if (!ticketStore.consumeTicket(ticket, 'bridge')) {
      ws.close(4001, 'unauthorized')
      return
    }
    acceptBridgeSocket(ws, opts, bridgeConnections)
  })

  return {
    disconnectAll() {
      for (const conn of bridgeConnections) conn.terminate()
      bridgeConnections.clear()
    },
  }
}

function acceptBridgeSocket(ws: WebSocket, opts: BridgeOptions, connections: Set<WebSocket>) {
  connections.add(ws)
  const connection = new BridgeConnection(ws, opts)
  ws.on('message', (raw) => connection.receive(raw.toString()))
  ws.on('close', () => {
    connections.delete(ws)
    connection.unsubscribeAll()
  })
}

/** One bridge socket: the event channels it subscribed to, and its requests. */
class BridgeConnection {
  private unsubscribers = new Map<string, () => void>()

  constructor(
    private ws: WebSocket,
    private opts: BridgeOptions
  ) {}

  async receive(raw: string): Promise<void> {
    let msg: BridgeMessage
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    if (!msg.channel) return
    if (msg.type === 'subscribe') return this.subscribe(msg.channel)
    if (msg.type === 'send') return this.relaySend(msg.channel, msg.args)
    if (msg.type === 'invoke' && msg.id) return this.relayInvoke(msg.id, msg.channel, msg.args)
  }

  unsubscribeAll(): void {
    for (const unsub of this.unsubscribers.values()) unsub()
    this.unsubscribers.clear()
  }

  private async subscribe(channel: string): Promise<void> {
    // Default-deny: only allowlisted event channels may be subscribed to,
    // so a bridge client cannot eavesdrop on arbitrary main-process events.
    if (!(await this.opts.isRemoteAccessible(channel))) return
    if (this.unsubscribers.has(channel)) return
    const unsub = this.opts.onWindowEvent(channel, (...args) =>
      this.sendToClient({ type: 'event', channel, args })
    )
    this.unsubscribers.set(channel, unsub)
  }

  private async relaySend(channel: string, args: unknown[] | undefined): Promise<void> {
    // Default-deny: only allowlisted fire-and-forget channels may be driven.
    if (!(await this.opts.isRemoteAccessible(channel))) return
    this.opts.sendChannel(channel, (args?.[0] ?? {}) as unknown)
  }

  private async relayInvoke(
    id: string,
    channel: string,
    args: unknown[] | undefined
  ): Promise<void> {
    if (!(await this.opts.isRemoteAccessible(channel))) {
      this.sendToClient({ type: 'error', id, error: 'channel not remote-accessible' })
      return
    }
    try {
      const result = await this.opts.invokeChannel(channel, args?.[0] ?? {})
      this.sendToClient({ type: 'result', id, result })
    } catch (err) {
      this.sendToClient({ type: 'error', id, error: String(err) })
    }
  }

  private sendToClient(message: Record<string, unknown>): void {
    if (this.ws.readyState !== this.ws.OPEN) return
    this.ws.send(JSON.stringify(message))
  }
}
