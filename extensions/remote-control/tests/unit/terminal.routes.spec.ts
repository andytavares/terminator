import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import websocketPlugin from '@fastify/websocket'
import { WebSocket } from 'ws'
import { homedir } from 'os'
import { registerTerminalRoutes } from '../../src/server/routes/terminal.routes'
import { WsTicketStore } from '../../src/server/ws-ticket-store'
import { WsSubscriberManager } from '../../src/server/ws-subscriber-manager'
import { createFakePtyManager, type FakePtyManager } from './helpers/fake-pty-manager'

let ptyManager: FakePtyManager
let ticketStore: WsTicketStore
let subscriberManager: WsSubscriberManager
let app: FastifyInstance
let routes: { cleanup: () => void }

beforeEach(async () => {
  vi.clearAllMocks()
  ptyManager = createFakePtyManager()
  ticketStore = new WsTicketStore()
  subscriberManager = new WsSubscriberManager()
  app = Fastify({ logger: false })
  await app.register(websocketPlugin)
  routes = await registerTerminalRoutes(app, {
    ptyManager: ptyManager as never,
    ticketStore,
    subscriberManager,
    getMaxSubscribers: () => 5,
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

async function createSession(payload: Record<string, unknown> = {}): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/terminals',
    payload: { cwd: '/tmp', type: 'human', ...payload },
  })
  return JSON.parse(res.body).sessionId
}

describe('POST /api/terminals', () => {
  it('creates a remote-origin session and returns 201 { sessionId }', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/terminals',
      payload: { cwd: '/tmp', type: 'human' },
    })
    expect(res.statusCode).toBe(201)
    const { sessionId } = JSON.parse(res.body)
    expect(sessionId).toBeTruthy()
    expect(ptyManager.spawnSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId, cwd: '/tmp', type: 'human', origin: 'remote' })
    )
  })

  it('returns 400 for an invalid payload', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/terminals', payload: { cwd: '' } })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).error).toBe('VALIDATION_ERROR')
  })

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
})

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
    ptyManager.setWorkspace('app-1', 'ws-1')
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
    expect(ptyManager.getSession('app-owned')).toBeDefined()
  })

  it('returns 404 for unknown session', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/terminals/nope' })
    expect(res.statusCode).toBe(404)
  })
})

