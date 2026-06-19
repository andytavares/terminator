import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import websocketPlugin from '@fastify/websocket'
import { WebSocket } from 'ws'
import { homedir } from 'os'
import { registerTerminalRoutes } from '../../src/server/routes/terminal.routes'
import { WsTicketStore } from '../../src/server/ws-ticket-store'
import { WsSubscriberManager } from '../../src/server/ws-subscriber-manager'

const mockPtyManager = {
  spawn: vi.fn(() => 'session-id-from-spawn'),
  write: vi.fn(),
  kill: vi.fn(),
  resize: vi.fn(),
  getSessionIds: vi.fn(() => []),
}

let mockTicketStore: WsTicketStore
let mockSubscriberManager: WsSubscriberManager

let app: FastifyInstance
let terminalCleanup: { cleanup: () => void }

beforeEach(async () => {
  vi.resetAllMocks()
  mockTicketStore = new WsTicketStore()
  mockSubscriberManager = new WsSubscriberManager()
  app = Fastify({ logger: false })
  await app.register(websocketPlugin)
  terminalCleanup = await registerTerminalRoutes(app, {
    ptyManager: mockPtyManager as never,
    ticketStore: mockTicketStore,
    subscriberManager: mockSubscriberManager,
    getMaxSubscribers: () => 5,
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

describe('POST /api/terminals', () => {
  it('creates a terminal and returns 201 { sessionId }', async () => {
    mockPtyManager.spawn.mockReturnValueOnce('new-session-id')
    const res = await app.inject({
      method: 'POST',
      url: '/api/terminals',
      payload: { cwd: '/tmp', type: 'human', tabTitle: 'Test' },
    })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    expect(body).toHaveProperty('sessionId')
    expect(typeof body.sessionId).toBe('string')
  })

  it('returns 400 when cwd is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/terminals',
      payload: { type: 'human' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('onData callback broadcasts to subscribers', async () => {
    let capturedOnData: ((data: string) => void) | undefined
    mockPtyManager.spawn.mockImplementationOnce(
      (_id: string, _cwd: string, _shell: string, _type: string, onData: (d: string) => void) => {
        capturedOnData = onData
      }
    )
    const res = await app.inject({
      method: 'POST',
      url: '/api/terminals',
      payload: { cwd: '/tmp', type: 'human', tabTitle: 'Callback Test' },
    })
    expect(res.statusCode).toBe(201)
    const broadcastSpy = vi.spyOn(mockSubscriberManager, 'broadcast')
    capturedOnData?.('some pty output')
    expect(broadcastSpy).toHaveBeenCalledWith(expect.any(String), 'some pty output')
  })

  it('onExit callback destroys session and removes from sessions', async () => {
    let capturedOnExit: (() => void) | undefined
    mockPtyManager.spawn.mockImplementationOnce(
      (
        _id: string,
        _cwd: string,
        _shell: string,
        _type: string,
        _onData: unknown,
        onExit: () => void
      ) => {
        capturedOnExit = onExit
      }
    )
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/terminals',
      payload: { cwd: '/tmp', type: 'human', tabTitle: 'Exit Test' },
    })
    const { sessionId } = JSON.parse(createRes.body)
    const destroySpy = vi.spyOn(mockSubscriberManager, 'destroySession')
    capturedOnExit?.()
    expect(destroySpy).toHaveBeenCalledWith(sessionId)
    // session should be gone now
    const getRes = await app.inject({ method: 'GET', url: `/api/terminals/${sessionId}` })
    expect(getRes.statusCode).toBe(404)
  })
})

describe('GET /api/terminals/:sessionId', () => {
  it('returns 404 for unknown session', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/terminals/nonexistent' })
    expect(res.statusCode).toBe(404)
  })

  it('returns 200 with session data when session exists', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/terminals',
      payload: { cwd: '/tmp', type: 'human', tabTitle: 'Get Test' },
    })
    const { sessionId } = JSON.parse(createRes.body)
    const res = await app.inject({ method: 'GET', url: `/api/terminals/${sessionId}` })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.sessionId).toBe(sessionId)
    expect(body.cwd).toBe('/tmp')
  })
})

