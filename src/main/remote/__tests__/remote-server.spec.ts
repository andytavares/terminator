import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'fs'

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) }
})

const mockTicketStore = vi.hoisted(() => ({
  createTicket: vi.fn(() => 'a'.repeat(64)),
  consumeTicket: vi.fn(() => null as string | null),
  startCleanup: vi.fn(),
  stopCleanup: vi.fn(),
}))

vi.mock('../ws-ticket-store', () => ({
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

vi.mock('../ws-subscriber-manager', () => ({
  WsSubscriberManager: vi.fn(() => mockSubscriberManager),
}))

describe('RemoteServer', () => {
  let remoteServer: Awaited<ReturnType<typeof import('../remote-server').createRemoteServer>>

  const mockPtyManager = {
    spawn: vi.fn(),
    write: vi.fn(),
    kill: vi.fn(),
    resize: vi.fn(),
    getSessionIds: vi.fn(() => []),
  }

  const mockDeps = {
    getGlobalSettings: vi.fn(() => ({
      remoteControl: { enabled: true, port: 7682, password: 'pass', passwordHash: '$2a$10$test' },
    })),
    updateGlobalSettings: vi.fn(),
  }

  const mockGetWindow = vi.fn(() => null)

  beforeEach(async () => {
    const { createRemoteServer } = await import('../remote-server')
    remoteServer = await createRemoteServer({
      port: 7682,
      ptyManager: mockPtyManager as never,
      deps: mockDeps,
      getWindow: mockGetWindow as never,
    })
    await remoteServer.start()
  })

  afterEach(async () => {
    await remoteServer.stop()
    vi.resetModules()
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

    it('returns injected HTML when consumeTicket returns a session (valid ticket)', async () => {
      vi.mocked(readFileSync).mockReturnValueOnce('<html><head></head></html>')
      mockTicketStore.consumeTicket.mockReturnValueOnce('__app__')
      const response = await remoteServer.inject({ method: 'GET', url: '/app/?t=valid-ticket' })
      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toContain('text/html')
      expect(response.body).toContain('remote-shim.js')
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

  describe('stop() cleans up PTY sessions', () => {
    it('stop() does not throw when no sessions exist (cleanup with empty map)', async () => {
      await expect(remoteServer.stop()).resolves.not.toThrow()
    })
  })

  describe('auth middleware getPasswordHash is invoked', () => {
    it('calls getGlobalSettings when an API request carries a Bearer token', async () => {
      // Supply an empty hash so middleware returns 401 without reaching bcrypt
      mockDeps.getGlobalSettings.mockReturnValueOnce({
        remoteControl: { enabled: true, port: 7682, password: '', passwordHash: '' },
      })
      const res = await remoteServer.inject({
        method: 'GET',
        url: '/api/workspaces',
        headers: { Authorization: 'Bearer token' },
      })
      expect(res.statusCode).toBe(401)
      expect(mockDeps.getGlobalSettings).toHaveBeenCalled()
    })
  })

  describe('EADDRINUSE handling', () => {
    it('start() with port in use rejects with PortInUseError', async () => {
      const { createRemoteServer: create2, PortInUseError } = await import('../remote-server')
      const conflictServer = await create2({
        port: 7682,
        ptyManager: mockPtyManager as never,
        deps: mockDeps,
        getWindow: mockGetWindow as never,
      })
      await expect(conflictServer.start()).rejects.toThrow(PortInUseError)
    })

    it('start() with port in use sends PORT_IN_USE status via getWindow', async () => {
      const { createRemoteServer: create2 } = await import('../remote-server')
      const mockSend = vi.fn()
      const mockWindow = { webContents: { send: mockSend } }
      const conflictServer = await create2({
        port: 7682,
        ptyManager: mockPtyManager as never,
        deps: mockDeps,
        getWindow: () => mockWindow as never,
      })
      await conflictServer.start().catch(() => {})
      expect(mockSend).toHaveBeenCalledWith(
        'remote:status',
        expect.objectContaining({ error: 'PORT_IN_USE' })
      )
    })
  })
})
