import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'fs'

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) }
})

vi.mock('../ws-ticket-store', () => ({
  WsTicketStore: vi.fn().mockImplementation(() => ({
    createTicket: vi.fn(() => 'a'.repeat(64)),
    consumeTicket: vi.fn(),
    startCleanup: vi.fn(),
    stopCleanup: vi.fn(),
  })),
}))

vi.mock('../ws-subscriber-manager', () => ({
  WsSubscriberManager: vi.fn().mockImplementation(() => ({
    addSubscriber: vi.fn(),
    removeSubscriber: vi.fn(),
    broadcast: vi.fn(),
    destroySession: vi.fn(),
    destroyAll: vi.fn(),
    isPrimary: vi.fn(),
    getPrimary: vi.fn(),
  })),
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
  })

  describe('GET /app/', () => {
    it('returns injected HTML when renderer is built', async () => {
      vi.mocked(readFileSync).mockReturnValueOnce('<html><head></head></html>')
      const response = await remoteServer.inject({ method: 'GET', url: '/app/' })
      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toContain('text/html')
      expect(response.body).toContain('remote-shim.js')
    })

    it('returns 503 when renderer is not built', async () => {
      vi.mocked(readFileSync).mockImplementationOnce(() => {
        throw new Error('ENOENT')
      })
      const response = await remoteServer.inject({ method: 'GET', url: '/app/' })
      expect(response.statusCode).toBe(503)
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
    it('start() with port in use calls getWindow and rejects', async () => {
      const { createRemoteServer: create2 } = await import('../remote-server')
      const conflictServer = await create2({
        port: 7682,
        ptyManager: mockPtyManager as never,
        deps: mockDeps,
        getWindow: mockGetWindow as never,
      })
      await expect(conflictServer.start()).rejects.toThrow()
    })
  })
})