describe('DELETE /api/terminals/:sessionId', () => {
  it('kills the PTY and returns 200', async () => {
    mockPtyManager.spawn.mockReturnValueOnce('del-session')
    await app.inject({
      method: 'POST',
      url: '/api/terminals',
      payload: { cwd: '/tmp', type: 'human', tabTitle: 'Test' },
    })
    const sessionId = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/terminals',
          payload: { cwd: '/tmp', type: 'human', tabTitle: 'Test2' },
        })
      ).body
    ).sessionId

    const res = await app.inject({ method: 'DELETE', url: `/api/terminals/${sessionId}` })
    expect(res.statusCode).toBe(200)
  })

  it('returns 404 for unknown session', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/terminals/unknown-id' })
    expect(res.statusCode).toBe(404)
  })
})

describe('POST /api/terminals/:sessionId/resize', () => {
  it('calls ptyManager.resize and returns 200', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/terminals',
      payload: { cwd: '/tmp', type: 'human', tabTitle: 'Resize Test' },
    })
    const { sessionId } = JSON.parse(createRes.body)
    const res = await app.inject({
      method: 'POST',
      url: `/api/terminals/${sessionId}/resize`,
      payload: { cols: 120, rows: 40 },
    })
    expect(res.statusCode).toBe(200)
    expect(mockPtyManager.resize).toHaveBeenCalledWith(sessionId, 120, 40)
  })

  it('returns 400 for invalid cols/rows', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/terminals',
      payload: { cwd: '/tmp', type: 'human', tabTitle: 'Test' },
    })
    const { sessionId } = JSON.parse(createRes.body)
    const res = await app.inject({
      method: 'POST',
      url: `/api/terminals/${sessionId}/resize`,
      payload: { cols: 0, rows: 40 },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 404 for unknown session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/terminals/unknown-id/resize',
      payload: { cols: 80, rows: 24 },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('POST /api/terminals/:sessionId/ws-ticket', () => {
  it('returns 201 with a 64-char hex ticket', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/terminals',
      payload: { cwd: '/tmp', type: 'human', tabTitle: 'Ticket Test' },
    })
    const { sessionId } = JSON.parse(createRes.body)
    const res = await app.inject({
      method: 'POST',
      url: `/api/terminals/${sessionId}/ws-ticket`,
    })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    expect(body.ticket).toMatch(/^[0-9a-f]{64}$/)
  })

  it('returns 404 for unknown session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/terminals/unknown-id/ws-ticket',
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('WS /ws/terminals/:sessionId', () => {
  let wsApp: FastifyInstance
  let baseUrl: string
  let wsTicketStore: WsTicketStore
  let wsSubscriberManager: WsSubscriberManager

  beforeEach(async () => {
    vi.resetAllMocks()
    wsTicketStore = new WsTicketStore()
    wsSubscriberManager = new WsSubscriberManager()
    wsApp = Fastify({ logger: false })
    await wsApp.register(websocketPlugin)
    await registerTerminalRoutes(wsApp, {
      ptyManager: mockPtyManager as never,
      ticketStore: wsTicketStore,
      subscriberManager: wsSubscriberManager,
      getMaxSubscribers: () => 5,
    })
    await wsApp.listen({ port: 0, host: '127.0.0.1' })
    const addr = wsApp.server.address() as { port: number; address: string }
    baseUrl = `ws://${addr.address}:${addr.port}`
  })

  afterEach(async () => {
    await wsApp.close()
  })

  const createSession = async (): Promise<string> => {
    const res = await wsApp.inject({
      method: 'POST',
      url: '/api/terminals',
      payload: { cwd: '/tmp', type: 'human', tabTitle: 'WS Test' },
    })
    return JSON.parse(res.body).sessionId
  }

  it('closes the connection when no ticket is provided', () =>
    new Promise<void>((resolve, reject) => {
      createSession().then((sessionId) => {
        const ws = new WebSocket(`${baseUrl}/ws/terminals/${sessionId}`)
        ws.on('close', () => resolve())
        ws.on('error', () => resolve())
        setTimeout(() => reject(new Error('timeout')), 2000)
      }, reject)
    }))

  it('closes the connection for invalid ticket', () =>
    new Promise<void>((resolve, reject) => {
      createSession().then((sessionId) => {
        const ws = new WebSocket(`${baseUrl}/ws/terminals/${sessionId}?ticket=badticket`)
        ws.on('close', () => resolve())
        ws.on('error', () => resolve())
        setTimeout(() => reject(new Error('timeout')), 2000)
      }, reject)
    }))

  it('closes the connection when ticket is valid but session is gone', () =>
    new Promise<void>((resolve, reject) => {
      createSession().then(async (sessionId) => {
        const ticketRes = await wsApp.inject({
          method: 'POST',
          url: `/api/terminals/${sessionId}/ws-ticket`,
        })
        const { ticket } = JSON.parse(ticketRes.body)
        await wsApp.inject({ method: 'DELETE', url: `/api/terminals/${sessionId}` })
        const ws = new WebSocket(`${baseUrl}/ws/terminals/${sessionId}?ticket=${ticket}`)
        ws.on('close', () => resolve())
        ws.on('error', () => resolve())
        setTimeout(() => reject(new Error('timeout')), 2000)
      }, reject)
    }))

  it('successfully connects, adds subscriber, and cleans up on close', async () => {
    const sessionId = await createSession()
    const ticketRes = await wsApp.inject({
      method: 'POST',
      url: `/api/terminals/${sessionId}/ws-ticket`,
    })
    const { ticket } = JSON.parse(ticketRes.body)

    const addSpy = vi.spyOn(wsSubscriberManager, 'addSubscriber')
    const removeSpy = vi.spyOn(wsSubscriberManager, 'removeSubscriber')

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`${baseUrl}/ws/terminals/${sessionId}?ticket=${ticket}`)
      ws.on('open', () => {
        setTimeout(() => {
          // addSubscriber is called from the server-side handler (async after upgrade)
          expect(addSpy).toHaveBeenCalledWith(sessionId, expect.anything(), expect.any(Number))
          ws.close()
        }, 20)
      })
      ws.on('close', resolve)
      ws.on('error', reject)
    })

    await new Promise<void>((r) => setTimeout(r, 50))
    expect(removeSpy).toHaveBeenCalled()
  })

  it('kills PTY and removes session after grace period when last subscriber disconnects', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const sessionId = await createSession()
    const ticketRes = await wsApp.inject({
      method: 'POST',
      url: `/api/terminals/${sessionId}/ws-ticket`,
    })
    const { ticket } = JSON.parse(ticketRes.body)

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`${baseUrl}/ws/terminals/${sessionId}?ticket=${ticket}`)
      ws.on('open', () => setTimeout(() => ws.close(), 20))
      ws.on('close', resolve)
      ws.on('error', reject)
      setTimeout(() => reject(new Error('timeout')), 2000)
    })

    // Grace period hasn't elapsed — PTY should still be alive
    await new Promise<void>((r) => setTimeout(r, 50))
    expect(mockPtyManager.kill).not.toHaveBeenCalled()

    // Advance past 30-second grace period
    vi.advanceTimersByTime(31_000)
    await Promise.resolve()

    expect(mockPtyManager.kill).toHaveBeenCalledWith(sessionId)
    const getRes = await wsApp.inject({ method: 'GET', url: `/api/terminals/${sessionId}` })
    expect(getRes.statusCode).toBe(404)

    vi.useRealTimers()
  })

  it('forwards messages from primary subscriber to ptyManager', async () => {
    const sessionId = await createSession()
    const ticketRes = await wsApp.inject({
      method: 'POST',
      url: `/api/terminals/${sessionId}/ws-ticket`,
    })
    const { ticket } = JSON.parse(ticketRes.body)

    vi.spyOn(wsSubscriberManager, 'isPrimary').mockReturnValue(true)

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`${baseUrl}/ws/terminals/${sessionId}?ticket=${ticket}`)
      ws.on('open', () => ws.send('hello pty'))
      ws.on('error', reject)
      // Poll for write call since message delivery is async
      let attempts = 0
      const check = setInterval(() => {
        attempts++
        if (mockPtyManager.write.mock.calls.length > 0) {
          clearInterval(check)
          ws.close()
          try {
            expect(mockPtyManager.write).toHaveBeenCalledWith(sessionId, 'hello pty')
            resolve()
          } catch (e) {
            reject(e)
          }
        } else if (attempts >= 40) {
          clearInterval(check)
          ws.close()
          reject(new Error('timeout: ptyManager.write not called'))
        }
      }, 50)
    })
  })
})

