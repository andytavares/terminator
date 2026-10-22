import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import websocketPlugin from '@fastify/websocket'
import { WebSocket } from 'ws'
import { homedir } from 'os'
import { registerTerminalRoutes } from '../../src/server/routes/terminal.routes'
import { WsTicketStore } from '../../src/server/ws-ticket-store'
import { WsSubscriberManager } from '../../src/server/ws-subscriber-manager'
import { ConnectedDeviceRegistry } from '../../src/server/connected-devices'
import { createFakePtyManager, type FakePtyManager } from './helpers/fake-pty-manager'
import { eventually } from '../../../../tests/support/eventually'

let ptyManager: FakePtyManager
let ticketStore: WsTicketStore
let subscriberManager: WsSubscriberManager
let app: FastifyInstance
let routes: { cleanup: () => Promise<void> }
let deviceRegistry: ConnectedDeviceRegistry

beforeEach(async () => {
  vi.clearAllMocks()
  ptyManager = createFakePtyManager()
  ticketStore = new WsTicketStore()
  subscriberManager = new WsSubscriberManager()
  deviceRegistry = new ConnectedDeviceRegistry()
  app = Fastify({ logger: false })
  await app.register(websocketPlugin)
  routes = await registerTerminalRoutes(app, {
    ptyManager: ptyManager as never,
    ticketStore,
    subscriberManager,
    deviceRegistry,
    getMaxSubscribers: () => 5,
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

async function createSession(payload: Record<string, unknown> = {}): Promise<string> {
  const res = await injectTerminalRoute('POST', '/api/terminals', {
    cwd: '/tmp',
    type: 'human',
    ...payload,
  })
  return JSON.parse(res.body).sessionId
}

function injectTerminalRoute(method: 'POST' | 'PATCH', url: string, payload: unknown) {
  return app.inject({ method, url, payload: payload as Record<string, unknown> })
}

describe('POST /api/terminals', createTerminalRouteTests)

describe('tilde expansion in cwd', () => {
  it('expands ~ to the home directory when creating a terminal', async () => {
    await createSession({ cwd: '~/projects' })
    expect(ptyManager.spawnSession).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: `${homedir()}/projects` })
    )
  })

  it('leaves non-tilde paths unchanged', async () => {
    await createSession({ cwd: '/var/data' })
    expect(ptyManager.spawnSession).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: '/var/data' })
    )
  })
})

describe('GET /api/terminals', () => {
  it('returns every live session with sessionId, cwd, createdAt, workspaceId', async () => {
    const remoteId = await createSession()
    ptyManager.addSession({ sessionId: 'app-1', cwd: '/native', origin: 'app' })
    await ptyManager.setWorkspace('app-1', 'ws-1')
    const res = await app.inject({ method: 'GET', url: '/api/terminals' })
    const body = JSON.parse(res.body) as Array<Record<string, unknown>>
    expect(body).toHaveLength(2)
    const ids = body.map((s) => s.sessionId)
    expect(ids).toContain(remoteId)
    expect(ids).toContain('app-1')
    const appSession = body.find((s) => s.sessionId === 'app-1')!
    expect(appSession.cwd).toBe('/native')
    expect(appSession.workspaceId).toBe('ws-1')
    expect(appSession.createdAt).toBeTruthy()
  })
})

describe('GET /api/terminals/:sessionId', () => {
  it('returns 404 for unknown session', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/terminals/nope' })
    expect(res.statusCode).toBe(404)
  })

  it('returns 200 with session data and subscriberCount', async () => {
    const sessionId = await createSession()
    const res = await app.inject({ method: 'GET', url: `/api/terminals/${sessionId}` })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.sessionId).toBe(sessionId)
    expect(body.cwd).toBe('/tmp')
    expect(body.subscriberCount).toBe(0)
  })
})

describe('DELETE /api/terminals/:sessionId', () => {
  it('kills a remote-origin session and returns 200', async () => {
    const sessionId = await createSession()
    const res = await app.inject({ method: 'DELETE', url: `/api/terminals/${sessionId}` })
    expect(res.statusCode).toBe(200)
    expect(ptyManager.kill).toHaveBeenCalledWith(sessionId)
  })

  it('does NOT kill an app-origin session — it only stops streaming it', async () => {
    ptyManager.addSession({ sessionId: 'app-owned', origin: 'app' })
    const res = await app.inject({ method: 'DELETE', url: '/api/terminals/app-owned' })
    expect(res.statusCode).toBe(200)
    expect(ptyManager.kill).not.toHaveBeenCalled()
    expect(await ptyManager.getSession('app-owned')).toBeDefined()
  })

  it('returns 404 for unknown session', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/terminals/nope' })
    expect(res.statusCode).toBe(404)
  })
})

