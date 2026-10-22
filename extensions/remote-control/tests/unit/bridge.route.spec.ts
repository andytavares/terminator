import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import type { ExtensionAPI } from '@terminator/extension-sdk'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import websocketPlugin from '@fastify/websocket'
import { WebSocket } from 'ws'
import { WsTicketStore } from '../../src/server/ws-ticket-store'
import { eventually } from '../../../../tests/support/eventually'

type BridgeIpc = ExtensionAPI['ipc']

let mockInvokeChannel: Mock<BridgeIpc['invokeChannel']>
let mockSendChannel: Mock<BridgeIpc['sendChannel']>
let mockOnWindowEvent: Mock<BridgeIpc['onWindowEvent']>
let mockIsRemoteAccessible: Mock<BridgeIpc['isRemoteAccessible']>

function waitForClose(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) {
      resolve()
      return
    }
    // terminate() on the server causes ECONNRESET (error) on the client before or
    // instead of a clean close frame — resolve on either, not reject on error
    ws.once('close', resolve)
    ws.once('error', resolve)
  })
}

function waitForMessage(ws: WebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    ws.once('message', (data) => resolve(data.toString()))
    ws.on('error', reject)
  })
}

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.on('open', resolve)
    ws.on('error', reject)
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
    isRemoteAccessible: mockIsRemoteAccessible,
  })
  return { app, ticketStore, bridgeCleanup }
}

const SETTLE_CHANNEL = 'bridge:settle'

/** The server answers one socket's messages in order: its reply to this request means it has acted
 * on every message sent before it, however little those would have replied. */
async function settleBridge(ws: WebSocket): Promise<void> {
  await requestOverBridge(ws, { type: 'invoke', id: 'settle', channel: SETTLE_CHANNEL })
}

async function openBridge(): Promise<WebSocket> {
  const ticket = ticketStore.createTicket('__bridge__', 'bridge')
  const ws = new WebSocket(`${baseUrl}/api/bridge?ticket=${ticket}`)
  await waitForOpen(ws)
  return ws
}

/** Send one message and parse the reply. */
async function requestOverBridge(ws: WebSocket, message: object): Promise<Record<string, unknown>> {
  ws.send(JSON.stringify(message))
  return JSON.parse(await waitForMessage(ws))
}

function invokeOverBridge(
  ws: WebSocket,
  request: { id: string; channel: string; args?: unknown[] }
) {
  return requestOverBridge(ws, { type: 'invoke', ...request })
}

async function closeBridge(ws: WebSocket): Promise<void> {
  ws.close()
  await waitForClose(ws)
}

let app: FastifyInstance
let ticketStore: WsTicketStore
let bridgeCleanup: { disconnectAll: () => void }
let baseUrl: string

describe('bridge.route', bridgeRouteTests)

function bridgeRouteTests() {
  beforeEach(async () => {
    vi.resetModules()
    mockInvokeChannel = vi.fn<BridgeIpc['invokeChannel']>().mockResolvedValue(undefined)
    mockSendChannel = vi.fn<BridgeIpc['sendChannel']>()
    mockOnWindowEvent = vi.fn<BridgeIpc['onWindowEvent']>().mockReturnValue(vi.fn())
    mockIsRemoteAccessible = vi.fn<BridgeIpc['isRemoteAccessible']>().mockResolvedValue(true)
    ;({ app, ticketStore, bridgeCleanup } = await buildBridgeApp())
    await app.listen({ port: 0, host: '127.0.0.1' })
    const addr = app.server.address() as { port: number; address: string }
    baseUrl = `ws://${addr.address}:${addr.port}`
  })

  afterEach(async () => {
    await app.close()
  })

  describe('POST /api/bridge-ticket', bridgeTicketEndpointTests)
  describe('authentication', bridgeAuthenticationTests)
  describe('subscribe messages', bridgeSubscribeTests)
  describe('invoke messages', bridgeInvokeTests)
  describe('send messages', bridgeSendTests)
  describe('event forwarding', bridgeEventForwardingTests)
  describe('disconnectAll()', bridgeDisconnectAllTests)
  describe('close cleanup', bridgeCloseCleanupTests)
  describe('ticket purpose scoping', bridgeTicketPurposeTests)
  describe('invalid messages', bridgeInvalidMessageTests)
  describe('remote-access allowlist', bridgeAllowlistTests)
}

function bridgeTicketEndpointTests() {
  it('returns 201 with a ticket string', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/bridge-ticket' })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body) as { ticket: string }
    expect(typeof body.ticket).toBe('string')
    expect(body.ticket.length).toBeGreaterThan(0)
  })
}

function bridgeAuthenticationTests() {
  it('closes connection when no ticket provided', async () => {
    const ws = new WebSocket(`${baseUrl}/api/bridge`)
    await waitForClose(ws)
  })

  it('closes connection when invalid ticket provided', async () => {
    const ws = new WebSocket(`${baseUrl}/api/bridge?ticket=invalid-ticket`)
    await waitForClose(ws)
  })

  it('accepts connection with a valid ticket', async () => {
    const ws = await openBridge()
    await closeBridge(ws)
  })

  it('rejects a ticket that has already been consumed', async () => {
    const ticket = ticketStore.createTicket('__bridge__', 'bridge')
    ticketStore.consumeTicket(ticket, 'bridge')
    const ws = new WebSocket(`${baseUrl}/api/bridge?ticket=${ticket}`)
    await waitForClose(ws)
  })
}

