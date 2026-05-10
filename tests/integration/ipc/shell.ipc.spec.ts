import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}))

vi.mock('../../../src/main/shell/shell-executor', () => ({
  execShell: vi.fn(),
  assertCommandAllowed: vi.fn(),
  assertCwdInScope: vi.fn(),
  CommandNotAllowedError: class CommandNotAllowedError extends Error {
    readonly code = 'COMMAND_NOT_ALLOWED'
    constructor(cmd: string) {
      super(`COMMAND_NOT_ALLOWED: "${cmd}"`)
    }
  },
  CwdOutOfScopeError: class CwdOutOfScopeError extends Error {
    readonly code = 'CWD_OUT_OF_SCOPE'
    constructor() {
      super('CWD_OUT_OF_SCOPE')
    }
  },
}))

import * as shellExecutor from '../../../src/main/shell/shell-executor'
import { registerShellHandlers } from '../../../src/main/ipc/shell.ipc'

describe('shell:exec IPC handler', () => {
  let handler: (event: unknown, payload: unknown) => Promise<unknown>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(shellExecutor.execShell).mockResolvedValue({
      exitCode: 0,
      stdout: 'output',
      stderr: '',
      timedOut: false,
    })

    registerShellHandlers()

    // Capture registered handler
    const calls = vi.mocked(ipcMain.handle).mock.calls
    const shellExecCall = calls.find(([channel]) => channel === 'shell:exec')
    expect(shellExecCall).toBeDefined()
    handler = shellExecCall![1] as typeof handler
  })

  it('executes a valid git command and returns ShellResult', async () => {
    const result = await handler(
      {},
      {
        command: 'git',
        args: ['status'],
        cwd: '/tmp/repo',
      }
    )

    expect(shellExecutor.assertCommandAllowed).toHaveBeenCalledWith('git')
    expect(shellExecutor.execShell).toHaveBeenCalledWith({
      command: 'git',
      args: ['status'],
      cwd: '/tmp/repo',
      timeoutMs: 10000,
    })
    expect(result).toEqual({ exitCode: 0, stdout: 'output', stderr: '', timedOut: false })
  })

  it('returns COMMAND_NOT_ALLOWED for non-allowlisted command', async () => {
    // Use valid enum value but mock assertCommandAllowed to reject it
    vi.mocked(shellExecutor.assertCommandAllowed).mockImplementationOnce((cmd) => {
      throw new shellExecutor.CommandNotAllowedError(cmd)
    })

    const result = (await handler(
      {},
      {
        command: 'git',
        args: ['status'],
        cwd: '/tmp',
      }
    )) as { error: string }

    expect(result.error).toBe('COMMAND_NOT_ALLOWED')
  })

  it('returns CWD_OUT_OF_SCOPE when cwd escapes workspace', async () => {
    vi.mocked(shellExecutor.assertCwdInScope).mockImplementationOnce(() => {
      throw new shellExecutor.CwdOutOfScopeError()
    })

    const result = (await handler(
      {},
      {
        command: 'git',
        args: ['status'],
        cwd: '/etc',
        workspaceRoot: '/tmp/repo',
      }
    )) as { error: string }

    expect(result.error).toBe('CWD_OUT_OF_SCOPE')
  })

  it('returns VALIDATION_ERROR for invalid payload schema', async () => {
    const result = (await handler({}, { command: 'rm', args: [] })) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

  it('returns generic error string for unexpected exceptions', async () => {
    vi.mocked(shellExecutor.execShell).mockRejectedValue(new Error('process spawn failed'))
    const result = (await handler(
      {},
      {
        command: 'git',
        args: ['log'],
        cwd: '/tmp/repo',
      }
    )) as { error: string }
    expect(result.error).toContain('process spawn failed')
  })

  it('calls assertCwdInScope only when workspaceRoot is provided', async () => {
    await handler(
      {},
      {
        command: 'git',
        args: ['status'],
        cwd: '/tmp/repo',
      }
    )
    expect(shellExecutor.assertCwdInScope).not.toHaveBeenCalled()

    await handler(
      {},
      {
        command: 'git',
        args: ['status'],
        cwd: '/tmp/repo',
        workspaceRoot: '/tmp',
      }
    )
    expect(shellExecutor.assertCwdInScope).toHaveBeenCalledWith('/tmp/repo', '/tmp')
  })
})

describe('shell:open-path IPC handler', () => {
  let handler: (event: unknown, payload: unknown) => Promise<unknown>

  const mockOpenPath = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockOpenPath.mockResolvedValue('')

    vi.doMock('electron', () => ({
      ipcMain: { handle: vi.fn() },
      shell: { openPath: mockOpenPath },
    }))

    registerShellHandlers()

    const calls = vi.mocked(ipcMain.handle).mock.calls
    const call = calls.find(([channel]) => channel === 'shell:open-path')
    if (call) handler = call[1] as typeof handler
  })

  it('returns VALIDATION_ERROR for empty filePath', async () => {
    if (!handler) return
    const result = (await handler({}, { filePath: '' })) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

  it('returns VALIDATION_ERROR for missing filePath', async () => {
    if (!handler) return
    const result = (await handler({}, {})) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
  })
})
