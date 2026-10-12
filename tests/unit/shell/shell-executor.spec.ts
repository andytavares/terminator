import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import {
  assertCommandAllowed,
  assertCwdInScope,
  execShell,
  CommandNotAllowedError,
  CwdOutOfScopeError,
} from '../../../src/main/shell/shell-executor'
import { makeTempDir } from '../../support/temp-dir'

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

// Real directories: the check resolves symlinks, so it is only meaningful on a real disk.
describe('assertCwdInScope', () => {
  let scratch: string
  let root: string
  let otherRoot: string
  let outside: string

  beforeEach(() => {
    scratch = realpathSync(makeTempDir('cwd-scope-'))
    root = join(scratch, 'root')
    otherRoot = join(scratch, 'other')
    outside = join(scratch, 'outside')
    for (const directory of [join(root, 'src', 'deep'), otherRoot, outside]) {
      mkdirSync(directory, { recursive: true })
    }
  })

  afterEach(() => rmSync(scratch, { recursive: true, force: true }))

  it('allows the root itself and any directory below it', async () => {
    await expect(assertCwdInScope(root, [root])).resolves.toBeUndefined()
    await expect(assertCwdInScope(join(root, 'src', 'deep'), [root])).resolves.toBeUndefined()
  })

  it('allows a directory inside any one of several roots', async () => {
    await expect(assertCwdInScope(otherRoot, [root, otherRoot])).resolves.toBeUndefined()
  })

  it('allows a directory below a root that does not exist yet', async () => {
    const clone = join(root, 'not-cloned-yet')
    await expect(assertCwdInScope(clone, [root])).resolves.toBeUndefined()
  })

  it('refuses a directory outside every root', async () => {
    await expect(assertCwdInScope(outside, [root, otherRoot])).rejects.toThrow(CwdOutOfScopeError)
  })

  // Written out, not joined: path.join would fold the `..` away before the check saw it.
  it('refuses a `..` escape out of a root', async () => {
    await expect(assertCwdInScope(`${root}/src/../../outside`, [root])).rejects.toThrow(
      CwdOutOfScopeError
    )
  })

  it('refuses a symlink inside a root that leads out of it', async () => {
    const link = join(root, 'escape')
    symlinkSync(outside, link)
    await expect(assertCwdInScope(link, [root])).rejects.toThrow(CwdOutOfScopeError)
  })

  it('refuses `..` taken after a symlink, which the operating system resolves outside', async () => {
    mkdirSync(join(outside, 'child'))
    symlinkSync(join(outside, 'child'), join(root, 'into-child'))
    await expect(assertCwdInScope(`${root}/into-child/..`, [root])).rejects.toThrow(
      CwdOutOfScopeError
    )
  })

  it('refuses a sibling whose name only starts with the root', async () => {
    const sibling = `${root}-sibling`
    mkdirSync(sibling)
    await expect(assertCwdInScope(sibling, [root])).rejects.toThrow(CwdOutOfScopeError)
  })

  it('allows a root reached through a symlink, compared after resolving both', async () => {
    const linkedRoot = join(scratch, 'linked-root')
    symlinkSync(root, linkedRoot)
    await expect(assertCwdInScope(join(root, 'src'), [linkedRoot])).resolves.toBeUndefined()
  })

  it('refuses a relative cwd, and ignores a relative or empty root', async () => {
    await expect(assertCwdInScope('relative/path', [root])).rejects.toThrow(CwdOutOfScopeError)
    await expect(assertCwdInScope(join(root, 'src'), ['relative/root', ''])).rejects.toThrow(
      CwdOutOfScopeError
    )
  })

  it('rejects with an error named CwdOutOfScopeError that names the directory', async () => {
    const refusal = await assertCwdInScope(outside, [root]).catch((error: unknown) => error)
    expect(refusal).toMatchObject({ name: 'CwdOutOfScopeError', code: 'CWD_OUT_OF_SCOPE' })
    expect((refusal as Error).message).toContain(outside)
  })
})

// ─── execShell ────────────────────────────────────────────────────────────────

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process')
  return { ...actual, execFile: vi.fn() }
})