function bridgeSubscribeTests() {
  it('subscribes to a channel via onWindowEvent', async () => {
    const ws = await openBridge()

    ws.send(JSON.stringify({ type: 'subscribe', channel: 'terminal:output' }))
    await eventually(() =>
      expect(mockOnWindowEvent).toHaveBeenCalledWith('terminal:output', expect.any(Function))
    )
    await closeBridge(ws)
  })

  it('does not double-subscribe to the same channel', async () => {
    const ws = await openBridge()

    ws.send(JSON.stringify({ type: 'subscribe', channel: 'terminal:output' }))
    ws.send(JSON.stringify({ type: 'subscribe', channel: 'terminal:output' }))
    await settleBridge(ws)

    const calls = mockOnWindowEvent.mock.calls.filter(([ch]) => ch === 'terminal:output')
    expect(calls.length).toBe(1)
    await closeBridge(ws)
  })
}

function bridgeInvokeTests() {
  describe('with a result', bridgeInvokeResultTests)
  describe('with an empty or failed result', bridgeInvokeEdgeTests)
}

function bridgeInvokeResultTests() {
  it('dispatches invoke to invokeChannel and sends result back', async () => {
    mockInvokeChannel.mockImplementation(async (ch: string) => {
      if (ch === 'workspace:list') return [{ id: 'ws-1', name: 'Test' }]
    })

    const ws = await openBridge()
    const parsed = await invokeOverBridge(ws, { id: 'r1', channel: 'workspace:list', args: [{}] })

    expect(parsed.type).toBe('result')
    expect(parsed.id).toBe('r1')
    expect(parsed.result).toEqual([{ id: 'ws-1', name: 'Test' }])
    await closeBridge(ws)
  })

  it('defaults to {} when an invoke message omits args', async () => {
    mockInvokeChannel.mockResolvedValue('ok')

    const ws = await openBridge()
    const parsed = await invokeOverBridge(ws, { id: 'r0', channel: 'workspace:list' })

    expect(parsed.type).toBe('result')
    expect(parsed.id).toBe('r0')
    expect(mockInvokeChannel).toHaveBeenCalledWith('workspace:list', {})
    await closeBridge(ws)
  })
}

function bridgeInvokeEdgeTests() {
  it('sends result: undefined when invokeChannel returns undefined', async () => {
    mockInvokeChannel.mockResolvedValue(undefined)

    const ws = await openBridge()
    const parsed = await invokeOverBridge(ws, { id: 'r2', channel: 'nonexistent', args: [{}] })

    expect(parsed.type).toBe('result')
    expect(parsed.id).toBe('r2')
    await closeBridge(ws)
  })

  it('sends error response when invokeChannel throws', async () => {
    mockInvokeChannel.mockRejectedValue(new Error('validation failed'))

    const ws = await openBridge()
    const parsed = await invokeOverBridge(ws, { id: 'r3', channel: 'workspace:create', args: [{}] })

    expect(parsed.type).toBe('error')
    expect(parsed.id).toBe('r3')
    expect(parsed.error).toContain('validation failed')
    await closeBridge(ws)
  })
}

function bridgeSendTests() {
  describe('dispatching', bridgeSendDispatchTests)
  describe('missing args and unknown channels', bridgeSendEdgeTests)
}

function bridgeSendDispatchTests() {
  it('dispatches fire-and-forget via sendChannel', async () => {
    const ws = await openBridge()
    ws.send(
      JSON.stringify({
        type: 'send',
        channel: 'terminal:input',
        args: [{ sessionId: 's1', data: 'ls' }],
      })
    )
    await eventually(() =>
      expect(mockSendChannel).toHaveBeenCalledWith('terminal:input', {
        sessionId: 's1',
        data: 'ls',
      })
    )
    await closeBridge(ws)
  })
}

function bridgeSendEdgeTests() {
  it('defaults to {} when a send message omits args', async () => {
    const ws = await openBridge()
    ws.send(JSON.stringify({ type: 'send', channel: 'terminal:input' }))
    await eventually(() => expect(mockSendChannel).toHaveBeenCalledWith('terminal:input', {}))
    await closeBridge(ws)
  })

  it('ignores send for unknown channel (no crash)', async () => {
    const ws = await openBridge()
    ws.send(JSON.stringify({ type: 'send', channel: 'no:handler', args: [{}] }))
    await settleBridge(ws)
    await closeBridge(ws)
  })
}

function bridgeEventForwardingTests() {
  it('forwards onWindowEvent events to subscribed client', async () => {
    const ws = await openBridge()
    ws.send(JSON.stringify({ type: 'subscribe', channel: 'terminal:output' }))
    await eventually(() => expect(mockOnWindowEvent).toHaveBeenCalled())

    const [[, forwarder]] = mockOnWindowEvent.mock.calls as [[string, (...a: unknown[]) => void]]
    forwarder({ sessionId: 's1', data: 'hello' })

    const parsed = JSON.parse(await waitForMessage(ws))
    expect(parsed.type).toBe('event')
    expect(parsed.channel).toBe('terminal:output')
    await closeBridge(ws)
  })
}

