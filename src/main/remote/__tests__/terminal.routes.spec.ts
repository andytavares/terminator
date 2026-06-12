import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import websocketPlugin from '@fastify/websocket'
import { WebSocket } from 'ws'
import { registerTerminalRoutes } from '../routes/terminal.routes'
import { WsTicketStore } from '../ws-ticket-store'
import { WsSubscriberManager } from '../ws-subscriber-manager'

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

beforeEach(async () => {
  vi.resetAllMocks()
  mockTicketStore = new WsTicketStore()
  mockSubscriberManager = new WsSubscriberManager()
  app = Fastify({ logger: false })
  await app.register(websocketPlugin)
  await registerTerminalRoutes(app, {
    ptyManager: mockPtyManager as never,
    ticketStore: mockTicketStore,
    subscriberManager: mockSubscriberManager,
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

  it('returns 400 for missing required fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/terminals',
      payload: { cwd: '/tmp' },
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
          expect(addSpy).toHaveBeenCalledWith(sessionId, expect.anything())
          ws.close()
        }, 20)
      })
      ws.on('close', resolve)
      ws.on('error', reject)
    })

    await new Promise<void>((r) => setTimeout(r, 50))
    expect(removeSpy).toHaveBeenCalled()
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
