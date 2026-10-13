import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ipcMain } from 'electron'
import { homedir } from 'node:os'
import * as pty from 'node-pty'
import { OUTPUT_FLUSH_INTERVAL_MS } from '../../../src/main/terminal/output-batcher'

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
      onDidAnyChange() {
        return () => {}
      }
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
const mockPty = vi.hoisted(() => ({
  onData: vi.fn(),
  onExit: vi.fn(),
  write: vi.fn(),
  resize: vi.fn(),
  kill: vi.fn(),
  pid: 12345,
}))
vi.mock('node-pty', () => ({
  spawn: vi.fn().mockReturnValue(mockPty),
}))

// Mock fs
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue('{}'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  // Every cwd these tests pass is a real directory; PtyManager refuses one
  // that is not.
  statSync: vi.fn(() => ({ isDirectory: () => true })),
}))

let handlerMap: Record<string, (event: unknown, payload: unknown) => unknown>
let onMap: Record<string, (event: unknown, payload: unknown) => void>
let ptyManager: import('../../../src/main/terminal/pty-manager').PtyManager

/** Records every invoke and send handler registered, by channel. */
function captureRegistrations(): void {
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
}

/** Opens a human terminal in /tmp for the project, through terminal:create. */
function createHumanTerminal(projectId: string, tabTitle: string) {
  return handlerMap['terminal:create']({}, { projectId, type: 'human', tabTitle, cwd: '/tmp' })
}

/** Registers the handlers again, sending to `win`. */
async function registerWithWindow(win: { isDestroyed(): boolean; webContents: unknown }) {
  const { registerTerminalHandlers, sendToRenderer } = await import(
    '../../../src/main/ipc/terminal.ipc'
  )
  const { OutputRelay } = await import('../../../src/main/terminal/output-relay')
  const getWindow = () => win as never
  registerTerminalHandlers(
    ptyManager,
    getWindow,
    new OutputRelay(ptyManager, sendToRenderer(getWindow))
  )
}

function useTerminalIpc(): void {
  beforeEach(async () => {
    vi.clearAllMocks()
    captureRegistrations()

    // Import after mocks are set
    const { PtyManager } = await import('../../../src/main/terminal/pty-manager')
    ptyManager = new PtyManager()

    const { registerTerminalHandlers, sendToRenderer } = await import(
      '../../../src/main/ipc/terminal.ipc'
    )
    const { OutputRelay } = await import('../../../src/main/terminal/output-relay')
    registerTerminalHandlers(
      ptyManager,
      () => null,
      new OutputRelay(
        ptyManager,
        sendToRenderer(() => null)
      )
    )
  })

  afterEach(() => {
    vi.resetModules()
  })
}

describe('terminal IPC handlers — terminal:create', () => {
  useTerminalIpc()

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

  it('accepts agent session type', async () => {
    const payload = {
      projectId: '550e8400-e29b-41d4-a716-446655440001',
      type: 'agent',
      tabTitle: 'AI Agent',
      cwd: '/home/user',
    }

    await handlerMap['terminal:create']({}, payload)
    expect(await handlerMap['terminal:list-sessions']({}, undefined)).toMatchObject([
      { type: 'agent', tabTitle: 'AI Agent' },
    ])
  })
})

describe('terminal IPC handlers — terminal:create cwd and shell', () => {
  useTerminalIpc()

  it('expands ~ to home directory', async () => {
    await handlerMap['terminal:create'](
      {},
      {
        projectId: '550e8400-e29b-41d4-a716-446655440006',
        type: 'human',
        tabTitle: 'Home Shell',
        cwd: '~',
      }
    )
    expect(pty.spawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ cwd: homedir() })
    )
  })
})

describe('terminal IPC handlers — terminal:create shell', () => {
  useTerminalIpc()

  it('uses explicit shell when provided', async () => {
    await handlerMap['terminal:create'](
      {},
      {
        projectId: '550e8400-e29b-41d4-a716-446655440007',
        type: 'human',
        tabTitle: 'Bash',
        cwd: '/tmp',
        shell: '/bin/bash',
      }
    )
    expect(pty.spawn).toHaveBeenCalledWith('/bin/bash', expect.any(Array), expect.anything())
  })
})

describe('terminal IPC handlers — terminal:close', () => {
  useTerminalIpc()

  it('terminates the PTY for the given sessionId', async () => {
    // First create a session
    const createResult = (await createHumanTerminal(
      '550e8400-e29b-41d4-a716-446655440002',
      'Shell'
    )) as { sessionId: string }

    // Then close it
    await handlerMap['terminal:close']({}, { sessionId: createResult.sessionId })
    expect(mockPty.kill).toHaveBeenCalled()
  })
})