describe('POST /api/terminals/:sessionId/resize', resizeRouteTests)
describe('PATCH /api/terminals/:sessionId', assignWorkspaceRouteTests)

describe('POST /api/terminals/:sessionId/ws-ticket', () => {
  it('returns 201 with a 64-char hex ticket', async () => {
    const sessionId = await createSession()
    const res = await app.inject({ method: 'POST', url: `/api/terminals/${sessionId}/ws-ticket` })
    expect(res.statusCode).toBe(201)
    const { ticket } = JSON.parse(res.body)
    expect(ticket).toMatch(/^[0-9a-f]{64}$/)
  })

  it('returns 201 for an app-origin session', async () => {
    ptyManager.addSession({ sessionId: 'app-tkt', origin: 'app' })
    const res = await app.inject({ method: 'POST', url: '/api/terminals/app-tkt/ws-ticket' })
    expect(res.statusCode).toBe(201)
  })

  it('returns 404 for unknown session', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/terminals/nope/ws-ticket' })
    expect(res.statusCode).toBe(404)
  })
})

let baseUrl: string

async function ticketFor(sessionId: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: `/api/terminals/${sessionId}/ws-ticket` })
  return JSON.parse(res.body).ticket
}

function connect(sessionId: string, ticket?: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const qs = ticket ? `?ticket=${ticket}` : ''
    const ws = new WebSocket(`${baseUrl}/ws/terminals/${sessionId}${qs}`)
    ws.on('open', () => resolve(ws))
    ws.on('error', reject)
  })
}

function connectExpectClose(sessionId: string, ticket?: string): Promise<void> {
  return new Promise((resolve) => {
    const qs = ticket ? `?ticket=${ticket}` : ''
    const ws = new WebSocket(`${baseUrl}/ws/terminals/${sessionId}${qs}`)
    ws.on('close', () => resolve())
    ws.on('error', () => resolve())
  })
}

function closed(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    ws.on('close', () => resolve())
    ws.close()
  })
}

describe('WS /ws/terminals/:sessionId', terminalSocketTests)

describe('cleanup()', () => {
  it('kills remote-origin sessions and spares app-origin ones', async () => {
    const remoteId = await createSession()
    ptyManager.addSession({ sessionId: 'app-keep', origin: 'app' })
    await routes.cleanup()
    expect(ptyManager.kill).toHaveBeenCalledWith(remoteId)
    expect(ptyManager.kill).not.toHaveBeenCalledWith('app-keep')
    expect(await ptyManager.getSession('app-keep')).toBeDefined()
  })

  it('destroys subscriber state for streamed sessions', async () => {
    const sessionId = await createSession()
    const destroy = vi.spyOn(subscriberManager, 'destroySession')
    await routes.cleanup()
    expect(destroy).toHaveBeenCalledWith(sessionId)
  })
})

function createTerminalRouteTests() {
  describe('spawning the session', createTerminalSpawnTests)
  describe('rejecting a request it cannot serve', createTerminalRejectionTests)
  describe('streaming the new session', createTerminalStreamingTests)
}

function createTerminalSpawnTests() {
  it('creates a remote-origin session and returns 201 { sessionId }', async () => {
    const res = await injectTerminalRoute('POST', '/api/terminals', { cwd: '/tmp', type: 'human' })
    expect(res.statusCode).toBe(201)
    const { sessionId } = JSON.parse(res.body)
    expect(sessionId).toBeTruthy()
    expect(ptyManager.spawnSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId, cwd: '/tmp', type: 'human', origin: 'remote' })
    )
  })

  it('returns 400 CWD_MISSING, naming the folder, when the cwd is gone', async () => {
    ptyManager.spawnSession.mockImplementationOnce(() => {
      const err = new Error('That folder no longer exists: /gone')
      err.name = 'MissingCwdError'
      throw err
    })

    const res = await injectTerminalRoute('POST', '/api/terminals', { cwd: '/gone', type: 'human' })

    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.body)
    expect(body.error).toBe('CWD_MISSING')
    expect(body.message).toContain('/gone')
  })
}

