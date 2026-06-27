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

    it('expands ~ to home directory', async () => {
      const result = await handlerMap['terminal:create'](
        {},
        {
          projectId: '550e8400-e29b-41d4-a716-446655440006',
          type: 'human',
          tabTitle: 'Home Shell',
          cwd: '~',
        }
      )
      expect(result).toHaveProperty('sessionId')
    })

    it('uses explicit shell when provided', async () => {
      const result = await handlerMap['terminal:create'](
        {},
        {
          projectId: '550e8400-e29b-41d4-a716-446655440007',
          type: 'human',
          tabTitle: 'Bash',
          cwd: '/tmp',
          shell: '/bin/bash',
        }
      )
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

  describe('getSessionMeta', () => {
    it('returns undefined for unknown session', async () => {
      const { getSessionMeta } = await import('../../../src/main/ipc/terminal.ipc')
      expect(getSessionMeta('nonexistent')).toBeUndefined()
    })

    it('returns metadata for a created session', async () => {
      const created = (await handlerMap['terminal:create'](
        {},
        {
          projectId: '550e8400-e29b-41d4-a716-446655440020',
          type: 'human',
          tabTitle: 'Meta Shell',
          cwd: '/tmp',
        }
      )) as { sessionId: string }
      const { getSessionMeta } = await import('../../../src/main/ipc/terminal.ipc')
      const meta = getSessionMeta(created.sessionId)
      expect(meta).toMatchObject({
        projectId: '550e8400-e29b-41d4-a716-446655440020',
        tabTitle: 'Meta Shell',
        type: 'human',
      })
    })
  })

  describe('terminal:list-sessions', () => {
    it('returns empty array when no sessions have been created', async () => {
      const result = await handlerMap['terminal:list-sessions']({}, undefined)
      expect(result).toEqual([])
    })

    it('returns created sessions with projectId, tabTitle, and type', async () => {
      await handlerMap['terminal:create'](
        {},
        {
          projectId: '550e8400-e29b-41d4-a716-446655440010',
          type: 'human',
          tabTitle: 'My Shell',
          cwd: '/tmp',
        }
      )
      const result = await handlerMap['terminal:list-sessions']({}, undefined)
      expect(result).toHaveLength(1)
      expect((result as Array<Record<string, unknown>>)[0]).toMatchObject({
        projectId: '550e8400-e29b-41d4-a716-446655440010',
        tabTitle: 'My Shell',
        type: 'human',
      })
    })

    it('does not include closed sessions', async () => {
      const created = (await handlerMap['terminal:create'](
        {},
        {
          projectId: '550e8400-e29b-41d4-a716-446655440011',
          type: 'human',
          tabTitle: 'Temp',
          cwd: '/tmp',
        }
      )) as { sessionId: string }

      await handlerMap['terminal:close']({}, { sessionId: created.sessionId })

      const result = await handlerMap['terminal:list-sessions']({}, undefined)
      expect(result).toEqual([])
    })

    it('skips send when window is destroyed', async () => {
      const mockSend = vi.fn()
      const destroyedWin = { isDestroyed: () => true, webContents: { send: mockSend } }
      const { registerTerminalHandlers: reg } = await import('../../../src/main/ipc/terminal.ipc')
      reg(ptyManager, () => destroyedWin as never)

      await handlerMap['terminal:create'](
        {},
        {
          projectId: '550e8400-e29b-41d4-a716-446655440013',
          type: 'human',
          tabTitle: 'Destroyed',
          cwd: '/tmp',
        }
      )
      const onDataH = mockPty.onData.mock.calls.at(-1)?.[0] as (d: string) => void
      onDataH?.('data')
      expect(mockSend).not.toHaveBeenCalled()
    })

    it('removes session from registry when PTY process exits', async () => {
      // Re-register with a mock window so the output/exit callbacks execute fully
      const mockSend = vi.fn()
      const mockWin = { isDestroyed: () => false, webContents: { send: mockSend } }
      const { registerTerminalHandlers: reg } = await import('../../../src/main/ipc/terminal.ipc')
      reg(ptyManager, () => mockWin as never)

      await handlerMap['terminal:create'](
        {},
        {
          projectId: '550e8400-e29b-41d4-a716-446655440012',
          type: 'human',
          tabTitle: 'Exiting',
          cwd: '/tmp',
        }
      )

      // Trigger the onData callback (covers the data→send path)
      const onDataHandler = mockPty.onData.mock.calls.at(-1)?.[0] as (d: string) => void
      onDataHandler?.('hello')
      expect(mockSend).toHaveBeenCalledWith(
        'terminal:output',
        expect.objectContaining({ data: 'hello' })
      )

      // Trigger the onExit callback (covers registry cleanup + exit send path)
      const onExitWrapper = mockPty.onExit.mock.calls.at(-1)?.[0] as (e: {
        exitCode: number
      }) => void
      onExitWrapper?.({ exitCode: 0 })
      expect(mockSend).toHaveBeenCalledWith(
        'terminal:process-exit',
        expect.objectContaining({ exitCode: 0 })
      )

      const result = await handlerMap['terminal:list-sessions']({}, undefined)
      expect(
        (result as unknown[]).every(
          (s: unknown) => (s as Record<string, unknown>).tabTitle !== 'Exiting'
        )
      ).toBe(true)
    })
  })
})
