import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn().mockResolvedValue('$2a$10$mocked-hash'),
    compare: vi.fn().mockResolvedValue(true),
  },
}))

const mockIpcOn = vi.fn()
const mockIpcHandle = vi.fn()

vi.mock('electron', () => ({
  ipcMain: {
    on: mockIpcOn,
    handle: mockIpcHandle,
  },
}))

describe('remote.ipc helpers', () => {
  let sendStatus: typeof import('../remote.ipc').sendStatus
  let sendLog: typeof import('../remote.ipc').sendLog
  let ensurePasswordHash: typeof import('../remote.ipc').ensurePasswordHash
  let registerRemoteHandlers: typeof import('../remote.ipc').registerRemoteHandlers

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    const mod = await import('../remote.ipc')
    sendStatus = mod.sendStatus
    sendLog = mod.sendLog
    ensurePasswordHash = mod.ensurePasswordHash
    registerRemoteHandlers = mod.registerRemoteHandlers
  })

  describe('sendStatus', () => {
    it('calls webContents.send with remote:status and payload', () => {
      const send = vi.fn()
      const win = { webContents: { send } } as never
      sendStatus(win, { enabled: true, port: 7681, publicUrl: 'https://x.ngrok.io' })
      expect(send).toHaveBeenCalledWith('remote:status', {
        enabled: true,
        port: 7681,
        publicUrl: 'https://x.ngrok.io',
      })
    })

    it('does nothing when window is null', () => {
      expect(() => sendStatus(null, { enabled: false })).not.toThrow()
    })
  })

  describe('sendLog', () => {
    it('calls webContents.send with log:push and level/message', () => {
      const send = vi.fn()
      const win = { webContents: { send } } as never
      sendLog(win, 'info', 'tunnel started')
      expect(send).toHaveBeenCalledWith('log:push', { level: 'info', message: 'tunnel started' })
    })

    it('does nothing when window is null', () => {
      expect(() => sendLog(null, 'error', 'crash')).not.toThrow()
    })
  })

  describe('ensurePasswordHash', () => {
    it('auto-generates password when empty string provided', async () => {
      const update = vi.fn()
      const result = await ensurePasswordHash('', update)
      expect(result).not.toBe('')
      expect(result.length).toBeGreaterThan(0)
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          remoteControl: expect.objectContaining({
            password: result,
            passwordHash: '$2a$10$mocked-hash',
          }),
        })
      )
    })

    it('uses provided password when non-empty', async () => {
      const update = vi.fn()
      const result = await ensurePasswordHash('mypassword', update)
      expect(result).toBe('mypassword')
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          remoteControl: expect.objectContaining({ password: 'mypassword' }),
        })
      )
    })
  })

  describe('registerRemoteHandlers', () => {
    it('registers remote:tunnel-reconnect listener and remote:update-password handler', () => {
      const getWindow = vi.fn().mockReturnValue(null)
      const onReconnect = vi.fn()
      registerRemoteHandlers(getWindow, onReconnect)
      expect(mockIpcOn).toHaveBeenCalledWith('remote:tunnel-reconnect', expect.any(Function))
      expect(mockIpcHandle).toHaveBeenCalledWith('remote:update-password', expect.any(Function))
    })

    it('calls onReconnect when remote:tunnel-reconnect fires', () => {
      const getWindow = vi.fn().mockReturnValue(null)
      const onReconnect = vi.fn()
      registerRemoteHandlers(getWindow, onReconnect)
      const listener = mockIpcOn.mock.calls.find(([ch]) => ch === 'remote:tunnel-reconnect')?.[1]
      listener?.()
      expect(onReconnect).toHaveBeenCalledOnce()
    })

    it('remote:update-password handler returns new password and sends status', async () => {
      const send = vi.fn()
      const win = { webContents: { send } }
      const getWindow = vi.fn().mockReturnValue(win)
      const updateFn = vi.fn()
      const disconnectFn = vi.fn()
      registerRemoteHandlers(getWindow, vi.fn(), {
        updateGlobalSettings: updateFn,
        disconnectAllClients: disconnectFn,
      })
      const handler = mockIpcHandle.mock.calls.find(([ch]) => ch === 'remote:update-password')?.[1]
      const result = await handler?.({}, { password: 'newpass' })
      expect(result).toHaveProperty('password', 'newpass')
      expect(disconnectFn).toHaveBeenCalledOnce()
      expect(send).toHaveBeenCalledWith('remote:status', expect.objectContaining({ enabled: true }))
    })

    it('remote:update-password handler returns error on failure', async () => {
      const getWindow = vi.fn().mockReturnValue(null)
      const badUpdate = vi.fn().mockImplementation(() => {
        throw new Error('disk full')
      })
      registerRemoteHandlers(getWindow, vi.fn(), {
        updateGlobalSettings: badUpdate,
        disconnectAllClients: vi.fn(),
      })
      const handler = mockIpcHandle.mock.calls.find(([ch]) => ch === 'remote:update-password')?.[1]
      const result = await handler?.({}, { password: '' })
      expect(result).toHaveProperty('error')
    })
  })
})