function createTerminalRejectionTests() {
  it('answers 500 when the session cannot be spawned for another reason', async () => {
    ptyManager.spawnSession.mockRejectedValueOnce(new Error('pty exhausted'))
    const res = await injectTerminalRoute('POST', '/api/terminals', { cwd: '/tmp', type: 'human' })
    expect(res.statusCode).toBe(500)
  })

  it('returns 400 for an invalid payload', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/terminals', payload: { cwd: '' } })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).error).toBe('VALIDATION_ERROR')
  })
}

function createTerminalStreamingTests() {
  it('attaches an output broadcast that reaches subscribers', async () => {
    const sessionId = await createSession()
    const broadcast = vi.spyOn(subscriberManager, 'broadcast')
    ptyManager.emitData(sessionId, 'hello from pty')
    expect(broadcast).toHaveBeenCalledWith(sessionId, 'hello from pty')
  })

  it('destroys subscribers when the PTY exits', async () => {
    const sessionId = await createSession()
    const destroy = vi.spyOn(subscriberManager, 'destroySession')
    ptyManager.emitExit(sessionId)
    expect(destroy).toHaveBeenCalledWith(sessionId)
  })
}

function resizeRouteTests() {
  describe('resizing a known session', resizeKnownSessionTests)
  describe('rejecting a bad resize', resizeRejectionTests)
}

function resizeKnownSessionTests() {
  it('calls ptyManager.resize and returns 200', async () => {
    const sessionId = await createSession()
    const res = await injectTerminalRoute('POST', `/api/terminals/${sessionId}/resize`, {
      cols: 120,
      rows: 40,
    })
    expect(res.statusCode).toBe(200)
    expect(ptyManager.resize).toHaveBeenCalledWith(sessionId, 120, 40)
  })

  it('resizes an app-origin session the Electron app created', async () => {
    ptyManager.addSession({ sessionId: 'app-resize', origin: 'app' })
    const res = await injectTerminalRoute('POST', '/api/terminals/app-resize/resize', {
      cols: 80,
      rows: 24,
    })
    expect(res.statusCode).toBe(200)
    expect(ptyManager.resize).toHaveBeenCalledWith('app-resize', 80, 24)
  })
}

