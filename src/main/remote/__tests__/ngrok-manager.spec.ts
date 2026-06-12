import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const mockSpawn = vi.fn()
const mockExecSync = vi.fn()
const mockFetch = vi.fn()

vi.mock('child_process', () => ({
  spawn: mockSpawn,
  execSync: mockExecSync,
}))

global.fetch = mockFetch as never

describe('NgrokManager', () => {
  let NgrokManager: typeof import('../ngrok-manager').NgrokManager
  let manager: InstanceType<typeof import('../ngrok-manager').NgrokManager>

  const mockProcess = {
    pid: 1234,
    kill: vi.fn(),
    on: vi.fn(),
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
  }

  beforeEach(async () => {
    vi.resetModules()
    vi.useFakeTimers()
    mockSpawn.mockReturnValue(mockProcess)
    mockProcess.kill.mockReset()
    mockProcess.on.mockReset()
    mockProcess.stdout.on.mockReset()
    mockProcess.stderr.on.mockReset()
    const mod = await import('../ngrok-manager')
    NgrokManager = mod.NgrokManager
    manager = new NgrokManager()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('isInstalled', () => {
    it('returns true when which ngrok exits 0', () => {
      mockExecSync.mockReturnValueOnce('')
      expect(NgrokManager.isInstalled()).toBe(true)
    })

    it('returns false when which ngrok throws', () => {
      mockExecSync.mockImplementationOnce(() => {
        throw new Error('not found')
      })
      expect(NgrokManager.isInstalled()).toBe(false)
    })
  })

  describe('start', () => {
    it('spawns ngrok http <port> and resolves URL from agent API', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            tunnels: [{ public_url: 'https://abc.ngrok.io' }],
          }),
      })

      const urlPromise = manager.start(7681)
      await vi.runAllTimersAsync()
      const url = await urlPromise

      expect(mockSpawn).toHaveBeenCalledWith('ngrok', ['http', '7681'], expect.anything())
      expect(url).toBe('https://abc.ngrok.io')
    })

    it('rejects after 20 failed polls', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tunnels: [] }),
      })

      const urlPromise = manager.start(7681)
      urlPromise.catch(() => {})
      for (let i = 0; i < 21; i++) {
        await vi.runAllTimersAsync()
      }
      await expect(urlPromise).rejects.toThrow()
    })

    it('passes --authtoken flag when auth token provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ tunnels: [{ public_url: 'https://auth.ngrok.io' }] }),
      })

      const urlPromise = manager.start(7681, 'my-token')
      await vi.runAllTimersAsync()
      await urlPromise

      expect(mockSpawn).toHaveBeenCalledWith(
        'ngrok',
        ['http', '7681', '--authtoken', 'my-token'],
        expect.anything()
      )
    })
  })

  describe('stop', () => {
    it('sends SIGTERM to the child process', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            tunnels: [{ public_url: 'https://xyz.ngrok.io' }],
          }),
      })
      const startPromise = manager.start(7681)
      await vi.runAllTimersAsync()
      await startPromise
      manager.stop()
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM')
    })
  })

  describe('onCrash callback', () => {
    it('fires when ngrok process exits unexpectedly', async () => {
      const onCrash = vi.fn()
      manager.setOnCrash(onCrash)

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            tunnels: [{ public_url: 'https://crash.ngrok.io' }],
          }),
      })

      const startPromise = manager.start(7681)
      await vi.runAllTimersAsync()
      await startPromise

      const exitHandler = mockProcess.on.mock.calls.find(([event]) => event === 'exit')?.[1]
      expect(exitHandler).toBeDefined()
      exitHandler?.(1, null)
      expect(onCrash).toHaveBeenCalled()
    })

    it('does NOT fire when stop() is called intentionally', async () => {
      const onCrash = vi.fn()
      manager.setOnCrash(onCrash)

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            tunnels: [{ public_url: 'https://stop.ngrok.io' }],
          }),
      })

      const startPromise = manager.start(7681)
      await vi.runAllTimersAsync()
      await startPromise

      // Intentional stop — should clear the crash callback before killing
      manager.stop()

      const exitHandler = mockProcess.on.mock.calls.find(([event]) => event === 'exit')?.[1]
      exitHandler?.(130, null) // SIGTERM typically exits with 130
      expect(onCrash).not.toHaveBeenCalled()
    })

    it('clears process reference on exit so stop() does not double-kill', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            tunnels: [{ public_url: 'https://ref.ngrok.io' }],
          }),
      })

      const startPromise = manager.start(7681)
      await vi.runAllTimersAsync()
      await startPromise

      const exitHandler = mockProcess.on.mock.calls.find(([event]) => event === 'exit')?.[1]
      exitHandler?.(1, null) // process exits on its own

      // stop() should be a no-op now — process reference was cleared by the exit handler
      manager.stop()
      expect(mockProcess.kill).not.toHaveBeenCalled()
    })
  })
})