describe('cleanup()', () => {
  it('kills all active PTY sessions and clears the session map', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/terminals',
      payload: { cwd: '/tmp', type: 'human', tabTitle: 'Session A' },
    })
    await app.inject({
      method: 'POST',
      url: '/api/terminals',
      payload: { cwd: '/tmp', type: 'human', tabTitle: 'Session B' },
    })
    expect(mockPtyManager.spawn).toHaveBeenCalledTimes(2)

    mockPtyManager.kill.mockClear()
    terminalCleanup.cleanup()

    expect(mockPtyManager.kill).toHaveBeenCalledTimes(2)
  })

  it('is safe to call when there are no active sessions', () => {
    expect(() => terminalCleanup.cleanup()).not.toThrow()
  })
})

describe('tilde expansion in cwd', () => {
  it('expands ~ to the home directory when creating a terminal', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/terminals',
      payload: { cwd: '~/projects', type: 'human', tabTitle: 'Tilde Test' },
    })
    expect(res.statusCode).toBe(201)
    const spawnCall = mockPtyManager.spawn.mock.calls[0]
    expect(spawnCall[1]).toBe(`${homedir()}/projects`)
  })

  it('leaves non-tilde paths unchanged', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/terminals',
      payload: { cwd: '/absolute/path', type: 'human', tabTitle: 'No Tilde' },
    })
    expect(res.statusCode).toBe(201)
    expect(mockPtyManager.spawn.mock.calls[0][1]).toBe('/absolute/path')
  })
})