function resizeRejectionTests() {
  it('returns 400 for invalid cols/rows', async () => {
    const sessionId = await createSession()
    const res = await injectTerminalRoute('POST', `/api/terminals/${sessionId}/resize`, {
      cols: -1,
      rows: 0,
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 404 for unknown session', async () => {
    const res = await injectTerminalRoute('POST', '/api/terminals/nope/resize', {
      cols: 80,
      rows: 24,
    })
    expect(res.statusCode).toBe(404)
  })
}

function assignWorkspaceRouteTests() {
  describe('assigning and clearing', assignWorkspaceRemoteTests)
  describe('app sessions and bad requests', assignWorkspaceEdgeTests)
}

function assignWorkspaceRemoteTests() {
  it('assigns a workspaceId and returns 200', async () => {
    const sessionId = await createSession()
    const res = await injectTerminalRoute('PATCH', `/api/terminals/${sessionId}`, {
      workspaceId: 'ws-42',
    })
    expect(res.statusCode).toBe(200)
    expect((await ptyManager.getSession(sessionId))?.workspaceId).toBe('ws-42')
  })

  it('clears the workspaceId when null is sent', async () => {
    const sessionId = await createSession()
    await ptyManager.setWorkspace(sessionId, 'ws-42')
    const res = await injectTerminalRoute('PATCH', `/api/terminals/${sessionId}`, {
      workspaceId: null,
    })
    expect(res.statusCode).toBe(200)
    expect((await ptyManager.getSession(sessionId))?.workspaceId).toBeUndefined()
  })
}

function assignWorkspaceEdgeTests() {
  it('assigns workspaceId to an app-origin session', async () => {
    ptyManager.addSession({ sessionId: 'app-ws', origin: 'app' })
    const res = await injectTerminalRoute('PATCH', '/api/terminals/app-ws', { workspaceId: 'ws-7' })
    expect(res.statusCode).toBe(200)
    expect((await ptyManager.getSession('app-ws'))?.workspaceId).toBe('ws-7')
  })

  it('returns 404 for unknown session', async () => {
    const res = await injectTerminalRoute('PATCH', '/api/terminals/nope', { workspaceId: 'ws-1' })
    expect(res.statusCode).toBe(404)
  })

  it('returns 400 for an invalid payload', async () => {
    const sessionId = await createSession()
    const res = await injectTerminalRoute('PATCH', `/api/terminals/${sessionId}`, {
      workspaceId: 42,
    })
    expect(res.statusCode).toBe(400)
  })
}

function terminalSocketTests() {
  beforeEach(async () => {
    await app.listen({ port: 0, host: '127.0.0.1' })
    const addr = app.server.address() as { port: number; address: string }
    baseUrl = `ws://${addr.address}:${addr.port}`
  })

  describe('admission', terminalSocketAdmissionTests)
  describe('subscribing', terminalSocketSubscribeTests)
  describe('output broadcast', terminalSocketBroadcastTests)
  describe('listener bookkeeping', terminalSocketListenerTests)
  describe('grace-period teardown of a remote session', terminalSocketRemoteTeardownTests)
  describe('grace-period teardown of an app session', terminalSocketAppTeardownTests)
  describe('reconnecting in time', terminalSocketReconnectTests)
  describe('connected devices', terminalSocketDeviceTests)
  describe('route cleanup', terminalSocketCleanupTests)
  describe('native PTY exit', terminalSocketPtyExitTests)
}

function terminalSocketAdmissionTests() {
  it('closes the connection when no ticket is provided', async () => {
    const sessionId = await createSession()
    await connectExpectClose(sessionId)
  })

  it('closes the connection for an invalid ticket', async () => {
    const sessionId = await createSession()
    await connectExpectClose(sessionId, 'badticket')
  })

  it('closes the connection when the ticket is valid but the session is gone', async () => {
    const sessionId = await createSession()
    const ticket = await ticketFor(sessionId)
    ptyManager.emitExit(sessionId)
    await connectExpectClose(sessionId, ticket)
  })
}

function terminalSocketSubscribeTests() {
  it('connects, adds a subscriber, and removes it on close', async () => {
    const sessionId = await createSession()
    const ws = await connect(sessionId, await ticketFor(sessionId))
    expect(subscriberManager.getCount(sessionId)).toBe(1)
    await closed(ws)
    await eventually(() => expect(subscriberManager.getCount(sessionId)).toBe(0))
  })

  it('forwards messages from the primary subscriber to ptyManager.write', async () => {
    const sessionId = await createSession()
    const ws = await connect(sessionId, await ticketFor(sessionId))
    ws.send('ls -la\n')
    await eventually(() => expect(ptyManager.write).toHaveBeenCalledWith(sessionId, 'ls -la\n'))
    await closed(ws)
  })
}

function terminalSocketBroadcastTests() {
  it('attaches the output broadcast on first connect to an app-origin session', async () => {
    ptyManager.addSession({ sessionId: 'app-stream', origin: 'app' })
    const ws = await connect('app-stream', await ticketFor('app-stream'))
    expect(ptyManager.onData).toHaveBeenCalledWith('app-stream', expect.any(Function))
    const broadcast = vi.spyOn(subscriberManager, 'broadcast')
    ptyManager.emitData('app-stream', 'native output')
    expect(broadcast).toHaveBeenCalledWith('app-stream', 'native output')
    await closed(ws)
  })

  it('does not stack broadcast listeners across reconnects', async () => {
    const sessionId = await createSession()
    const first = await connect(sessionId, await ticketFor(sessionId))
    await closed(first)
    const second = await connect(sessionId, await ticketFor(sessionId))
    expect(ptyManager.dataListenerCount(sessionId)).toBe(1)
    await closed(second)
  })
}

function terminalSocketListenerTests() {
  it('rejects the subscriber over the limit without attaching a broadcast listener', async () => {
    // App-owned session: POST hasn't attached a broadcast, so a rejected first
    // viewer must leave zero listeners behind (the pre-refactor rollback guarantee).
    ptyManager.addSession({ sessionId: 'app-full', origin: 'app' })
    vi.spyOn(subscriberManager, 'addSubscriber').mockReturnValueOnce(false)
    await connect('app-full', await ticketFor('app-full'))
    expect(await ptyManager.getSession('app-full')).toBeDefined()
    expect(ptyManager.kill).not.toHaveBeenCalled()
    expect(ptyManager.dataListenerCount('app-full')).toBe(0)
  })

  it('does not stack exit listeners across DELETE and reconnect on an app session', async () => {
    ptyManager.addSession({ sessionId: 'app-redel', origin: 'app' })
    const ws = await connect('app-redel', await ticketFor('app-redel'))
    await app.inject({ method: 'DELETE', url: '/api/terminals/app-redel' })
    const ws2 = await connect('app-redel', await ticketFor('app-redel'))
    const destroy = vi.spyOn(subscriberManager, 'destroySession')
    ptyManager.emitExit('app-redel')
    // One live broadcast means exactly one exit-driven teardown
    expect(destroy).toHaveBeenCalledTimes(1)
    await closed(ws2)
    ws.terminate()
  })
}

function terminalSocketRemoteTeardownTests() {
  it('kills a remote-origin session after the grace period when the last subscriber leaves', async () => {
    const sessionId = await createSession()
    const ws = await connect(sessionId, await ticketFor(sessionId))
    // Freeze the clock (while letting real async continue) so the 30s teardown
    // timer lands on fake timers and can be advanced deterministically.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      await closed(ws)
      await eventually(() => expect(subscriberManager.getCount(sessionId)).toBe(0))
      await vi.advanceTimersByTimeAsync(30_000)
      expect(ptyManager.kill).toHaveBeenCalledWith(sessionId)
    } finally {
      vi.useRealTimers()
    }
  })
}

function terminalSocketAppTeardownTests() {
  it('never kills an app-origin session when the grace period expires', async () => {
    ptyManager.addSession({ sessionId: 'app-grace', origin: 'app' })
    const ws = await connect('app-grace', await ticketFor('app-grace'))
    vi.useFakeTimers()
    try {
      const closePromise = closed(ws)
      await eventually(() => expect(subscriberManager.getCount('app-grace')).toBe(0))
      await closePromise
      await vi.advanceTimersByTimeAsync(30_000)
      expect(ptyManager.kill).not.toHaveBeenCalled()
      expect(await ptyManager.getSession('app-grace')).toBeDefined()
    } finally {
      vi.useRealTimers()
    }
  })
}

function terminalSocketReconnectTests() {
  it('cancels the grace-period teardown when a client reconnects in time', async () => {
    vi.useFakeTimers()
    try {
      vi.useRealTimers()
      const sessionId = await createSession()
      const first = await connect(sessionId, await ticketFor(sessionId))
      await closed(first)
      // Reconnect before the 30s window expires
      const second = await connect(sessionId, await ticketFor(sessionId))
      vi.useFakeTimers()
      vi.advanceTimersByTime(31_000)
      expect(ptyManager.kill).not.toHaveBeenCalled()
      vi.useRealTimers()
      await closed(second)
    } finally {
      vi.useRealTimers()
    }
  })
}

function terminalSocketDeviceTests() {
  it('lists the connected device, and disconnecting it closes the socket', async () => {
    const sessionId = await createSession()
    const ws = await connect(sessionId, await ticketFor(sessionId))
    const wsClosed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)))
    const [device] = deviceRegistry.list()
    expect(device.viewing).toBe(sessionId)
    expect(deviceRegistry.disconnect(device.id)).toBe(true)
    expect(await wsClosed).toBe(4004)
    await eventually(() => expect(deviceRegistry.count()).toBe(0))
  })
}

