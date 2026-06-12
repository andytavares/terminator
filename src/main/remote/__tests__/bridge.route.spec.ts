import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import websocketPlugin from '@fastify/websocket'
import { WebSocket } from 'ws'
import { WsTicketStore } from '../ws-ticket-store'

const mockBridgeEventBus = {
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
}

const mockIpcInvokeRegistry = new Map<string, (...args: unknown[]) => unknown>()
const mockIpcSendRegistry = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('../bridge-event-bus.js', () => ({ bridgeEventBus: mockBridgeEventBus }))
vi.mock('../ipc-registry.js', () => ({
  ipcInvokeRegistry: mockIpcInvokeRegistry,
  ipcSendRegistry: mockIpcSendRegistry,
}))

async function buildBridgeApp(): Promise<{ app: FastifyInstance; ticketStore: WsTicketStore }> {
  const { registerBridgeRoute } = await import('../routes/bridge.route')
  const ticketStore = new WsTicketStore()
  const app = Fastify({ logger: false })
  await app.register(websocketPlugin)
  await registerBridgeRoute(app, { ticketStore })
  return { app, ticketStore }
}

function waitForClose(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.on('close', resolve)
    ws.on('error', reject)
    setTimeout(() => reject(new Error('timeout waiting for close')), 2000)
  })
}

function waitForMessage(ws: WebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    ws.once('message', (data) => resolve(data.toString()))
    ws.on('error', reject)
    setTimeout(() => reject(new Error('timeout waiting for message')), 2000)
  })
}

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.on('open', resolve)
    ws.on('error', reject)
    setTimeout(() => reject(new Error('timeout waiting for open')), 2000)
  })
}

describe('bridge.route', () => {
  let app: FastifyInstance
  let ticketStore: WsTicketStore
  let baseUrl: string

  beforeEach(async () => {
    vi.resetModules()
    mockBridgeEventBus.on.mockReset()
    mockBridgeEventBus.off.mockReset()
    mockBridgeEventBus.emit.mockReset()
    mockIpcInvokeRegistry.clear()
    mockIpcSendRegistry.clear()
    ;({ app, ticketStore } = await buildBridgeApp())
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
    it('subscribes to a channel on bridgeEventBus', async () => {
      const ticket = ticketStore.createTicket('__bridge__', 'bridge')
      const ws = new WebSocket(`${baseUrl}/api/bridge?ticket=${ticket}`)
      await waitForOpen(ws)

      ws.send(JSON.stringify({ type: 'subscribe', channel: 'terminal:output' }))
      await new Promise((r) => setTimeout(r, 30))

      expect(mockBridgeEventBus.on).toHaveBeenCalledWith('terminal:output', expect.any(Function))
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

      const calls = mockBridgeEventBus.on.mock.calls.filter(([ch]) => ch === 'terminal:output')
      expect(calls.length).toBe(1)
      ws.close()
      await waitForClose(ws)
    })
  })

  describe('invoke messages', () => {
    it('dispatches invoke to ipcInvokeRegistry and sends result back', async () => {
      mockIpcInvokeRegistry.set('workspace:list', async () => [{ id: 'ws-1', name: 'Test' }])

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

    it('sends result: undefined when channel has no handler', async () => {
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

    it('sends error response when handler throws', async () => {
      mockIpcInvokeRegistry.set('workspace:create', async () => {
        throw new Error('validation failed')
      })

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
    it('dispatches fire-and-forget to ipcSendRegistry', async () => {
      const handler = vi.fn()
      mockIpcSendRegistry.set('terminal:input', handler)

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

      expect(handler).toHaveBeenCalledWith(null, { sessionId: 's1', data: 'ls' })
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
    it('forwards bridgeEventBus events to subscribed client', async () => {
      const ticket = ticketStore.createTicket('__bridge__', 'bridge')
      const ws = new WebSocket(`${baseUrl}/api/bridge?ticket=${ticket}`)
      await waitForOpen(ws)
      ws.send(JSON.stringify({ type: 'subscribe', channel: 'terminal:output' }))
      await new Promise((r) => setTimeout(r, 30))

      const [[, forwarder]] = mockBridgeEventBus.on.mock.calls
      forwarder({ sessionId: 's1', data: 'hello' })

      const msg = await waitForMessage(ws)
      const parsed = JSON.parse(msg)
      expect(parsed.type).toBe('event')
      expect(parsed.channel).toBe('terminal:output')
      ws.close()
      await waitForClose(ws)
    })
  })

  describe('close cleanup', () => {
    it('unregisters all channel forwarders on disconnect', async () => {
      const ticket = ticketStore.createTicket('__bridge__', 'bridge')
      const ws = new WebSocket(`${baseUrl}/api/bridge?ticket=${ticket}`)
      await waitForOpen(ws)
      ws.send(JSON.stringify({ type: 'subscribe', channel: 'terminal:output' }))
      await new Promise((r) => setTimeout(r, 30))

      ws.close()
      await waitForClose(ws)
      await new Promise((r) => setTimeout(r, 30))

      expect(mockBridgeEventBus.off).toHaveBeenCalledWith('terminal:output', expect.any(Function))
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
