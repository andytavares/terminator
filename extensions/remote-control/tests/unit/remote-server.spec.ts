import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'fs'

vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn().mockResolvedValue('$2a$10$mocked'),
    compare: vi.fn().mockResolvedValue(true),
  },
}))

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return { ...actual, readFileSync: vi.fn(actual.readFileSync), existsSync: vi.fn(() => false) }
})

vi.mock('electron', () => ({
  app: { getAppPath: vi.fn(() => '/mock/app') },
}))

const mockTicketStore = vi.hoisted(() => ({
  createTicket: vi.fn(() => 'a'.repeat(64)),
  consumeTicket: vi.fn(() => null as string | null),
  startCleanup: vi.fn(),
  stopCleanup: vi.fn(),
}))

vi.mock('../../src/server/ws-ticket-store', () => ({
  WsTicketStore: vi.fn().mockImplementation(() => mockTicketStore),
}))

const mockSubscriberManager = vi.hoisted(() => ({
  addSubscriber: vi.fn(),
  removeSubscriber: vi.fn(),
  broadcast: vi.fn(),
  destroySession: vi.fn(),
  destroyAll: vi.fn(),
  isPrimary: vi.fn(),
  getPrimary: vi.fn(),
  getCount: vi.fn(() => 0),
}))

vi.mock('../../src/server/ws-subscriber-manager', () => ({
  WsSubscriberManager: vi.fn(() => mockSubscriberManager),
}))

