import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'fs'

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
