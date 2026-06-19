import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import websocketPlugin from '@fastify/websocket'
import { WebSocket } from 'ws'
import { WsTicketStore } from '../../src/server/ws-ticket-store'

let mockInvokeChannel: ReturnType<typeof vi.fn>
let mockSendChannel: ReturnType<typeof vi.fn>
let mockOnWindowEvent: ReturnType<typeof vi.fn>

function waitForClose(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.CLOSED) {
      resolve()
      return
    }
    // terminate() on the server causes ECONNRESET (error) on the client before or
    // instead of a clean close frame — resolve on either, not reject on error
    ws.once('close', resolve)
    ws.once('error', resolve)
    setTimeout(() => reject(new Error('timeout waiting for close')), 8000)
  })
}

function waitForMessage(ws: WebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    ws.once('message', (data) => resolve(data.toString()))
    ws.on('error', reject)
    setTimeout(() => reject(new Error('timeout waiting for message')), 8000)
  })
}

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.on('open', resolve)
    ws.on('error', reject)
    setTimeout(() => reject(new Error('timeout waiting for open')), 8000)
  })
}

async function buildBridgeApp(): Promise<{
  app: FastifyInstance
  ticketStore: WsTicketStore
  bridgeCleanup: { disconnectAll: () => void }
}> {
  const { registerBridgeRoute } = await import('../../src/server/routes/bridge.route')
  const ticketStore = new WsTicketStore()
  const app = Fastify({ logger: false })
  await app.register(websocketPlugin)
  const bridgeCleanup = await registerBridgeRoute(app, {
    ticketStore,
    invokeChannel: mockInvokeChannel,
    sendChannel: mockSendChannel,
    onWindowEvent: mockOnWindowEvent,
  })
  return { app, ticketStore, bridgeCleanup }
}

