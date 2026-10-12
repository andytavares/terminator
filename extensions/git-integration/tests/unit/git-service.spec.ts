/**
 * Behavioural coverage for the pre-existing functions in
 * extensions/git-integration/src/git/git-service.ts that predate the Git
 * quick actions: getStatus, getDiff, stageFiles/unstageFiles, commitChanges
 * (and, through it, the private stripAnsi helper).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ExtensionAPI, ShellExecResult } from '@terminator/extension-sdk'
import { bindShell } from '../../src/shell/run-git'
import { bindShellToStub, stubFails, stubPrints } from './support/shell'

const mockExecFile = vi.fn()
bindShellToStub(mockExecFile)

import {
  getStatus,
  getDiff,
  stageFiles,
  unstageFiles,
  commitChanges,
} from '../../src/git/git-service'

function mockExecSuccess(stdout = '') {
  mockExecFile.mockImplementationOnce(stubPrints(stdout))
}

function mockExecError(message: string, extra: Record<string, unknown> = {}) {
  mockExecFile.mockImplementationOnce(stubFails(Object.assign(new Error(message), extra)))
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
})

describe('getStatus — falls back to HEAD when the branch cannot be read (e.g. detached HEAD)', () => {
  it('falls back to HEAD when the branch cannot be read (e.g. detached HEAD)', async () => {
    mockExecSuccess('') // no changes
    mockExecError('fatal: ref HEAD is not a symbolic ref') // git branch --show-current fails

    const result = await getStatus('/repo')

    expect(result.branch).toBe('HEAD')
    expect(result.files).toEqual([])
  })
})

describe('getStatus — limits', () => {
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

    const result = await getDiff('/repo', 'src/foo.ts', { staged: true })

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
})

describe('getDiff — requests an unstaged diff without --cached when staged is false', () => {
  it('requests an unstaged diff without --cached when staged is false', async () => {
    mockExecSuccess('@@ -1,1 +1,1 @@\n-old\n+new\n')

    await getDiff('/repo', 'src/foo.ts', { staged: false })

    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['diff', '--unified=3', '--', 'src/foo.ts'],
      expect.objectContaining({ cwd: '/repo' }),
      expect.any(Function)
    )
  })
})

describe('getDiff — untracked files', () => {
  it('falls back to --no-index for an untracked file with no plain diff output', async () => {
    mockExecSuccess('') // plain `git diff` produces nothing for an untracked file
    mockExecSuccess('@@ -0,0 +1,1 @@\n+brand new line\n') // --no-index succeeds

    const result = await getDiff('/repo', 'src/new.ts', { staged: false, isUntracked: true })

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
})

describe('getDiff — untracked files whose diff git reports as a failure', () => {
  it('reads the diff from the error object when --no-index exits non-zero', async () => {
    mockExecSuccess('') // plain diff empty
    mockExecError('Command failed', { stdout: '@@ -0,0 +1,1 @@\n+content\n' }) // --no-index "fails" (exit 1) but carries the diff

    const result = await getDiff('/repo', 'src/new.ts', { staged: false, isUntracked: true })

    expect(result.hunks[0].lines).toEqual([
      { type: 'add', content: 'content', oldLineNumber: null, newLineNumber: 1 },
    ])
  })

  it('does not fall back to --no-index for a tracked file with an empty diff', async () => {
    mockExecSuccess('')

    const result = await getDiff('/repo', 'src/unchanged.ts', { staged: false, isUntracked: false })

    expect(mockExecFile).toHaveBeenCalledTimes(1)
    expect(result.hunks).toEqual([])
  })
})

describe('stageFiles', () => {
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
})

describe('unstageFiles', () => {
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

type ExecOptions = Parameters<ExtensionAPI['shell']['exec']>[0]
let calls: ExecOptions[]

/** The core's shell.exec stand-in: streams `chunks` to onOutput, then resolves `result`. */
function commitRuns(chunks: string[], result: Partial<ShellExecResult> = {}): void {
  calls = []
  const exec = async (options: ExecOptions): Promise<ShellExecResult> => {
    calls.push(options)
    for (const chunk of chunks) options.onOutput?.(chunk)
    const exitCode = result.exitCode ?? 0
    const stdout = exitCode === 0 ? chunks.join('') : ''
    return { exitCode, stdout, stderr: '', timedOut: false, exceededMaxBuffer: false, ...result }
  }
  bindShell({ exec: exec as ExtensionAPI['shell']['exec'] })
}

afterEach(() => {
  bindShellToStub(mockExecFile)
})