function bridgeDisconnectAllTests() {
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
  })

  it('is safe to call when no connections are open', () => {
    expect(() => bridgeCleanup.disconnectAll()).not.toThrow()
  })
}

function bridgeCloseCleanupTests() {
  it('calls the unsub function returned by onWindowEvent on disconnect', async () => {
    const unsub = vi.fn()
    mockOnWindowEvent.mockReturnValue(unsub)

    const ws = await openBridge()
    ws.send(JSON.stringify({ type: 'subscribe', channel: 'terminal:output' }))
    await eventually(() => expect(mockOnWindowEvent).toHaveBeenCalled())

    await closeBridge(ws)

    await eventually(() => expect(unsub).toHaveBeenCalled())
  })
}

function bridgeTicketPurposeTests() {
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
}

function bridgeInvalidMessageTests() {
  it('ignores non-JSON messages without crashing', async () => {
    const ws = await openBridge()
    ws.send('not json at all')
    await settleBridge(ws)
    await closeBridge(ws)
  })

  it('ignores a message without a channel, and an invoke without an id', async () => {
    const ws = await openBridge()
    ws.send(JSON.stringify({ type: 'invoke', id: 'r1' }))
    ws.send(JSON.stringify({ type: 'invoke', channel: 'workspace:list' }))
    ws.send(JSON.stringify({ type: 'subscribe' }))
    await settleBridge(ws)
    // Only the settling request got through the allowlist and to the main process.
    expect(mockIsRemoteAccessible.mock.calls.map(([channel]) => channel)).toEqual([SETTLE_CHANNEL])
    expect(mockInvokeChannel.mock.calls.map(([channel]) => channel)).toEqual([SETTLE_CHANNEL])
    await closeBridge(ws)
  })
}

function bridgeAllowlistTests() {
  describe('denying invoke', bridgeAllowlistInvokeDenyTests)
  describe('allowing invoke', bridgeAllowlistInvokeAllowTests)
  describe('denying subscribe and send', bridgeAllowlistDenyTests)
  describe('allowing subscribe and send', bridgeAllowlistAllowTests)
}

function bridgeAllowlistInvokeDenyTests() {
  it('rejects invoke for a non-allowlisted channel with type:error', async () => {
    mockIsRemoteAccessible.mockResolvedValue(false)

    const ws = await openBridge()
    const parsed = await invokeOverBridge(ws, {
      id: 'sec1',
      channel: 'dialog:open-directory',
      args: [{}],
    })

    expect(parsed.type).toBe('error')
    expect(parsed.id).toBe('sec1')
    expect(parsed.error).toBe('channel not remote-accessible')
    expect(mockInvokeChannel).not.toHaveBeenCalled()
    await closeBridge(ws)
  })
}

function bridgeAllowlistInvokeAllowTests() {
  it('executes handler for an allowlisted channel', async () => {
    mockIsRemoteAccessible.mockImplementation(async (ch: string) => ch === 'terminal:create')
    mockInvokeChannel.mockResolvedValue({ sessionId: 's1' })

    const ws = await openBridge()
    const parsed = await invokeOverBridge(ws, {
      id: 'sec2',
      channel: 'terminal:create',
      args: [{}],
    })

    expect(parsed.type).toBe('result')
    expect(parsed.id).toBe('sec2')
    expect(mockInvokeChannel).toHaveBeenCalledWith('terminal:create', {})
    await closeBridge(ws)
  })
}

function bridgeAllowlistDenyTests() {
  it('rejects subscribe and send for non-allowlisted channels (default-deny)', async () => {
    mockIsRemoteAccessible.mockResolvedValue(false)

    const ws = await openBridge()

    ws.send(JSON.stringify({ type: 'subscribe', channel: 'terminal:output' }))
    ws.send(JSON.stringify({ type: 'send', channel: 'terminal:input', args: [{}] }))
    await settleBridge(ws)

    expect(mockOnWindowEvent).not.toHaveBeenCalled()
    expect(mockSendChannel).not.toHaveBeenCalled()
    await closeBridge(ws)
  })
}

function bridgeAllowlistAllowTests() {
  it('allows subscribe and send for allowlisted channels', async () => {
    mockIsRemoteAccessible.mockImplementation(async (ch: string) =>
      ['terminal:output', 'terminal:input'].includes(ch)
    )

    const ws = await openBridge()

    ws.send(JSON.stringify({ type: 'subscribe', channel: 'terminal:output' }))
    ws.send(JSON.stringify({ type: 'send', channel: 'terminal:input', args: [{}] }))
    await settleBridge(ws)

    expect(mockOnWindowEvent).toHaveBeenCalledWith('terminal:output', expect.any(Function))
    expect(mockSendChannel).toHaveBeenCalledWith('terminal:input', {})
    await closeBridge(ws)
  })
}