describe('terminal IPC handlers — terminal:input', () => {
  useTerminalIpc()

  it('routes data to the correct PTY instance', async () => {
    const createResult = (await createHumanTerminal(
      '550e8400-e29b-41d4-a716-446655440003',
      'Shell'
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

describe('terminal IPC handlers — terminal:resize', () => {
  useTerminalIpc()

  it('resizes the PTY for the given session', async () => {
    const createResult = (await createHumanTerminal(
      '550e8400-e29b-41d4-a716-446655440004',
      'Shell'
    )) as { sessionId: string }

    onMap['terminal:resize']({}, { sessionId: createResult.sessionId, cols: 120, rows: 40 })

    expect(mockPty.resize).toHaveBeenCalledWith(120, 40)
  })
})

describe('terminal IPC handlers — terminal:close-all', () => {
  useTerminalIpc()

  it('kills all sessions and returns terminatedCount', async () => {
    await createHumanTerminal('550e8400-e29b-41d4-a716-446655440005', 'Shell')

    const result = await handlerMap['terminal:close-all']({}, undefined)
    expect(result).toEqual({ terminatedCount: 1 })
    expect(mockPty.kill).toHaveBeenCalled()
  })
})

describe('terminal IPC handlers — terminal:cleanup-orphans', () => {
  useTerminalIpc()

  it('cleans nothing when no earlier run left processes behind', async () => {
    const result = await handlerMap['terminal:cleanup-orphans']({}, undefined)
    expect(result).toEqual({ cleanedCount: 0 })
  })
})

describe('terminal IPC handlers — terminal:list-sessions', () => {
  useTerminalIpc()

  it('returns empty array when no sessions have been created', async () => {
    const result = await handlerMap['terminal:list-sessions']({}, undefined)
    expect(result).toEqual([])
  })

  it('returns created sessions with projectId, tabTitle, and type', async () => {
    await createHumanTerminal('550e8400-e29b-41d4-a716-446655440010', 'My Shell')
    const result = await handlerMap['terminal:list-sessions']({}, undefined)
    expect(result).toHaveLength(1)
    expect((result as Array<Record<string, unknown>>)[0]).toMatchObject({
      projectId: '550e8400-e29b-41d4-a716-446655440010',
      tabTitle: 'My Shell',
      type: 'human',
    })
  })

  it('does not include closed sessions', async () => {
    const created = (await createHumanTerminal('550e8400-e29b-41d4-a716-446655440011', 'Temp')) as {
      sessionId: string
    }

    await handlerMap['terminal:close']({}, { sessionId: created.sessionId })

    const result = await handlerMap['terminal:list-sessions']({}, undefined)
    expect(result).toEqual([])
  })
})

describe('terminal IPC handlers — output to a window', () => {
  useTerminalIpc()

  it('skips send when window is destroyed', async () => {
    vi.useFakeTimers()
    const mockSend = vi.fn()
    const destroyedWin = { isDestroyed: () => true, webContents: { send: mockSend } }
    await registerWithWindow(destroyedWin)

    await createHumanTerminal('550e8400-e29b-41d4-a716-446655440013', 'Destroyed')
    const onDataH = mockPty.onData.mock.calls.at(-1)![0] as (d: string) => void
    onDataH('data')
    vi.advanceTimersByTime(OUTPUT_FLUSH_INTERVAL_MS)
    expect(mockSend).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})

describe('terminal IPC handlers — exit', () => {
  useTerminalIpc()

  it('removes session from registry when PTY process exits', async () => {
    vi.useFakeTimers()
    // Re-register with a mock window so the output/exit callbacks execute fully
    const mockSend = vi.fn()
    const mockWin = { isDestroyed: () => false, webContents: { send: mockSend } }
    await registerWithWindow(mockWin)

    await createHumanTerminal('550e8400-e29b-41d4-a716-446655440012', 'Exiting')

    // Trigger the onData callback (covers the data→send path)
    const onDataHandler = mockPty.onData.mock.calls.at(-1)![0] as (d: string) => void
    onDataHandler('hello')
    vi.advanceTimersByTime(OUTPUT_FLUSH_INTERVAL_MS)
    expect(mockSend).toHaveBeenCalledWith(
      'terminal:output',
      expect.objectContaining({ data: 'hello' })
    )

    // Trigger the onExit callback (covers registry cleanup + exit send path)
    const onExitWrapper = mockPty.onExit.mock.calls.at(-1)![0] as (e: { exitCode: number }) => void
    onExitWrapper({ exitCode: 0 })
    expect(mockSend).toHaveBeenCalledWith(
      'terminal:process-exit',
      expect.objectContaining({ exitCode: 0 })
    )

    vi.useRealTimers()
    const result = await handlerMap['terminal:list-sessions']({}, undefined)
    expect(result).toEqual([])
  })
})
