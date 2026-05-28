import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ipcMain } from 'electron'

// Mock electron
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
  },
  app: {
    getPath: vi.fn().mockReturnValue('/tmp/test-terminator'),
  },
}))

// Mock electron-store — captures defaults from the Store constructor
vi.mock('electron-store', () => {
  return {
    default: class MockStore {
      private data: Record<string, unknown>
      constructor(opts?: { defaults?: Record<string, unknown> }) {
        this.data = { ...(opts?.defaults ?? {}) }
      }
      get<T>(key: string, defaultValue?: T): T {
        return (key in this.data ? this.data[key] : defaultValue) as T
      }
      set(key: string, value: unknown): void {
        this.data[key] = value
      }
    },
  }
})

// Mock node-pty
const mockPty = {
  onData: vi.fn(),
  onExit: vi.fn(),
  write: vi.fn(),
  resize: vi.fn(),
  kill: vi.fn(),
  pid: 12345,
}
vi.mock('node-pty', () => ({
  spawn: vi.fn().mockReturnValue(mockPty),
}))

// Mock fs
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue('{}'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}))

describe('terminal IPC handlers', () => {
  let handlerMap: Record<string, (event: unknown, payload: unknown) => unknown>
  let onMap: Record<string, (event: unknown, payload: unknown) => void>
  let ptyManager: import('../../../src/main/terminal/pty-manager').PtyManager

  beforeEach(async () => {
    vi.clearAllMocks()

    handlerMap = {}
    onMap = {}
    vi.mocked(ipcMain.handle).mockImplementation((channel, handler) => {
      handlerMap[channel] = handler as (event: unknown, payload: unknown) => unknown
      return ipcMain
    })
    vi.mocked(ipcMain.on).mockImplementation((channel, handler) => {
      onMap[channel as string] = handler as (event: unknown, payload: unknown) => void
      return ipcMain
    })

    // Import after mocks are set
    const { PtyManager } = await import('../../../src/main/terminal/pty-manager')
    ptyManager = new PtyManager()

    const { registerTerminalHandlers } = await import('../../../src/main/ipc/terminal.ipc')
    registerTerminalHandlers(ptyManager, () => null)
  })

  afterEach(() => {
    vi.resetModules()
  })

  describe('terminal:create', () => {
    it('returns a sessionId when given a valid payload', async () => {
      const payload = {
        projectId: '550e8400-e29b-41d4-a716-446655440000',
        type: 'human',
        tabTitle: 'Shell',
        cwd: '/tmp',
        scrollbackLimit: 10000,
      }

      const result = await handlerMap['terminal:create']({}, payload)
      expect(result).toHaveProperty('sessionId')
      expect(typeof (result as { sessionId: string }).sessionId).toBe('string')
    })

    it('returns VALIDATION_ERROR when projectId is not a UUID', async () => {
      const payload = {
        projectId: 'not-a-uuid',
        type: 'human',
        tabTitle: 'Shell',
        cwd: '/tmp',
      }

      const result = await handlerMap['terminal:create']({}, payload)
      expect(result).toMatchObject({ error: 'VALIDATION_ERROR' })
    })

    it('returns VALIDATION_ERROR when type is invalid', async () => {
      const payload = {
        projectId: '550e8400-e29b-41d4-a716-446655440000',
        type: 'robot',
        tabTitle: 'Shell',
        cwd: '/tmp',
      }

      const result = await handlerMap['terminal:create']({}, payload)
      expect(result).toMatchObject({ error: 'VALIDATION_ERROR' })
    })

    it('accepts agent session type', async () => {
      const payload = {
        projectId: '550e8400-e29b-41d4-a716-446655440001',
        type: 'agent',
        tabTitle: 'AI Agent',
        cwd: '/home/user',
      }

      const result = await handlerMap['terminal:create']({}, payload)
      expect(result).toHaveProperty('sessionId')
    })
  })

  describe('terminal:close', () => {
    it('terminates the PTY for the given sessionId', async () => {
      // First create a session
      const createResult = (await handlerMap['terminal:create'](
        {},
        {
          projectId: '550e8400-e29b-41d4-a716-446655440002',
          type: 'human',
          tabTitle: 'Shell',
          cwd: '/tmp',
        }
      )) as { sessionId: string }

      // Then close it
      await handlerMap['terminal:close']({}, { sessionId: createResult.sessionId })
      expect(mockPty.kill).toHaveBeenCalled()
    })
  })

  describe('terminal:input', () => {
    it('routes data to the correct PTY instance', async () => {
      const createResult = (await handlerMap['terminal:create'](
        {},
        {
          projectId: '550e8400-e29b-41d4-a716-446655440003',
          type: 'human',
          tabTitle: 'Shell',
          cwd: '/tmp',
        }
      )) as { sessionId: string }

      onMap['terminal:input'](
        {},
        {
          sessionId: createResult.sessionId,
          data: 'ls -la\n',
        }
      )

      expect(mockPty.write).toHaveBeenCalledWith('ls -la\n')
    })
  })

  describe('terminal:resize', () => {
    it('resizes the PTY for the given session', async () => {
      const createResult = (await handlerMap['terminal:create'](
        {},
        {
          projectId: '550e8400-e29b-41d4-a716-446655440004',
          type: 'human',
          tabTitle: 'Shell',
          cwd: '/tmp',
        }
      )) as { sessionId: string }

      onMap['terminal:resize']({}, { sessionId: createResult.sessionId, cols: 120, rows: 40 })

      expect(mockPty.resize).toHaveBeenCalledWith(120, 40)
    })
  })

  describe('terminal:close-all', () => {
    it('kills all sessions and returns terminatedCount', async () => {
      await handlerMap['terminal:create'](
        {},
        {
          projectId: '550e8400-e29b-41d4-a716-446655440005',
          type: 'human',
          tabTitle: 'Shell',
          cwd: '/tmp',
        }
      )

      const result = await handlerMap['terminal:close-all']({}, undefined)
      expect(result).toMatchObject({ terminatedCount: expect.any(Number) })
      expect(mockPty.kill).toHaveBeenCalled()
    })
  })

  describe('terminal:cleanup-orphans', () => {
    it('returns a cleanedCount result', async () => {
      const result = await handlerMap['terminal:cleanup-orphans']({}, undefined)
      expect(result).toMatchObject({ cleanedCount: expect.any(Number) })
    })
  })
})
