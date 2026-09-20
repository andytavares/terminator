/**
 * Behavioural coverage for the pre-existing functions in
 * extensions/git-integration/src/git/git-service.ts that predate the Git
 * quick actions: getStatus, getDiff, stageFiles/unstageFiles, commitChanges
 * (and, through it, the private stripAnsi helper).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'

const { mockExecFile, mockSpawn } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
  mockSpawn: vi.fn(),
}))

vi.mock('child_process', () => ({
  execFile: mockExecFile,
  spawn: mockSpawn,
}))

import {
  getStatus,
  getDiff,
  stageFiles,
  unstageFiles,
  commitChanges,
} from '../../src/git/git-service'

type ExecCallback = (
  err: (Error & { stdout?: string }) | null,
  result?: { stdout: string; stderr: string }
) => void

function mockExecSuccess(stdout = '') {
  mockExecFile.mockImplementationOnce(
    (_cmd: string, _args: string[], _opts: unknown, cb: ExecCallback) =>
      cb(null, { stdout, stderr: '' })
  )
}

function mockExecError(message: string, extra: Record<string, unknown> = {}) {
  mockExecFile.mockImplementationOnce(
    (_cmd: string, _args: string[], _opts: unknown, cb: ExecCallback) =>
      cb(Object.assign(new Error(message), extra))
  )
}

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  kill = vi.fn()
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getStatus', () => {
  it('parses porcelain status output and reports the current branch', async () => {
    mockExecSuccess('M  src/foo.ts\0?? src/new.ts\0') // git status --porcelain=v1 -z
    mockExecSuccess('main\n') // git branch --show-current

    const result = await getStatus('/repo', 500)

    expect(mockExecFile).toHaveBeenNthCalledWith(
      1,
      'git',
      ['status', '--porcelain=v1', '-z'],
      expect.objectContaining({ cwd: '/repo' }),
      expect.any(Function)
    )
    expect(result.branch).toBe('main')
    expect(result.files).toEqual([
      { path: 'src/foo.ts', status: 'modified', staged: true, isBinary: false },
      { path: 'src/new.ts', status: 'untracked', staged: false, isBinary: false },
    ])
    expect(result.hasConflicts).toBe(false)
  })

  it('falls back to HEAD when the branch cannot be read (e.g. detached HEAD)', async () => {
    mockExecSuccess('') // no changes
    mockExecError('fatal: ref HEAD is not a symbolic ref') // git branch --show-current fails

    const result = await getStatus('/repo')

    expect(result.branch).toBe('HEAD')
    expect(result.files).toEqual([])
  })

  it('caps the file list at maxFiles and reports truncation', async () => {
    const entries = ['M  a.ts', 'M  b.ts', 'M  c.ts'].join('\0') + '\0'
    mockExecSuccess(entries)
    mockExecSuccess('main\n')

    const result = await getStatus('/repo', 2)

    expect(result.files).toHaveLength(2)
    expect(result.truncated).toBe(true)
  })
})

describe('getDiff', () => {
  it('requests a staged diff with --cached when staged is true', async () => {
    mockExecSuccess('@@ -1,1 +1,2 @@\n line1\n+line2\n')

    const result = await getDiff('/repo', 'src/foo.ts', true)

    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['diff', '--cached', '--unified=3', '--', 'src/foo.ts'],
      expect.objectContaining({ cwd: '/repo' }),
      expect.any(Function)
    )
    expect(result.path).toBe('src/foo.ts')
    expect(result.hunks).toHaveLength(1)
    expect(result.hunks[0].lines).toEqual([
      { type: 'context', content: 'line1', oldLineNumber: 1, newLineNumber: 1 },
      { type: 'add', content: 'line2', oldLineNumber: null, newLineNumber: 2 },
    ])
  })

  it('requests an unstaged diff without --cached when staged is false', async () => {
    mockExecSuccess('@@ -1,1 +1,1 @@\n-old\n+new\n')

    await getDiff('/repo', 'src/foo.ts', false)

    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['diff', '--unified=3', '--', 'src/foo.ts'],
      expect.objectContaining({ cwd: '/repo' }),
      expect.any(Function)
    )
  })

  it('falls back to --no-index for an untracked file with no plain diff output', async () => {
    mockExecSuccess('') // plain `git diff` produces nothing for an untracked file
    mockExecSuccess('@@ -0,0 +1,1 @@\n+brand new line\n') // --no-index succeeds

    const result = await getDiff('/repo', 'src/new.ts', false, true)

    expect(mockExecFile).toHaveBeenNthCalledWith(
      2,
      'git',
      ['diff', '--no-index', '--unified=3', '--', '/dev/null', 'src/new.ts'],
      expect.objectContaining({ cwd: '/repo' }),
      expect.any(Function)
    )
    expect(result.hunks[0].lines).toEqual([
      { type: 'add', content: 'brand new line', oldLineNumber: null, newLineNumber: 1 },
    ])
  })

  it('reads the diff from the error object when --no-index exits non-zero', async () => {
    mockExecSuccess('') // plain diff empty
    mockExecError('Command failed', { stdout: '@@ -0,0 +1,1 @@\n+content\n' }) // --no-index "fails" (exit 1) but carries the diff

    const result = await getDiff('/repo', 'src/new.ts', false, true)

    expect(result.hunks[0].lines).toEqual([
      { type: 'add', content: 'content', oldLineNumber: null, newLineNumber: 1 },
    ])
  })

  it('does not fall back to --no-index for a tracked file with an empty diff', async () => {
    mockExecSuccess('')

    const result = await getDiff('/repo', 'src/unchanged.ts', false, false)

    expect(mockExecFile).toHaveBeenCalledTimes(1)
    expect(result.hunks).toEqual([])
  })
})

describe('stageFiles / unstageFiles', () => {
  it('stageFiles runs git add -- <paths>', async () => {
    mockExecSuccess('')
    await stageFiles('/repo', ['a.ts', 'b.ts'])
    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['add', '--', 'a.ts', 'b.ts'],
      expect.objectContaining({ cwd: '/repo' }),
      expect.any(Function)
    )
  })

  it('stageFiles propagates a git error', async () => {
    mockExecError('fatal: pathspec did not match any files')
    await expect(stageFiles('/repo', ['missing.ts'])).rejects.toThrow(
      'pathspec did not match any files'
    )
  })

  it('unstageFiles runs git restore --staged -- <paths>', async () => {
    mockExecSuccess('')
    await unstageFiles('/repo', ['a.ts'])
    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['restore', '--staged', '--', 'a.ts'],
      expect.objectContaining({ cwd: '/repo' }),
      expect.any(Function)
    )
  })

  it('unstageFiles propagates a git error', async () => {
    mockExecError('fatal: index locked')
    await expect(unstageFiles('/repo', ['a.ts'])).rejects.toThrow('index locked')
  })
})

describe('commitChanges', () => {
  let proc: FakeChildProcess

  beforeEach(() => {
    proc = new FakeChildProcess()
    mockSpawn.mockReturnValue(proc)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('passes --signoff and --no-verify only when requested', async () => {
    const pending = commitChanges('/repo', 'msg', true, true)
    proc.stdout.emit('data', Buffer.from('[main abc1234] msg\n'))
    proc.emit('close', 0)
    await pending

    expect(mockSpawn).toHaveBeenCalledWith(
      'git',
      ['commit', '-m', 'msg', '--signoff', '--no-verify'],
      expect.objectContaining({ cwd: '/repo' })
    )
  })

  it('omits --signoff and --no-verify by default', async () => {
    const pending = commitChanges('/repo', 'msg')
    proc.emit('close', 0)
    await pending

    expect(mockSpawn).toHaveBeenCalledWith(
      'git',
      ['commit', '-m', 'msg'],
      expect.objectContaining({ cwd: '/repo' })
    )
  })

  it('resolves the commit hash parsed from stdout on success', async () => {
    const pending = commitChanges('/repo', 'feat: add x')
    proc.stdout.emit('data', Buffer.from('[main a1b2c3d] feat: add x\n'))
    proc.emit('close', 0)

    await expect(pending).resolves.toEqual({ commitHash: 'a1b2c3d' })
  })

  it('strips ANSI escapes from streamed output before handing it to onOutput', async () => {
    const onOutput = vi.fn()
    const pending = commitChanges('/repo', 'msg', false, false, onOutput)
    proc.stdout.emit('data', Buffer.from('\x1b[32mrunning hook\x1b[0m\n'))
    proc.emit('close', 0)
    await pending

    expect(onOutput).toHaveBeenCalledWith('running hook')
  })

  it('does not call onOutput for blank lines', async () => {
    const onOutput = vi.fn()
    const pending = commitChanges('/repo', 'msg', false, false, onOutput)
    proc.stdout.emit('data', Buffer.from('\n   \n[main abc] msg\n'))
    proc.emit('close', 0)
    await pending

    expect(onOutput).toHaveBeenCalledTimes(1)
    expect(onOutput).toHaveBeenCalledWith('[main abc] msg')
  })

  it('resolves NOTHING_TO_COMMIT when git reports nothing staged', async () => {
    const pending = commitChanges('/repo', 'msg')
    proc.stdout.emit('data', Buffer.from('nothing to commit, working tree clean\n'))
    proc.emit('close', 1)

    await expect(pending).resolves.toEqual({ error: 'NOTHING_TO_COMMIT' })
  })

  it('detects a pre-commit hook failure and reports the hook output', async () => {
    const pending = commitChanges('/repo', 'msg')
    proc.stderr.emit('data', Buffer.from('husky - pre-commit hook exited with code 1\n'))
    proc.emit('close', 1)

    const result = (await pending) as {
      error: string
      hookOutput?: string
      isHookFailure?: boolean
    }
    expect(result.error).toBe('HOOK_FAILED')
    expect(result.isHookFailure).toBe(true)
    expect(result.hookOutput).toContain('husky - pre-commit hook exited with code 1')
  })

  it('reports a generic failure with the combined output when no hook pattern matches', async () => {
    const pending = commitChanges('/repo', 'msg')
    proc.stderr.emit('data', Buffer.from('fatal: unable to auto-detect email address\n'))
    proc.emit('close', 1)

    const result = (await pending) as { error: string; isHookFailure?: boolean }
    expect(result.error).toContain('unable to auto-detect email address')
    expect(result.isHookFailure).toBe(false)
  })

  it('resolves TIMEOUT and kills the process when it runs past the hook timeout', async () => {
    vi.useFakeTimers()
    const pending = commitChanges('/repo', 'msg')
    await vi.advanceTimersByTimeAsync(120_000)
    expect(proc.kill).toHaveBeenCalled()
    proc.emit('close', null)

    await expect(pending).resolves.toEqual({ error: 'TIMEOUT' })
  })

  it('resolves with the error message when the process itself fails to spawn', async () => {
    const pending = commitChanges('/repo', 'msg')
    proc.emit('error', new Error('ENOENT'))

    await expect(pending).resolves.toEqual({ error: 'Error: ENOENT' })
  })
})
