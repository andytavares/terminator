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
import { partialFake } from '../../../../packages/test-support/src/fakes'

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

/** An open viewer socket on `sessionId`, held by the real subscriber manager. */
function fakeViewer(sessionId: string) {
  const viewer = { readyState: WebSocket.OPEN, send: vi.fn(), close: vi.fn() }
  subscriberManager.addSubscriber(sessionId, partialFake<WebSocket>(viewer), 5)
  return viewer
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

describe('cleanup()', () => {
  it('kills remote-origin sessions and spares app-origin ones', async () => {
    const remoteId = await createSession()
    ptyManager.addSession({ sessionId: 'app-keep', origin: 'app' })
    await routes.cleanup()
    expect(ptyManager.kill).toHaveBeenCalledWith(remoteId)
    expect(ptyManager.kill).not.toHaveBeenCalledWith('app-keep')
    expect(await ptyManager.getSession('app-keep')).toBeDefined()
  })

  it('closes the viewers of streamed sessions', async () => {
    const sessionId = await createSession()
    const viewer = fakeViewer(sessionId)
    await routes.cleanup()
    expect(viewer.close).toHaveBeenCalledWith(1000, 'session destroyed')
    expect(subscriberManager.getCount(sessionId)).toBe(0)
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
  it('sends the PTY output to its viewers', async () => {
    const sessionId = await createSession()
    const viewer = fakeViewer(sessionId)
    ptyManager.emitData(sessionId, 'hello from pty')
    expect(viewer.send).toHaveBeenCalledWith('hello from pty')
  })

  it('closes its viewers when the PTY exits', async () => {
    const sessionId = await createSession()
    const viewer = fakeViewer(sessionId)
    ptyManager.emitExit(sessionId)
    expect(viewer.close).toHaveBeenCalledWith(1000, 'session destroyed')
    expect(subscriberManager.getCount(sessionId)).toBe(0)
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