function terminalSocketCleanupTests() {
  it('drops a pending grace-period teardown when the routes are cleaned up', async () => {
    const sessionId = await createSession()
    const ws = await connect(sessionId, await ticketFor(sessionId))
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      await closed(ws)
      await eventually(() => expect(subscriberManager.getCount(sessionId)).toBe(0))
      await routes.cleanup()
      const lookups = ptyManager.getSession.mock.calls.length
      await vi.advanceTimersByTimeAsync(30_000)
      expect(ptyManager.getSession).toHaveBeenCalledTimes(lookups)
    } finally {
      vi.useRealTimers()
    }
  })
}

function terminalSocketPtyExitTests() {
  it('cleans up broadcast bookkeeping when the native PTY exits', async () => {
    ptyManager.addSession({ sessionId: 'app-exit', origin: 'app' })
    const ws = await connect('app-exit', await ticketFor('app-exit'))
    // destroySession closes the socket, so track its close instead of initiating one
    const wsClosed = new Promise<void>((resolve) => ws.on('close', () => resolve()))
    const destroy = vi.spyOn(subscriberManager, 'destroySession')
    ptyManager.emitExit('app-exit')
    expect(destroy).toHaveBeenCalledWith('app-exit')
    await wsClosed
    // A later session with the same id gets a fresh broadcast attached
    ptyManager.addSession({ sessionId: 'app-exit', origin: 'app' })
    const ws2 = await connect('app-exit', await ticketFor('app-exit'))
    expect(ptyManager.dataListenerCount('app-exit')).toBe(1)
    await closed(ws2)
  })
}
