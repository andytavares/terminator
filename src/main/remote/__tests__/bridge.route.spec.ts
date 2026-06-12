import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import websocketPlugin from '@fastify/websocket'
import { WebSocket } from 'ws'
import bcryptjs from 'bcryptjs'

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

async function buildBridgeApp(passwordHash: string): Promise<FastifyInstance> {
  const { registerBridgeRoute } = await import('../routes/bridge.route')
  const app = Fastify({ logger: false })
  await app.register(websocketPlugin)
  await registerBridgeRoute(app, { getPasswordHash: () => passwordHash })
  return app
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
  let baseUrl: string
  let hash: string

  beforeEach(async () => {
    vi.resetModules()
    mockBridgeEventBus.on.mockReset()
    mockBridgeEventBus.off.mockReset()
    mockBridgeEventBus.emit.mockReset()
    mockIpcInvokeRegistry.clear()
    mockIpcSendRegistry.clear()

    hash = await bcryptjs.hash('secret', 4)
    app = await buildBridgeApp(hash)
    await app.listen({ port: 0, host: '127.0.0.1' })
    const addr = app.server.address() as { port: number; address: string }
    baseUrl = `ws://${addr.address}:${addr.port}`
  })

  afterEach(async () => {
    await app.close()
  })

  describe('authentication', () => {
    it('closes connection when no token provided', async () => {
      const ws = new WebSocket(`${baseUrl}/api/bridge`)
      await waitForClose(ws)
    })

    it('closes connection when wrong token provided', async () => {
      const ws = new WebSocket(`${baseUrl}/api/bridge?token=wrong`)
      await waitForClose(ws)
    })

    it('closes connection when hash is empty', async () => {
      await app.close()
      app = await buildBridgeApp('')
      await app.listen({ port: 0, host: '127.0.0.1' })
      const addr = app.server.address() as { port: number; address: string }
      const url = `ws://${addr.address}:${addr.port}`
      const ws = new WebSocket(`${url}/api/bridge?token=anything`)
      await waitForClose(ws)
    })

    it('accepts connection with correct token', async () => {
      const ws = new WebSocket(`${baseUrl}/api/bridge?token=secret`)
      await waitForOpen(ws)
      ws.close()
      await waitForClose(ws)
    })
  })

  describe('subscribe messages', () => {
    it('subscribes to a channel on bridgeEventBus', async () => {
      const ws = new WebSocket(`${baseUrl}/api/bridge?token=secret`)
      await waitForOpen(ws)

      ws.send(JSON.stringify({ type: 'subscribe', channel: 'terminal:output' }))
      await new Promise((r) => setTimeout(r, 30))

      expect(mockBridgeEventBus.on).toHaveBeenCalledWith('terminal:output', expect.any(Function))
      ws.close()
      await waitForClose(ws)
    })

    it('does not double-subscribe to the same channel', async () => {
      const ws = new WebSocket(`${baseUrl}/api/bridge?token=secret`)
      await waitForOpen(ws)

      ws.send(JSON.stringify({ type: 'subscribe', channel: 'terminal:output' }))
      ws.send(JSON.stringify({ type: 'subscribe', channel: 'terminal:output' }))
      await new Promise((r) => setTimeout(r, 30))

      // Should only subscribe once
      const calls = mockBridgeEventBus.on.mock.calls.filter(([ch]) => ch === 'terminal:output')
      expect(calls.length).toBe(1)
      ws.close()
      await waitForClose(ws)
    })
  })

  describe('invoke messages', () => {
    it('dispatches invoke to ipcInvokeRegistry and sends result back', async () => {
      mockIpcInvokeRegistry.set('workspace:list', async () => [{ id: 'ws-1', name: 'Test' }])

      const ws = new WebSocket(`${baseUrl}/api/bridge?token=secret`)
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
      const ws = new WebSocket(`${baseUrl}/api/bridge?token=secret`)
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

      const ws = new WebSocket(`${baseUrl}/api/bridge?token=secret`)
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

      const ws = new WebSocket(`${baseUrl}/api/bridge?token=secret`)
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
      const ws = new WebSocket(`${baseUrl}/api/bridge?token=secret`)
      await waitForOpen(ws)
      ws.send(JSON.stringify({ type: 'send', channel: 'no:handler', args: [{}] }))
      await new Promise((r) => setTimeout(r, 30))
      ws.close()
      await waitForClose(ws)
    })
  })

  describe('event forwarding', () => {
    it('forwards bridgeEventBus events to subscribed client', async () => {
      const ws = new WebSocket(`${baseUrl}/api/bridge?token=secret`)
      await waitForOpen(ws)
      ws.send(JSON.stringify({ type: 'subscribe', channel: 'terminal:output' }))
      await new Promise((r) => setTimeout(r, 30))

      // Capture the forwarder function registered with bridgeEventBus.on
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
      const ws = new WebSocket(`${baseUrl}/api/bridge?token=secret`)
      await waitForOpen(ws)
      ws.send(JSON.stringify({ type: 'subscribe', channel: 'terminal:output' }))
      await new Promise((r) => setTimeout(r, 30))

      ws.close()
      await waitForClose(ws)
      await new Promise((r) => setTimeout(r, 30))

      expect(mockBridgeEventBus.off).toHaveBeenCalledWith('terminal:output', expect.any(Function))
    })
  })

  describe('invalid messages', () => {
    it('ignores non-JSON messages without crashing', async () => {
      const ws = new WebSocket(`${baseUrl}/api/bridge?token=secret`)
      await waitForOpen(ws)
      ws.send('not json at all')
      await new Promise((r) => setTimeout(r, 30))
      // No crash — connection stays open
      ws.close()
      await waitForClose(ws)
    })
  })
})
