import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import websocketPlugin from '@fastify/websocket'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import { registerBridgeRoute } from '../../extensions/remote-control/src/server/routes/bridge.route'
import { WsTicketStore } from '../../extensions/remote-control/src/server/ws-ticket-store'
import { REMOTE_ACCESSIBLE_CHANNELS } from '../../packages/core-main/src/remote/remote-accessible-channels'

// Integration test for the regression that took down the browser `/app/` surface:
// the bridge default-deny enforcement shipped, but the allowlist was empty, so every
// IPC invoke was rejected. This wires the REAL bridge route to the REAL allowlist set
// (isRemoteAccessible is the exact one-liner api.ts uses) and a registry of real
// handlers, then drives a real WebSocket bridge client end-to-end: an allowlisted
// channel's handler runs and returns its result. The refusal of a channel off the
// list is in packages/core-main/tests/unit/extensions/api-v1.2.0.spec.ts and bridge.route.spec.ts.

async function waitForMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  const [data] = await once(ws, 'message')
  return JSON.parse(data.toString())
}

let app: FastifyInstance
let ticketStore: WsTicketStore
let baseUrl: string

// A real registry of IPC handlers, keyed by channel — the same shape index.ts builds.
const registry = new Map<string, (event: never, payload: unknown) => unknown>()

function useBridgeServer(): void {
  beforeEach(async () => {
    registry.clear()
    registry.set('workspace:list', () => [{ id: 'ws-1', name: 'Alpha' }])

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
      isRemoteAccessible: async (channel) => REMOTE_ACCESSIBLE_CHANNELS.has(channel),
    })
    await app.listen({ port: 0, host: '127.0.0.1' })
    const addr = app.server.address() as { port: number; address: string }
    baseUrl = `ws://${addr.address}:${addr.port}`
  })

  afterEach(async () => {
    await app.close()
  })
}

describe('remote bridge allowlist (integration: real route + real allowlist)', () => {
  useBridgeServer()

  it('invokes an allowlisted channel end-to-end and returns its handler result', async () => {
    const ticket = ticketStore.createTicket('__bridge__', 'bridge')
    const ws = new WebSocket(`${baseUrl}/api/bridge?ticket=${ticket}`)
    await once(ws, 'open')
    ws.send(JSON.stringify({ type: 'invoke', id: 'q1', channel: 'workspace:list', args: [{}] }))

    const msg = await waitForMessage(ws)
    expect(msg.type).toBe('result')
    expect(msg.id).toBe('q1')
    expect(msg.result).toEqual([{ id: 'ws-1', name: 'Alpha' }])
    const closed = once(ws, 'close')
    ws.close()
    await closed
  })
})
