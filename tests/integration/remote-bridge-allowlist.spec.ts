import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import websocketPlugin from '@fastify/websocket'
import { WebSocket } from 'ws'
import { registerBridgeRoute } from '../../extensions/remote-control/src/server/routes/bridge.route'
import { WsTicketStore } from '../../extensions/remote-control/src/server/ws-ticket-store'
import { REMOTE_ACCESSIBLE_CHANNELS } from '../../src/main/remote/remote-accessible-channels'

// Integration test for the regression that took down the browser `/app/` surface:
// the bridge default-deny enforcement shipped, but the allowlist was empty, so every
// IPC invoke was rejected. This wires the REAL bridge route to the REAL allowlist set
// (isRemoteAccessible is the exact one-liner api.ts uses) and a registry of real
// handlers, then drives a real WebSocket bridge client end-to-end:
//   - an allowlisted channel's handler runs and returns its result
//   - a non-allowlisted channel is rejected before its handler is ever called
// If the allowlist were empty again, the first assertion would fail loudly.

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.on('open', resolve)
    ws.on('error', reject)
    setTimeout(() => reject(new Error('timeout waiting for open')), 8000)
  })
}

function waitForMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    ws.once('message', (data) => resolve(JSON.parse(data.toString())))
    ws.on('error', reject)
    setTimeout(() => reject(new Error('timeout waiting for message')), 8000)
  })
}

describe('remote bridge allowlist (integration: real route + real allowlist)', () => {
  let app: FastifyInstance
  let ticketStore: WsTicketStore
  let baseUrl: string
  let dialogHandler: ReturnType<typeof vi.fn>

  // A real registry of IPC handlers, keyed by channel — the same shape index.ts builds.
  const registry = new Map<string, (event: never, payload: unknown) => unknown>()

  beforeEach(async () => {
    registry.clear()
    registry.set('workspace:list', () => [{ id: 'ws-1', name: 'Alpha' }])
    dialogHandler = vi.fn(() => ({ picked: '/secret/path' }))
    registry.set('dialog:open-directory', dialogHandler as never)

    ticketStore = new WsTicketStore()
    app = Fastify({ logger: false })
    await app.register(websocketPlugin)
    await registerBridgeRoute(app, {
      ticketStore,
      // Real invoke semantics: look the handler up in the registry and call it.
      invokeChannel: async (channel, payload) => registry.get(channel)?.(null as never, payload),
      sendChannel: () => {},
      onWindowEvent: () => () => {},
      // Exactly what api.ipc.isRemoteAccessible does in production.
      isRemoteAccessible: (channel) => REMOTE_ACCESSIBLE_CHANNELS.has(channel),
    })
    await app.listen({ port: 0, host: '127.0.0.1' })
    const addr = app.server.address() as { port: number; address: string }
    baseUrl = `ws://${addr.address}:${addr.port}`
  })

  afterEach(async () => {
    await app.close()
  })

  it('documents the allowlist intent for the two channels under test', () => {
    expect(REMOTE_ACCESSIBLE_CHANNELS.has('workspace:list')).toBe(true)
    expect(REMOTE_ACCESSIBLE_CHANNELS.has('dialog:open-directory')).toBe(false)
  })

  it('invokes an allowlisted channel end-to-end and returns its handler result', async () => {
    const ticket = ticketStore.createTicket('__bridge__', 'bridge')
    const ws = new WebSocket(`${baseUrl}/api/bridge?ticket=${ticket}`)
    await waitForOpen(ws)
    ws.send(JSON.stringify({ type: 'invoke', id: 'q1', channel: 'workspace:list', args: [{}] }))

    const msg = await waitForMessage(ws)
    expect(msg.type).toBe('result')
    expect(msg.id).toBe('q1')
    expect(msg.result).toEqual([{ id: 'ws-1', name: 'Alpha' }])
    ws.close()
  })

  it('rejects a non-allowlisted channel without ever calling its handler', async () => {
    const ticket = ticketStore.createTicket('__bridge__', 'bridge')
    const ws = new WebSocket(`${baseUrl}/api/bridge?ticket=${ticket}`)
    await waitForOpen(ws)
    ws.send(
      JSON.stringify({ type: 'invoke', id: 'q2', channel: 'dialog:open-directory', args: [{}] })
    )

    const msg = await waitForMessage(ws)
    expect(msg.type).toBe('error')
    expect(msg.id).toBe('q2')
    expect(msg.error).toBe('channel not remote-accessible')
    expect(dialogHandler).not.toHaveBeenCalled()
    ws.close()
  })
})