describe('POST /api/terminals/:sessionId/resize', () => {
  it('calls ptyManager.resize and returns 200', async () => {
    const sessionId = await createSession()
    const res = await app.inject({
      method: 'POST',
      url: `/api/terminals/${sessionId}/resize`,
      payload: { cols: 120, rows: 40 },
    })
    expect(res.statusCode).toBe(200)
    expect(ptyManager.resize).toHaveBeenCalledWith(sessionId, 120, 40)
  })

  it('resizes an app-origin session the Electron app created', async () => {
    ptyManager.addSession({ sessionId: 'app-resize', origin: 'app' })
    const res = await app.inject({
      method: 'POST',
      url: '/api/terminals/app-resize/resize',
      payload: { cols: 80, rows: 24 },
    })
    expect(res.statusCode).toBe(200)
    expect(ptyManager.resize).toHaveBeenCalledWith('app-resize', 80, 24)
  })

  it('returns 400 for invalid cols/rows', async () => {
    const sessionId = await createSession()
    const res = await app.inject({
      method: 'POST',
      url: `/api/terminals/${sessionId}/resize`,
      payload: { cols: -1, rows: 0 },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 404 for unknown session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/terminals/nope/resize',
      payload: { cols: 80, rows: 24 },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('PATCH /api/terminals/:sessionId', () => {
  it('assigns a workspaceId and returns 200', async () => {
    const sessionId = await createSession()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/terminals/${sessionId}`,
      payload: { workspaceId: 'ws-42' },
    })
    expect(res.statusCode).toBe(200)
    expect(ptyManager.getSession(sessionId)?.workspaceId).toBe('ws-42')
  })

  it('clears the workspaceId when null is sent', async () => {
    const sessionId = await createSession()
    ptyManager.setWorkspace(sessionId, 'ws-42')
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/terminals/${sessionId}`,
      payload: { workspaceId: null },
    })
    expect(res.statusCode).toBe(200)
    expect(ptyManager.getSession(sessionId)?.workspaceId).toBeUndefined()
  })

  it('assigns workspaceId to an app-origin session', async () => {
    ptyManager.addSession({ sessionId: 'app-ws', origin: 'app' })
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/terminals/app-ws',
      payload: { workspaceId: 'ws-7' },
    })
    expect(res.statusCode).toBe(200)
    expect(ptyManager.getSession('app-ws')?.workspaceId).toBe('ws-7')
  })

  it('returns 404 for unknown session', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/terminals/nope',
      payload: { workspaceId: 'ws-1' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('returns 400 for an invalid payload', async () => {
    const sessionId = await createSession()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/terminals/${sessionId}`,
      payload: { workspaceId: 42 },
    })
    expect(res.statusCode).toBe(400)
  })
})

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

describe('WS /ws/terminals/:sessionId', () => {
  let baseUrl: string

  beforeEach(async () => {
    await app.listen({ port: 0, host: '127.0.0.1' })
    const addr = app.server.address() as { port: number; address: string }
    baseUrl = `ws://${addr.address}:${addr.port}`
  })

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
      setTimeout(() => reject(new Error('timeout')), 2000)
    })
  }

  function connectExpectClose(sessionId: string, ticket?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const qs = ticket ? `?ticket=${ticket}` : ''
      const ws = new WebSocket(`${baseUrl}/ws/terminals/${sessionId}${qs}`)
      ws.on('close', () => resolve())
      ws.on('error', () => resolve())
      setTimeout(() => reject(new Error('timeout')), 2000)
    })
  }

  function closed(ws: WebSocket): Promise<void> {
    return new Promise((resolve) => {
      ws.on('close', () => resolve())
      ws.close()
    })
  }

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

  it('connects, adds a subscriber, and removes it on close', async () => {
    const sessionId = await createSession()
    const ws = await connect(sessionId, await ticketFor(sessionId))
    expect(subscriberManager.getCount(sessionId)).toBe(1)
    await closed(ws)
    await vi.waitFor(() => expect(subscriberManager.getCount(sessionId)).toBe(0))
  })

  it('forwards messages from the primary subscriber to ptyManager.write', async () => {
    const sessionId = await createSession()
    const ws = await connect(sessionId, await ticketFor(sessionId))
    ws.send('ls -la\n')
    await vi.waitFor(() => expect(ptyManager.write).toHaveBeenCalledWith(sessionId, 'ls -la\n'))
    await closed(ws)
  })

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

  it('rejects the subscriber over the limit but keeps the session intact', async () => {
    const sessionId = await createSession()
    vi.spyOn(subscriberManager, 'addSubscriber').mockReturnValueOnce(false)
    await connect(sessionId, await ticketFor(sessionId))
    expect(ptyManager.getSession(sessionId)).toBeDefined()
    expect(ptyManager.kill).not.toHaveBeenCalled()
  })

  it('kills a remote-origin session after the grace period when the last subscriber leaves', async () => {
    const sessionId = await createSession()
    const ws = await connect(sessionId, await ticketFor(sessionId))
    // Freeze the clock (while letting real async continue) so the 30s teardown
    // timer lands on fake timers and can be advanced deterministically.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      await closed(ws)
      await vi.waitFor(() => expect(subscriberManager.getCount(sessionId)).toBe(0), {
        timeout: 2000,
      })
      vi.advanceTimersByTime(30_000)
      expect(ptyManager.kill).toHaveBeenCalledWith(sessionId)
    } finally {
      vi.useRealTimers()
    }
  })

  it('never kills an app-origin session when the grace period expires', async () => {
    ptyManager.addSession({ sessionId: 'app-grace', origin: 'app' })
    const ws = await connect('app-grace', await ticketFor('app-grace'))
    vi.useFakeTimers()
    try {
      const closePromise = closed(ws)
      await vi.waitFor(() => expect(subscriberManager.getCount('app-grace')).toBe(0), {
        timeout: 2000,
      })
      await closePromise
      vi.advanceTimersByTime(30_000)
      expect(ptyManager.kill).not.toHaveBeenCalled()
      expect(ptyManager.getSession('app-grace')).toBeDefined()
    } finally {
      vi.useRealTimers()
    }
  })

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
})

describe('cleanup()', () => {
  it('kills remote-origin sessions and spares app-origin ones', async () => {
    const remoteId = await createSession()
    ptyManager.addSession({ sessionId: 'app-keep', origin: 'app' })
    routes.cleanup()
    expect(ptyManager.kill).toHaveBeenCalledWith(remoteId)
    expect(ptyManager.kill).not.toHaveBeenCalledWith('app-keep')
    expect(ptyManager.getSession('app-keep')).toBeDefined()
  })

  it('destroys subscriber state for streamed sessions', async () => {
    const sessionId = await createSession()
    const destroy = vi.spyOn(subscriberManager, 'destroySession')
    routes.cleanup()
    expect(destroy).toHaveBeenCalledWith(sessionId)
  })
})
