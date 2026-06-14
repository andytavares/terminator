import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Hoisted mocks must be declared before module imports
const mockCreateRemoteServer = vi.hoisted(() => vi.fn())
const mockBroadcast = vi.hoisted(() => vi.fn())
const mockSettingsGet = vi.hoisted(() => vi.fn())
const mockSettingsSet = vi.hoisted(() => vi.fn())
const mockIpcRegisterHandler = vi.hoisted(() => vi.fn())
const mockNgrokIsInstalled = vi.hoisted(() => vi.fn(() => false))

vi.mock('../../src/server/remote-server', () => ({
  createRemoteServer: mockCreateRemoteServer,
  PortInUseError: class PortInUseError extends Error {
    constructor(port: number) {
      super(`Port ${port} is already in use.`)
      this.name = 'PortInUseError'
    }
  },
}))

const mockNgrokStart = vi.hoisted(() => vi.fn().mockResolvedValue('https://example.ngrok.app'))
const mockNgrokStop = vi.hoisted(() => vi.fn())
const mockNgrokSetOnCrash = vi.hoisted(() => vi.fn())

vi.mock('../../src/server/ngrok-manager', () => {
  class MockNgrokManager {
    static isInstalled = mockNgrokIsInstalled
    start = mockNgrokStart
    stop = mockNgrokStop
    setOnCrash = mockNgrokSetOnCrash
  }
  return { NgrokManager: MockNgrokManager, generateCaddyfile: vi.fn(() => '') }
})

vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn().mockResolvedValue('$2a$10$hashed'),
    compare: vi.fn().mockResolvedValue(true),
  },
}))

vi.mock('os', () => ({
  networkInterfaces: vi.fn(() => ({})),
}))

function makeApi() {
  return {
    settings: {
      register: vi.fn(),
      get: mockSettingsGet,
      set: mockSettingsSet,
    },
    ipc: {
      registerHandler: mockIpcRegisterHandler,
      invokeChannel: vi.fn().mockResolvedValue(undefined),
      sendChannel: vi.fn(),
      onWindowEvent: vi.fn().mockReturnValue(vi.fn()),
    },
    window: { broadcast: mockBroadcast },
    pty: {},
    workspace: { list: vi.fn(() => []), listProjects: vi.fn(() => []) },
  }
}

function makeServerHandle(startImpl: () => Promise<void> = () => Promise.resolve()) {
  return {
    start: vi.fn().mockImplementation(startImpl),
    stop: vi.fn().mockResolvedValue(undefined),
    isListening: vi.fn(() => true),
    disconnectAllClients: vi.fn(),
    inject: vi.fn(),
  }
}

async function setupAndGetToggleHandler(
  serverHandle: ReturnType<typeof makeServerHandle>
): Promise<(payload: unknown) => Promise<unknown>> {
  mockCreateRemoteServer.mockResolvedValue(serverHandle)
  mockSettingsGet.mockImplementation((key: string) => {
    if (key === 'terminator.remote-control.enabled') return false
    if (key === 'terminator.remote-control.port') return 7681
    if (key === 'terminator.remote-control.passwordHash') return '$2a$10$existing'
    return null
  })

  // Explicitly import the TypeScript source so vi.mock intercepts its dependencies.
  // Importing without extension would resolve to the compiled index.js bundle (where mocks have no effect).
  const { activate } = await import('../../src/index.ts')
  const api = makeApi()
  activate(api as never)

  const toggleHandler = mockIpcRegisterHandler.mock.calls.find(
    ([ch]: [string]) => ch === 'remote:toggle'
  )?.[1] as (payload: unknown) => Promise<unknown>
  return toggleHandler
}

describe('remote-control extension index', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mockNgrokIsInstalled.mockReturnValue(false)
  })

  afterEach(() => {
    vi.resetModules()
  })

  describe('startServer failure handling', () => {
    it('on non-PortInUseError, sets enabled=false in settings and broadcasts START_FAILED', async () => {
      const serverHandle = makeServerHandle(() => Promise.reject(new Error('unexpected error')))
      const toggleHandler = await setupAndGetToggleHandler(serverHandle)

      await toggleHandler({ enabled: true })
      // Flush the enqueued microtasks
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(mockSettingsSet).toHaveBeenCalledWith('terminator.remote-control.enabled', false)
      expect(mockBroadcast).toHaveBeenCalledWith('remote:status', {
        enabled: false,
        error: 'START_FAILED',
      })
    })

    it('on PortInUseError, does NOT set enabled=false (user intent preserved)', async () => {
      const { PortInUseError } = await import('../../src/server/remote-server')
      const serverHandle = makeServerHandle(() => Promise.reject(new PortInUseError(7681)))
      const toggleHandler = await setupAndGetToggleHandler(serverHandle)

      await toggleHandler({ enabled: true })
      await new Promise((resolve) => setTimeout(resolve, 10))

      const enabledFalseCalls = mockSettingsSet.mock.calls.filter(
        ([key, val]: [string, unknown]) =>
          key === 'terminator.remote-control.enabled' && val === false
      )
      expect(enabledFalseCalls).toHaveLength(0)
    })

    it('on successful start, does not broadcast START_FAILED', async () => {
      const serverHandle = makeServerHandle()
      const toggleHandler = await setupAndGetToggleHandler(serverHandle)

      await toggleHandler({ enabled: true })
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(mockBroadcast).not.toHaveBeenCalledWith(
        'remote:status',
        expect.objectContaining({ error: 'START_FAILED' })
      )
    })
  })

  describe('remote:tunnel-reconnect', () => {
    it('re-registers crash handler and updates currentPublicUrl after reconnect', async () => {
      mockNgrokIsInstalled.mockReturnValue(true)

      const serverHandle = makeServerHandle()
      serverHandle.isListening.mockReturnValue(true)
      mockCreateRemoteServer.mockResolvedValue(serverHandle)
      mockSettingsGet.mockImplementation((key: string) => {
        if (key === 'terminator.remote-control.enabled') return false
        if (key === 'terminator.remote-control.port') return 7681
        if (key === 'terminator.remote-control.passwordHash') return '$2a$10$existing'
        return null
      })

      const { activate } = await import('../../src/index.ts')
      const api = makeApi()
      activate(api as never)

      // Start the server so remoteServer is set
      const toggleHandler = mockIpcRegisterHandler.mock.calls.find(
        ([ch]: [string]) => ch === 'remote:toggle'
      )?.[1] as (p: unknown) => Promise<unknown>
      await toggleHandler({ enabled: true })
      await new Promise((resolve) => setTimeout(resolve, 20))

      mockNgrokSetOnCrash.mockClear()

      const reconnectHandler = mockIpcRegisterHandler.mock.calls.find(
        ([ch]: [string]) => ch === 'remote:tunnel-reconnect'
      )?.[1] as () => Promise<unknown>

      await reconnectHandler()
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(mockNgrokSetOnCrash).toHaveBeenCalled()
      expect(mockBroadcast).toHaveBeenCalledWith(
        'remote:status',
        expect.objectContaining({ publicUrl: 'https://example.ngrok.app' })
      )
    })
  })
})
