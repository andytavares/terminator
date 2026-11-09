import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import websocketPlugin from '@fastify/websocket'
import { WebSocket } from 'ws'
import { registerTerminalRoutes } from '../../src/server/routes/terminal.routes'
import { WsTicketStore } from '../../src/server/ws-ticket-store'
import { WsSubscriberManager } from '../../src/server/ws-subscriber-manager'
import { ConnectedDeviceRegistry } from '../../src/server/connected-devices'
import { HEARTBEAT_INTERVAL_MS } from '../../src/server/heartbeat'
import { createFakePtyManager, type FakePtyManager } from '../unit/helpers/fake-pty-manager'
import { eventually } from '../../../../packages/test-support/src/eventually'

let ptyManager: FakePtyManager
let ticketStore: WsTicketStore
let subscriberManager: WsSubscriberManager
let app: FastifyInstance
let routes: { cleanup: () => Promise<void> }
let deviceRegistry: ConnectedDeviceRegistry
let maxSubscribers: number

beforeEach(async () => {
  vi.clearAllMocks()
  maxSubscribers = 5
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
    getMaxSubscribers: () => maxSubscribers,
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

let baseUrl: string

async function ticketFor(sessionId: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: `/api/terminals/${sessionId}/ws-ticket` })
  return JSON.parse(res.body).ticket
}

function connectWithoutPong(sessionId: string, ticket: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${baseUrl}/ws/terminals/${sessionId}?ticket=${ticket}`)
    ws.pong = () => {} // never answers the server's pings
    ws.on('open', () => resolve(ws))
    ws.on('error', reject)
  })
}

function connect(sessionId: string, ticket?: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const qs = ticket ? `?ticket=${ticket}` : ''
    const ws = new WebSocket(`${baseUrl}/ws/terminals/${sessionId}${qs}`)
    ws.on('open', () => resolve(ws))
    ws.on('error', reject)
  })
}

async function expectConnectionClosed(sessionId: string, ticket?: string): Promise<void> {
  const qs = ticket ? `?ticket=${ticket}` : ''
  const ws = new WebSocket(`${baseUrl}/ws/terminals/${sessionId}${qs}`)
  await new Promise<void>((resolve) => {
    ws.on('close', () => resolve())
    ws.on('error', () => resolve())
  })
  expect(ws.readyState).not.toBe(WebSocket.OPEN)
}

function closed(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    ws.on('close', () => resolve())
    ws.close()
  })
}

describe('WS /ws/terminals/:sessionId', terminalSocketTests)

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
  describe('heartbeat', terminalSocketHeartbeatTests)
  describe('route cleanup', terminalSocketCleanupTests)
  describe('native PTY exit', terminalSocketPtyExitTests)
}

function terminalSocketAdmissionTests() {
  it('closes the connection when no ticket is provided', async () => {
    const sessionId = await createSession()
    await expectConnectionClosed(sessionId)
  })

  it('closes the connection for an invalid ticket', async () => {
    const sessionId = await createSession()
    await expectConnectionClosed(sessionId, 'badticket')
  })

  it('closes the connection when the ticket is valid but the session is gone', async () => {
    const sessionId = await createSession()
    const ticket = await ticketFor(sessionId)
    ptyManager.emitExit(sessionId)
    await expectConnectionClosed(sessionId, ticket)
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
  it('streams an app-origin session to the first client that connects', async () => {
    ptyManager.addSession({ sessionId: 'app-stream', origin: 'app' })
    const ws = await connect('app-stream', await ticketFor('app-stream'))
    const received = new Promise<string>((resolve) => ws.once('message', (d) => resolve(String(d))))
    ptyManager.emitData('app-stream', 'native output')
    expect(await received).toBe('native output')
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
    maxSubscribers = 0
    const ws = await connect('app-full', await ticketFor('app-full'))
    const closeCode = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)))
    expect(await closeCode).toBe(4003)
    expect(await ptyManager.getSession('app-full')).toBeDefined()
    expect(ptyManager.kill).not.toHaveBeenCalled()
    expect(ptyManager.dataListenerCount('app-full')).toBe(0)
  })

  it('does not stack exit listeners across DELETE and reconnect on an app session', async () => {
    ptyManager.addSession({ sessionId: 'app-redel', origin: 'app' })
    const ws = await connect('app-redel', await ticketFor('app-redel'))
    await app.inject({ method: 'DELETE', url: '/api/terminals/app-redel' })
    const ws2 = await connect('app-redel', await ticketFor('app-redel'))
    expect(ptyManager.exitListenerCount('app-redel')).toBe(1)
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
    const sessionId = await createSession()
    const first = await connect(sessionId, await ticketFor(sessionId))
    // Faked before the close, so the 30s teardown timer lands on the fake clock.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      await closed(first)
      await eventually(() => expect(subscriberManager.getCount(sessionId)).toBe(0))
      const second = await connect(sessionId, await ticketFor(sessionId))
      await vi.advanceTimersByTimeAsync(20_000)
      // The second leave starts a new 30s window; the first one's timer would fire 10s from now.
      await closed(second)
      await eventually(() => expect(subscriberManager.getCount(sessionId)).toBe(0))
      await vi.advanceTimersByTimeAsync(15_000)
      expect(ptyManager.kill).not.toHaveBeenCalled()
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

function terminalSocketHeartbeatTests() {
  it('terminates a client that stops answering pings and frees its viewer slot', async () => {
    const sessionId = await createSession()
    // Faked before connecting, so the heartbeat's interval lands on the fake clock.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try {
      const ws = await connectWithoutPong(sessionId, await ticketFor(sessionId))
      const wsClosed = new Promise<void>((resolve) => ws.on('close', () => resolve()))
      await eventually(() => expect(subscriberManager.getCount(sessionId)).toBe(1))
      // Interval 1 pings, interval 2 finds no pong and terminates.
      await vi.advanceTimersByTimeAsync(2 * HEARTBEAT_INTERVAL_MS)
      await wsClosed
      await eventually(() => expect(subscriberManager.getCount(sessionId)).toBe(0))
      await eventually(() => expect(deviceRegistry.count()).toBe(0))
    } finally {
      vi.useRealTimers()
    }
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
      // A session under the same id that the dropped timer would kill if it still fired.
      ptyManager.addSession({ sessionId, origin: 'remote' })
      await vi.advanceTimersByTimeAsync(30_000)
      expect(await ptyManager.getSession(sessionId)).toMatchObject({ sessionId })
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
    const closeCode = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)))
    ptyManager.emitExit('app-exit')
    expect(await closeCode).toBe(1000)
    // A later session with the same id gets a fresh broadcast attached
    ptyManager.addSession({ sessionId: 'app-exit', origin: 'app' })
    const ws2 = await connect('app-exit', await ticketFor('app-exit'))
    expect(ptyManager.dataListenerCount('app-exit')).toBe(1)
    await closed(ws2)
  })
}