describe('bridge.route', () => {
  let app: FastifyInstance
  let ticketStore: WsTicketStore
  let bridgeCleanup: { disconnectAll: () => void }
  let baseUrl: string

  beforeEach(async () => {
    vi.resetModules()
    mockInvokeChannel = vi.fn().mockResolvedValue(undefined)
    mockSendChannel = vi.fn()
    mockOnWindowEvent = vi.fn().mockReturnValue(vi.fn())
    ;({ app, ticketStore, bridgeCleanup } = await buildBridgeApp())
    await app.listen({ port: 0, host: '127.0.0.1' })
    const addr = app.server.address() as { port: number; address: string }
    baseUrl = `ws://${addr.address}:${addr.port}`
  })

  afterEach(async () => {
    await app.close()
  })

  describe('POST /api/bridge-ticket', () => {
    it('returns 201 with a ticket string', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/bridge-ticket' })
      expect(res.statusCode).toBe(201)
      const body = JSON.parse(res.body) as { ticket: string }
      expect(typeof body.ticket).toBe('string')
      expect(body.ticket.length).toBeGreaterThan(0)
    })
  })

  describe('authentication', () => {
    it('closes connection when no ticket provided', async () => {
      const ws = new WebSocket(`${baseUrl}/api/bridge`)
      await waitForClose(ws)
    })

    it('closes connection when invalid ticket provided', async () => {
      const ws = new WebSocket(`${baseUrl}/api/bridge?ticket=invalid-ticket`)
      await waitForClose(ws)
    })

    it('accepts connection with a valid ticket', async () => {
      const ticket = ticketStore.createTicket('__bridge__', 'bridge')
      const ws = new WebSocket(`${baseUrl}/api/bridge?ticket=${ticket}`)
      await waitForOpen(ws)
      ws.close()
      await waitForClose(ws)
    })

    it('rejects a ticket that has already been consumed', async () => {
      const ticket = ticketStore.createTicket('__bridge__', 'bridge')
      ticketStore.consumeTicket(ticket, 'bridge')
      const ws = new WebSocket(`${baseUrl}/api/bridge?ticket=${ticket}`)
      await waitForClose(ws)
    })
  })

  describe('subscribe messages', () => {
    it('subscribes to a channel via onWindowEvent', async () => {
      const ticket = ticketStore.createTicket('__bridge__', 'bridge')
      const ws = new WebSocket(`${baseUrl}/api/bridge?ticket=${ticket}`)
      await waitForOpen(ws)

      ws.send(JSON.stringify({ type: 'subscribe', channel: 'terminal:output' }))
      await new Promise((r) => setTimeout(r, 30))

      expect(mockOnWindowEvent).toHaveBeenCalledWith('terminal:output', expect.any(Function))
      ws.close()
      await waitForClose(ws)
    })

    it('does not double-subscribe to the same channel', async () => {
      const ticket = ticketStore.createTicket('__bridge__', 'bridge')
      const ws = new WebSocket(`${baseUrl}/api/bridge?ticket=${ticket}`)
      await waitForOpen(ws)

      ws.send(JSON.stringify({ type: 'subscribe', channel: 'terminal:output' }))
      ws.send(JSON.stringify({ type: 'subscribe', channel: 'terminal:output' }))
      await new Promise((r) => setTimeout(r, 30))

      const calls = mockOnWindowEvent.mock.calls.filter(([ch]) => ch === 'terminal:output')
      expect(calls.length).toBe(1)
      ws.close()
      await waitForClose(ws)
    })
  })

  describe('invoke messages', () => {
    it('dispatches invoke to invokeChannel and sends result back', async () => {
      mockInvokeChannel.mockImplementation(async (ch: string) => {
        if (ch === 'workspace:list') return [{ id: 'ws-1', name: 'Test' }]
      })

      const ticket = ticketStore.createTicket('__bridge__', 'bridge')
      const ws = new WebSocket(`${baseUrl}/api/bridge?ticket=${ticket}`)
      await waitForOpen(ws)
      ws.send(JSON.stringify({ type: 'invoke', id: 'r1', channel: 'workspace:list', args: [{}] }))

      const msg = await waitForMessage(ws)
      const parsed = JSON.parse(msg)

      expect(parsed.type).toBe('result')
      expect(parsed.id).toBe('r1')
      expect(parsed.result).toEqual([{ id: 'ws-1', name: 'Test' }])
      ws.close()
      await waitForClose(ws)
    })

    it('sends result: undefined when invokeChannel returns undefined', async () => {
      mockInvokeChannel.mockResolvedValue(undefined)

      const ticket = ticketStore.createTicket('__bridge__', 'bridge')
      const ws = new WebSocket(`${baseUrl}/api/bridge?ticket=${ticket}`)
      await waitForOpen(ws)
      ws.send(JSON.stringify({ type: 'invoke', id: 'r2', channel: 'nonexistent', args: [{}] }))

      const msg = await waitForMessage(ws)
      const parsed = JSON.parse(msg)

      expect(parsed.type).toBe('result')
      expect(parsed.id).toBe('r2')
      ws.close()
      await waitForClose(ws)
    })

    it('sends error response when invokeChannel throws', async () => {
      mockInvokeChannel.mockRejectedValue(new Error('validation failed'))

      const ticket = ticketStore.createTicket('__bridge__', 'bridge')
      const ws = new WebSocket(`${baseUrl}/api/bridge?ticket=${ticket}`)
      await waitForOpen(ws)
      ws.send(JSON.stringify({ type: 'invoke', id: 'r3', channel: 'workspace:create', args: [{}] }))

      const msg = await waitForMessage(ws)
      const parsed = JSON.parse(msg)

      expect(parsed.type).toBe('error')
      expect(parsed.id).toBe('r3')
      expect(parsed.error).toContain('validation failed')
      ws.close()
      await waitForClose(ws)
    })
  })

  describe('send messages', () => {
    it('dispatches fire-and-forget via sendChannel', async () => {
      const ticket = ticketStore.createTicket('__bridge__', 'bridge')
      const ws = new WebSocket(`${baseUrl}/api/bridge?ticket=${ticket}`)
      await waitForOpen(ws)
      ws.send(
        JSON.stringify({
          type: 'send',
          channel: 'terminal:input',
          args: [{ sessionId: 's1', data: 'ls' }],
        })
      )
      await new Promise((r) => setTimeout(r, 30))

      expect(mockSendChannel).toHaveBeenCalledWith('terminal:input', {
        sessionId: 's1',
        data: 'ls',
      })
      ws.close()
      await waitForClose(ws)
    })

    it('ignores send for unknown channel (no crash)', async () => {
      const ticket = ticketStore.createTicket('__bridge__', 'bridge')
      const ws = new WebSocket(`${baseUrl}/api/bridge?ticket=${ticket}`)
      await waitForOpen(ws)
      ws.send(JSON.stringify({ type: 'send', channel: 'no:handler', args: [{}] }))
      await new Promise((r) => setTimeout(r, 30))
      ws.close()
      await waitForClose(ws)
    })
  })

  describe('event forwarding', () => {
    it('forwards onWindowEvent events to subscribed client', async () => {
      const ticket = ticketStore.createTicket('__bridge__', 'bridge')
      const ws = new WebSocket(`${baseUrl}/api/bridge?ticket=${ticket}`)
      await waitForOpen(ws)
      ws.send(JSON.stringify({ type: 'subscribe', channel: 'terminal:output' }))
      await new Promise((r) => setTimeout(r, 30))

      const [[, forwarder]] = mockOnWindowEvent.mock.calls as [[string, (...a: unknown[]) => void]]
      forwarder({ sessionId: 's1', data: 'hello' })

      const msg = await waitForMessage(ws)
      const parsed = JSON.parse(msg)
      expect(parsed.type).toBe('event')
      expect(parsed.channel).toBe('terminal:output')
      ws.close()
      await waitForClose(ws)
    })
  })

  describe('disconnectAll()', () => {
    it('closes all active bridge connections', async () => {
      const ticket1 = ticketStore.createTicket('__bridge__', 'bridge')
      const ticket2 = ticketStore.createTicket('__bridge__', 'bridge')
      const ws1 = new WebSocket(`${baseUrl}/api/bridge?ticket=${ticket1}`)
      const ws2 = new WebSocket(`${baseUrl}/api/bridge?ticket=${ticket2}`)
      await waitForOpen(ws1)
      await waitForOpen(ws2)

      bridgeCleanup.disconnectAll()

      await waitForClose(ws1)
      await waitForClose(ws2)
    }, 20000)

    it('is safe to call when no connections are open', () => {
      expect(() => bridgeCleanup.disconnectAll()).not.toThrow()
    })
  })

  describe('close cleanup', () => {
    it('calls the unsub function returned by onWindowEvent on disconnect', async () => {
      const unsub = vi.fn()
      mockOnWindowEvent.mockReturnValue(unsub)

      const ticket = ticketStore.createTicket('__bridge__', 'bridge')
      const ws = new WebSocket(`${baseUrl}/api/bridge?ticket=${ticket}`)
      await waitForOpen(ws)
      ws.send(JSON.stringify({ type: 'subscribe', channel: 'terminal:output' }))
      await new Promise((r) => setTimeout(r, 30))

      ws.close()
      await waitForClose(ws)
      await new Promise((r) => setTimeout(r, 30))

      expect(unsub).toHaveBeenCalled()
    })
  })

  describe('ticket purpose scoping', () => {
    it('rejects a terminal-purpose ticket on the bridge endpoint', async () => {
      const terminalTicket = ticketStore.createTicket('some-session-id', 'terminal')
      const ws = new WebSocket(`${baseUrl}/api/bridge?ticket=${terminalTicket}`)
      await waitForClose(ws)
    })

    it('rejects an app-purpose ticket on the bridge endpoint', async () => {
      const appTicket = ticketStore.createTicket('__app__', 'app')
      const ws = new WebSocket(`${baseUrl}/api/bridge?ticket=${appTicket}`)
      await waitForClose(ws)
    })
  })

  describe('invalid messages', () => {
    it('ignores non-JSON messages without crashing', async () => {
      const ticket = ticketStore.createTicket('__bridge__', 'bridge')
      const ws = new WebSocket(`${baseUrl}/api/bridge?ticket=${ticket}`)
      await waitForOpen(ws)
      ws.send('not json at all')
      await new Promise((r) => setTimeout(r, 30))
      ws.close()
      await waitForClose(ws)
    })
  })
})