describe('commitChanges — arguments', () => {
  it('passes --signoff and --no-verify only when requested', async () => {
    commitRuns(['[main abc1234] msg\n'])
    await commitChanges('/repo', 'msg', { signOff: true, noVerify: true })

    expect(calls[0]).toMatchObject({
      command: 'git',
      args: ['commit', '-m', 'msg', '--signoff', '--no-verify'],
      cwd: '/repo',
    })
  })

  it('omits --signoff and --no-verify by default', async () => {
    commitRuns([])
    await commitChanges('/repo', 'msg')

    expect(calls[0].args).toEqual(['commit', '-m', 'msg'])
  })
})

describe('commitChanges — the commit hash', () => {
  it('resolves the commit hash parsed from stdout on success', async () => {
    commitRuns(['[main a1b2c3d] feat: add x\n'])

    await expect(commitChanges('/repo', 'feat: add x')).resolves.toEqual({ commitHash: 'a1b2c3d' })
  })

  it.each([
    ['feature/add-login', '[feature/add-login a1b2c3d] feat: add login'],
    ['release-1.2', '[release-1.2 a1b2c3d] chore: release'],
    ['user.name/fix_x', '[user.name/fix_x a1b2c3d] fix: x'],
    ['the first commit', '[main (root-commit) a1b2c3d] chore: init'],
    ['a detached HEAD', '[detached HEAD a1b2c3d] wip'],
  ])('resolves the commit hash for %s', async (_case, summaryLine) => {
    commitRuns([`${summaryLine}\n 1 file changed, 1 insertion(+)\n`])

    await expect(commitChanges('/repo', 'msg')).resolves.toEqual({ commitHash: 'a1b2c3d' })
  })

  it('resolves an empty commit hash when git prints no summary line', async () => {
    commitRuns(['done\n'])

    await expect(commitChanges('/repo', 'msg')).resolves.toEqual({ commitHash: '' })
  })
})

describe('commitChanges — streamed output', () => {
  it('strips ANSI escapes from streamed output before handing it to onOutput', async () => {
    commitRuns(['\x1b[32mrunning hook\x1b[0m\n'])
    const onOutput = vi.fn()
    await commitChanges('/repo', 'msg', { onOutput })

    expect(onOutput).toHaveBeenCalledWith('running hook')
  })

  it('does not call onOutput for blank lines', async () => {
    commitRuns(['\n   \n[main abc] msg\n'])
    const onOutput = vi.fn()
    await commitChanges('/repo', 'msg', { onOutput })

    expect(onOutput).toHaveBeenCalledTimes(1)
    expect(onOutput).toHaveBeenCalledWith('[main abc] msg')
  })
})

describe('commitChanges — failures', () => {
  it('resolves NOTHING_TO_COMMIT when git reports nothing staged', async () => {
    commitRuns([], { exitCode: 1, stdout: 'nothing to commit, working tree clean\n' })

    await expect(commitChanges('/repo', 'msg')).resolves.toEqual({ error: 'NOTHING_TO_COMMIT' })
  })

  it('detects a pre-commit hook failure and reports the hook output', async () => {
    commitRuns([], { exitCode: 1, stderr: 'husky - pre-commit hook exited with code 1\n' })

    const result = (await commitChanges('/repo', 'msg')) as {
      error: string
      hookOutput?: string
      isHookFailure?: boolean
    }
    expect(result.error).toBe('HOOK_FAILED')
    expect(result.isHookFailure).toBe(true)
    expect(result.hookOutput).toContain('husky - pre-commit hook exited with code 1')
  })
})

describe('commitChanges — failures — reports a generic failure with the combined output when no hook pattern matches', () => {
  it('reports a generic failure with the combined output when no hook pattern matches', async () => {
    commitRuns([], { exitCode: 128, stderr: 'fatal: unable to auto-detect email address\n' })

    const result = (await commitChanges('/repo', 'msg')) as {
      error: string
      isHookFailure?: boolean
    }
    expect(result.error).toContain('unable to auto-detect email address')
    expect(result.isHookFailure).toBe(false)
  })
})

describe('commitChanges — timeouts and spawn failures', () => {
  it('gives hooks two minutes, and resolves TIMEOUT past them', async () => {
    commitRuns([], { exitCode: 124, timedOut: true })

    await expect(commitChanges('/repo', 'msg')).resolves.toEqual({ error: 'TIMEOUT' })
    expect(calls[0].timeoutMs).toBe(120_000)
  })

  it('reports why git could not run at all', async () => {
    commitRuns([], { exitCode: 1, stderr: 'spawn git ENOENT' })

    await expect(commitChanges('/repo', 'msg')).resolves.toMatchObject({
      error: 'spawn git ENOENT',
    })
  })
})