import { execFile } from 'child_process'
import type { ExecFileOptions, ChildProcess } from 'child_process'
import { partialFake } from '../../support/fakes'

const mockExecFile = vi.mocked(execFile)

describe('execShell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves with exitCode 0 and stdout on success', async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
      callback?.(null, 'hello\n', '')
      return partialFake<ChildProcess>({ on: vi.fn() })
    })

    const result = await execShell({ command: 'git', args: ['--version'], cwd: '/tmp' })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('hello\n')
    expect(result.stderr).toBe('')
    expect(result.timedOut).toBe(false)
  })

  it('resolves with non-zero exitCode when process fails', async () => {
    const err = Object.assign(new Error('exit 1'), { code: 1 })
    mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
      callback?.(err, '', 'error output')
      return partialFake<ChildProcess>({ on: vi.fn() })
    })

    const result = await execShell({ command: 'git', args: ['fail'], cwd: '/tmp' })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe('error output')
    expect(result.timedOut).toBe(false)
  })

  it('resolves with exitCode 1 when error code is non-numeric', async () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
      callback?.(err, '', '')
      return partialFake<ChildProcess>({ on: vi.fn() })
    })

    const result = await execShell({ command: 'git', args: ['status'], cwd: '/tmp' })
    expect(result.exitCode).toBe(1)
  })

  // A command that never started (not on PATH) has no stderr of its own; without
  // the spawn error a caller could only report "exit code 1".
  it('reports the spawn error as stderr when the command could not be started', async () => {
    const err = Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' })
    mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
      callback?.(err, '', '')
      return partialFake<ChildProcess>({ on: vi.fn() })
    })

    const result = await execShell({ command: 'gh', args: ['pr', 'create'], cwd: '/tmp' })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe('spawn gh ENOENT')
  })

  it('reports a command killed by the timeout as failed and timed out', async () => {
    const killed = Object.assign(new Error('Command failed'), {
      killed: true,
      code: null,
      signal: 'SIGTERM' as const,
    })
    mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
      setTimeout(() => callback?.(killed, '', ''), 0)
      return partialFake<ChildProcess>({ on: vi.fn() })
    })

    const result = await execShell({ command: 'git', args: ['status'], cwd: '/tmp', timeoutMs: 1 })
    expect(result.timedOut).toBe(true)
    expect(result.exitCode).not.toBe(0)
  })

  it('reports a command ended by another signal as failed, not timed out', async () => {
    const crashed = Object.assign(new Error('Command failed'), {
      killed: false,
      code: null,
      signal: 'SIGSEGV' as const,
    })
    mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
      callback?.(crashed, '', '')
      return partialFake<ChildProcess>({ on: vi.fn() })
    })

    const result = await execShell({ command: 'git', args: ['status'], cwd: '/tmp' })
    expect(result.exitCode).not.toBe(0)
    expect(result.timedOut).toBe(false)
  })

  it('reports a real process that outlives its timeout as failed and timed out', async () => {
    const actual = await vi.importActual<typeof import('child_process')>('child_process')
    mockExecFile.mockImplementation(actual.execFile as unknown as typeof execFile)

    // git waits on stdin, which execFile leaves open
    const result = await execShell({
      command: 'git',
      args: ['hash-object', '--stdin'],
      cwd: '/tmp',
      timeoutMs: 200,
    })
    expect(result.timedOut).toBe(true)
    expect(result.exitCode).not.toBe(0)
  })

  it('passes sanitized env variables to child process', async () => {
    let capturedOpts: ExecFileOptions | null | undefined
    mockExecFile.mockImplementation((_cmd, _args, opts, callback) => {
      capturedOpts = opts
      callback?.(null, '', '')
      return partialFake<ChildProcess>({ on: vi.fn() })
    })

    await execShell({ command: 'git', args: ['status'], cwd: '/tmp' })
    expect(capturedOpts?.env).toHaveProperty('GIT_TERMINAL_PROMPT', '0')
    // Should not pass arbitrary env vars (not in allowlist)
    expect(capturedOpts?.env).not.toHaveProperty('AWS_SECRET_ACCESS_KEY')
  })
})