describe('RemoteServer', () => {
  let remoteServer: Awaited<
    ReturnType<typeof import('../../src/server/remote-server').createRemoteServer>
  >

  const mockPtyManager = {
    spawn: vi.fn(),
    write: vi.fn(),
    kill: vi.fn(),
    resize: vi.fn(),
    getSessionIds: vi.fn(() => []),
  }

  const mockOnPortInUse = vi.fn()

  const mockDeps = {
    getPasswordHash: vi.fn(() => '$2a$10$test'),
    getMaxSubscribers: vi.fn(() => 5),
    listWorkspaces: vi.fn(() => []),
    listProjects: vi.fn(() => []),
    invokeChannel: vi.fn().mockResolvedValue(undefined),
    sendChannel: vi.fn(),
    onWindowEvent: vi.fn().mockReturnValue(vi.fn()),
    onPortInUse: mockOnPortInUse,
  }

  beforeEach(async () => {
    const { createRemoteServer } = await import('../../src/server/remote-server')
    remoteServer = await createRemoteServer({
      port: 7683,
      ptyManager: mockPtyManager as never,
      deps: mockDeps,
    })
    await remoteServer.start()
  })

  afterEach(async () => {
    await remoteServer.stop()
    vi.resetModules()
    vi.clearAllMocks()
  })

  describe('health route', () => {
    it('GET /health returns 200 { ok: true }', async () => {
      const response = await remoteServer.inject({ method: 'GET', url: '/health' })
      expect(response.statusCode).toBe(200)
      expect(JSON.parse(response.body)).toEqual({ ok: true })
    })
  })

  describe('start/stop lifecycle', () => {
    it('server is listening after start()', () => {
      expect(remoteServer.isListening()).toBe(true)
    })

    it('stop() closes the server', async () => {
      await remoteServer.stop()
      expect(remoteServer.isListening()).toBe(false)
    })

    it('double stop() is safe', async () => {
      await remoteServer.stop()
      await expect(remoteServer.stop()).resolves.not.toThrow()
    })

    it('disconnectAllClients() calls subscriberManager.destroyAll', () => {
      remoteServer.disconnectAllClients()
      expect(mockSubscriberManager.destroyAll).toHaveBeenCalled()
    })

    it('disconnectAllClients() kills remote PTY sessions', async () => {
      mockSubscriberManager.addSubscriber.mockReturnValueOnce(true)
      const body = JSON.stringify({ cwd: '/tmp', type: 'human', tabTitle: 'test' })
      const createRes = await remoteServer.inject({
        method: 'POST',
        url: '/api/terminals',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer anypassword',
        },
        body,
      })
      expect(createRes.statusCode).toBe(201)
      const { sessionId } = JSON.parse(createRes.body) as { sessionId: string }

      remoteServer.disconnectAllClients()
      expect(mockPtyManager.kill).toHaveBeenCalledWith(sessionId)
    })
  })

  describe('GET /app/', () => {
    it('redirects to / when no ticket is provided', async () => {
      const response = await remoteServer.inject({ method: 'GET', url: '/app/' })
      expect(response.statusCode).toBe(302)
      expect(response.headers.location).toBe('/')
    })

    it('redirects to / when consumeTicket returns null (invalid/expired ticket)', async () => {
      mockTicketStore.consumeTicket.mockReturnValueOnce(null)
      const response = await remoteServer.inject({ method: 'GET', url: '/app/?t=bogus' })
      expect(response.statusCode).toBe(302)
      expect(response.headers.location).toBe('/')
    })

    it('returns injected HTML and sets session cookie when ticket is valid', async () => {
      vi.mocked(readFileSync).mockReturnValueOnce('<html><head></head></html>')
      mockTicketStore.consumeTicket.mockReturnValueOnce('__app__')
      const response = await remoteServer.inject({ method: 'GET', url: '/app/?t=valid-ticket' })
      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toContain('text/html')
      expect(response.body).toContain('remote-shim.js')
      const setCookie = response.headers['set-cookie'] as string | string[]
      const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : (setCookie ?? '')
      expect(cookieStr).toContain('app-session=')
      expect(cookieStr).toContain('HttpOnly')
    })

    it('serves app with existing valid session cookie (page refresh)', async () => {
      vi.mocked(readFileSync).mockReturnValueOnce('<html><head></head></html>')
      mockTicketStore.consumeTicket.mockReturnValueOnce('__app__')
      const ticketResp = await remoteServer.inject({ method: 'GET', url: '/app/?t=valid-ticket' })
      const setCookie = ticketResp.headers['set-cookie'] as string | string[]
      const cookieStr = Array.isArray(setCookie) ? setCookie[0] : (setCookie ?? '')
      const token = cookieStr.split(';')[0]

      vi.mocked(readFileSync).mockReturnValueOnce('<html><head></head></html>')
      const refreshResp = await remoteServer.inject({
        method: 'GET',
        url: '/app/',
        headers: { cookie: token },
      })
      expect(refreshResp.statusCode).toBe(200)
      expect(refreshResp.body).toContain('remote-shim.js')
    })

    it('returns 503 when renderer is not built (valid ticket)', async () => {
      mockTicketStore.consumeTicket.mockReturnValueOnce('__app__')
      vi.mocked(readFileSync).mockImplementationOnce(() => {
        throw new Error('ENOENT')
      })
      const response = await remoteServer.inject({ method: 'GET', url: '/app/?t=valid-ticket' })
      expect(response.statusCode).toBe(503)
    })
  })

  describe('/app/* static asset session gate', () => {
    it('returns 403 for /app/assets/* without a session cookie', async () => {
      const res = await remoteServer.inject({ method: 'GET', url: '/app/assets/main.js' })
      expect(res.statusCode).toBe(403)
    })

    it('returns 403 for /app/assets/* with an invalid session token', async () => {
      const res = await remoteServer.inject({
        method: 'GET',
        url: '/app/assets/main.js',
        headers: { cookie: 'app-session=bad-token' },
      })
      expect(res.statusCode).toBe(403)
    })

    it('allows /app/assets/* with a valid session cookie issued by ticket auth', async () => {
      vi.mocked(readFileSync).mockReturnValueOnce('<html><head></head></html>')
      mockTicketStore.consumeTicket.mockReturnValueOnce('__app__')
      const ticketResp = await remoteServer.inject({ method: 'GET', url: '/app/?t=valid-ticket' })
      const setCookie = ticketResp.headers['set-cookie'] as string | string[]
      const cookieStr = Array.isArray(setCookie) ? setCookie[0] : (setCookie ?? '')
      const token = cookieStr.split(';')[0]

      // The static file doesn't exist in test env so we get 404 (not 403)
      const assetResp = await remoteServer.inject({
        method: 'GET',
        url: '/app/assets/main.js',
        headers: { cookie: token },
      })
      expect(assetResp.statusCode).not.toBe(403)
    })

    it('disconnectAllClients() clears app sessions, blocking subsequent asset requests', async () => {
      vi.mocked(readFileSync).mockReturnValueOnce('<html><head></head></html>')
      mockTicketStore.consumeTicket.mockReturnValueOnce('__app__')
      const ticketResp = await remoteServer.inject({ method: 'GET', url: '/app/?t=valid-ticket' })
      const setCookie = ticketResp.headers['set-cookie'] as string | string[]
      const cookieStr = Array.isArray(setCookie) ? setCookie[0] : (setCookie ?? '')
      const token = cookieStr.split(';')[0]

      remoteServer.disconnectAllClients()

      const assetResp = await remoteServer.inject({
        method: 'GET',
        url: '/app/assets/main.js',
        headers: { cookie: token },
      })
      expect(assetResp.statusCode).toBe(403)
    })

    it('rejects /app/assets/* when session cookie has expired (server-side TTL)', async () => {
      vi.useFakeTimers()
      try {
        vi.mocked(readFileSync).mockReturnValueOnce('<html><head></head></html>')
        mockTicketStore.consumeTicket.mockReturnValueOnce('__app__')
        const ticketResp = await remoteServer.inject({ method: 'GET', url: '/app/?t=valid-ticket' })
        const setCookie = ticketResp.headers['set-cookie'] as string | string[]
        const cookieStr = Array.isArray(setCookie) ? setCookie[0] : (setCookie ?? '')
        const token = cookieStr.split(';')[0]

        // Advance time past 8-hour TTL
        vi.advanceTimersByTime(8 * 60 * 60 * 1000 + 1)

        const assetResp = await remoteServer.inject({
          method: 'GET',
          url: '/app/assets/main.js',
          headers: { cookie: token },
        })
        expect(assetResp.statusCode).toBe(403)
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('auth middleware getPasswordHash is invoked', () => {
    it('returns 401 when password hash is empty on API request', async () => {
      mockDeps.getPasswordHash.mockReturnValueOnce('')
      const res = await remoteServer.inject({
        method: 'GET',
        url: '/api/workspaces',
        headers: { Authorization: 'Bearer token' },
      })
      expect(res.statusCode).toBe(401)
    })
  })

  describe('POST /api/mobile-ticket', () => {
    it('returns 201 with a ticket when authenticated', async () => {
      const res = await remoteServer.inject({
        method: 'POST',
        url: '/api/mobile-ticket',
        headers: { authorization: 'Bearer anypassword' },
      })
      expect(res.statusCode).toBe(201)
      const body = JSON.parse(res.body) as { ticket: string }
      expect(typeof body.ticket).toBe('string')
      expect(body.ticket.length).toBeGreaterThan(0)
    })

    it('returns 401 without credentials', async () => {
      const res = await remoteServer.inject({ method: 'POST', url: '/api/mobile-ticket' })
      expect(res.statusCode).toBe(401)
    })
  })

  describe('GET /mobile/', () => {
    it('redirects to / when no ticket is provided', async () => {
      const res = await remoteServer.inject({ method: 'GET', url: '/mobile/' })
      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toBe('/')
    })

    it('redirects to / when consumeTicket returns null (invalid/expired ticket)', async () => {
      mockTicketStore.consumeTicket.mockReturnValueOnce(null)
      const res = await remoteServer.inject({ method: 'GET', url: '/mobile/?t=bogus' })
      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toBe('/')
    })

    it('returns 200 and sets mobile-session cookie when ticket is valid', async () => {
      vi.mocked(readFileSync).mockReturnValueOnce('<html><head></head></html>')
      mockTicketStore.consumeTicket.mockReturnValueOnce('__mobile__')
      const res = await remoteServer.inject({ method: 'GET', url: '/mobile/?t=valid-ticket' })
      expect(res.statusCode).toBe(200)
      expect(res.headers['content-type']).toContain('text/html')
      const setCookie = res.headers['set-cookie'] as string | string[]
      const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : (setCookie ?? '')
      expect(cookieStr).toContain('mobile-session=')
      expect(cookieStr).toContain('HttpOnly')
    })

    it('returns 503 when renderer is not built (valid ticket)', async () => {
      mockTicketStore.consumeTicket.mockReturnValueOnce('__mobile__')
      vi.mocked(readFileSync).mockImplementationOnce(() => {
        throw new Error('ENOENT')
      })
      const res = await remoteServer.inject({ method: 'GET', url: '/mobile/?t=valid-ticket' })
      expect(res.statusCode).toBe(503)
    })
  })

  describe('/mobile/* static asset session gate', () => {
    it('returns 403 for /mobile/assets/* without a session cookie', async () => {
      const res = await remoteServer.inject({ method: 'GET', url: '/mobile/assets/main.js' })
      expect(res.statusCode).toBe(403)
    })

    it('returns 403 for /mobile/assets/* with an invalid session token', async () => {
      const res = await remoteServer.inject({
        method: 'GET',
        url: '/mobile/assets/main.js',
        headers: { cookie: 'mobile-session=bad-token' },
      })
      expect(res.statusCode).toBe(403)
    })

    it('allows /mobile/assets/* with a valid mobile-session cookie', async () => {
      vi.mocked(readFileSync).mockReturnValueOnce('<html><head></head></html>')
      mockTicketStore.consumeTicket.mockReturnValueOnce('__mobile__')
      const ticketResp = await remoteServer.inject({
        method: 'GET',
        url: '/mobile/?t=valid-ticket',
      })
      const setCookie = ticketResp.headers['set-cookie'] as string | string[]
      const cookieStr = Array.isArray(setCookie) ? setCookie[0] : (setCookie ?? '')
      const token = cookieStr.split(';')[0]

      const assetResp = await remoteServer.inject({
        method: 'GET',
        url: '/mobile/assets/main.js',
        headers: { cookie: token },
      })
      expect(assetResp.statusCode).not.toBe(403)
    })
  })

  describe('EADDRINUSE handling', () => {
    it('start() with port in use rejects with PortInUseError', async () => {
      const { createRemoteServer: create2, PortInUseError } = await import(
        '../../src/server/remote-server'
      )
      const conflictServer = await create2({
        port: 7683,
        ptyManager: mockPtyManager as never,
        deps: { ...mockDeps, onPortInUse: vi.fn() },
      })
      await expect(conflictServer.start()).rejects.toThrow(PortInUseError)
    })

    it('start() with port in use calls onPortInUse', async () => {
      const { createRemoteServer: create2 } = await import('../../src/server/remote-server')
      const onPortInUse = vi.fn()
      const conflictServer = await create2({
        port: 7683,
        ptyManager: mockPtyManager as never,
        deps: { ...mockDeps, onPortInUse },
      })
      await conflictServer.start().catch(() => {})
      expect(onPortInUse).toHaveBeenCalledWith(7683)
    })
  })
})
