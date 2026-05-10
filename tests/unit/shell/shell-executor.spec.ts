import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  assertCommandAllowed,
  assertCwdInScope,
  execShell,
  CommandNotAllowedError,
  CwdOutOfScopeError,
} from '../../../src/main/shell/shell-executor'

// ─── assertCommandAllowed ─────────────────────────────────────────────────────

describe('assertCommandAllowed', () => {
  it('allows git', () => {
    expect(() => assertCommandAllowed('git')).not.toThrow()
  })

  it('allows gh', () => {
    expect(() => assertCommandAllowed('gh')).not.toThrow()
  })

  it('throws CommandNotAllowedError for rm', () => {
    expect(() => assertCommandAllowed('rm')).toThrow(CommandNotAllowedError)
  })

  it('throws CommandNotAllowedError for curl', () => {
    expect(() => assertCommandAllowed('curl')).toThrow(CommandNotAllowedError)
  })

  it('thrown error has COMMAND_NOT_ALLOWED code', () => {
    try {
      assertCommandAllowed('bash')
    } catch (e) {
      expect((e as CommandNotAllowedError).code).toBe('COMMAND_NOT_ALLOWED')
    }
  })

  it('thrown error message names the disallowed command', () => {
    try {
      assertCommandAllowed('node')
    } catch (e) {
      expect((e as Error).message).toContain('node')
    }
  })
})

// ─── assertCwdInScope ─────────────────────────────────────────────────────────

describe('assertCwdInScope', () => {
  it('allows cwd exactly equal to workspaceRoot', () => {
    expect(() => assertCwdInScope('/workspace', '/workspace')).not.toThrow()
  })

  it('allows cwd inside workspaceRoot', () => {
    expect(() => assertCwdInScope('/workspace/src/components', '/workspace')).not.toThrow()
  })

  it('allows deeply nested cwd inside workspaceRoot', () => {
    expect(() => assertCwdInScope('/workspace/a/b/c/d', '/workspace')).not.toThrow()
  })

  it('throws CwdOutOfScopeError when cwd is outside workspaceRoot', () => {
    expect(() => assertCwdInScope('/etc/passwd', '/workspace')).toThrow(CwdOutOfScopeError)
  })

  it('throws CwdOutOfScopeError for path traversal attempt (../escape)', () => {
    // Even though resolve would handle this, the raw relative check catches it
    expect(() => assertCwdInScope('/workspace/../etc', '/workspace')).toThrow(CwdOutOfScopeError)
  })

  it('throws CwdOutOfScopeError when cwd is relative', () => {
    expect(() => assertCwdInScope('relative/path', '/workspace')).toThrow(CwdOutOfScopeError)
  })

  it('throws CwdOutOfScopeError when workspaceRoot is relative', () => {
    expect(() => assertCwdInScope('/workspace/src', 'relative/root')).toThrow(CwdOutOfScopeError)
  })

  it('thrown error has CWD_OUT_OF_SCOPE code', () => {
    try {
      assertCwdInScope('/etc', '/workspace')
    } catch (e) {
      expect((e as CwdOutOfScopeError).code).toBe('CWD_OUT_OF_SCOPE')
    }
  })
})

// ─── execShell ────────────────────────────────────────────────────────────────

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process')
  return { ...actual, execFile: vi.fn() }
})

import { execFile } from 'child_process'

const mockExecFile = vi.mocked(execFile as any)

describe('execShell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves with exitCode 0 and stdout on success', async () => {
    mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, callback: any) => {
      callback(null, 'hello\n', '')
      return { on: vi.fn() } as any
    })

    const result = await execShell({ command: 'git', args: ['--version'], cwd: '/tmp' })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('hello\n')
    expect(result.stderr).toBe('')
    expect(result.timedOut).toBe(false)
  })

  it('resolves with non-zero exitCode when process fails', async () => {
    const err = Object.assign(new Error('exit 1'), { code: 1 })
    mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, callback: any) => {
      callback(err, '', 'error output')
      return { on: vi.fn() } as any
    })

    const result = await execShell({ command: 'git', args: ['fail'], cwd: '/tmp' })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe('error output')
    expect(result.timedOut).toBe(false)
  })

  it('resolves with exitCode 1 when error code is non-numeric', async () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, callback: any) => {
      callback(err, '', '')
      return { on: vi.fn() } as any
    })

    const result = await execShell({ command: 'git', args: ['status'], cwd: '/tmp' })
    expect(result.exitCode).toBe(1)
  })

  it('marks timedOut when SIGTERM close signal fires before callback', async () => {
    mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, callback: any) => {
      let closeHandler: ((code: null, signal: string) => void) | null = null
      const child = {
        on: (event: string, handler: any) => {
          if (event === 'close') closeHandler = handler
        },
      }
      // Simulate real Node.js timeout: close event fires first, then the callback
      setTimeout(() => {
        closeHandler?.(null, 'SIGTERM')
        callback(Object.assign(new Error('timeout'), { code: null }), '', '')
      }, 0)
      return child as any
    })

    const result = await execShell({ command: 'git', args: ['status'], cwd: '/tmp', timeoutMs: 1 })
    expect(result.timedOut).toBe(true)
  })

  it('passes sanitized env variables to child process', async () => {
    let capturedOpts: any = null
    mockExecFile.mockImplementation((_cmd: any, _args: any, opts: any, callback: any) => {
      capturedOpts = opts
      callback(null, '', '')
      return { on: vi.fn() } as any
    })

    await execShell({ command: 'git', args: ['status'], cwd: '/tmp' })
    expect(capturedOpts.env).toHaveProperty('GIT_TERMINAL_PROMPT', '0')
    // Should not pass arbitrary env vars (not in allowlist)
    expect(capturedOpts.env).not.toHaveProperty('AWS_SECRET_ACCESS_KEY')
  })
})