describe('GET /api/terminals', () => {
  it('returns empty array when no sessions are active', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/terminals' })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual([])
  })

  it('returns all active sessions with sessionId, cwd, and createdAt', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/terminals',
      payload: { cwd: '/tmp/a', type: 'human', tabTitle: 'A' },
    })
    await app.inject({
      method: 'POST',
      url: '/api/terminals',
      payload: { cwd: '/tmp/b', type: 'human', tabTitle: 'B' },
    })
    const res = await app.inject({ method: 'GET', url: '/api/terminals' })
    expect(res.statusCode).toBe(200)
    const sessions = JSON.parse(res.body) as { sessionId: string; cwd: string; createdAt: string }[]
    expect(sessions).toHaveLength(2)
    const cwds = sessions.map((s) => s.cwd).sort()
    expect(cwds).toEqual(['/tmp/a', '/tmp/b'])
    for (const s of sessions) {
      expect(s.sessionId).toBeTruthy()
      expect(s.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    }
  })

  it('excludes sessions that have been deleted', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/terminals',
      payload: { cwd: '/tmp/del', type: 'human', tabTitle: 'Del' },
    })
    const { sessionId } = JSON.parse(createRes.body)
    await app.inject({ method: 'DELETE', url: `/api/terminals/${sessionId}` })
    const res = await app.inject({ method: 'GET', url: '/api/terminals' })
    expect(res.statusCode).toBe(200)
    const sessions = JSON.parse(res.body) as { sessionId: string }[]
    expect(sessions.find((s) => s.sessionId === sessionId)).toBeUndefined()
  })
})
