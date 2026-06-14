import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'

const CUSTOM = Symbol.for('nodejs.util.promisify.custom')

const { execFileMock, spawnMock } = vi.hoisted(() => {
  const CUSTOM_SYM = Symbol.for('nodejs.util.promisify.custom')
  const execMock = vi.fn()
  ;(execMock as unknown as Record<symbol, ReturnType<typeof vi.fn>>)[CUSTOM_SYM] = vi.fn()
  const spMock = vi.fn()
  return { execFileMock: execMock, spawnMock: spMock }
})

vi.mock('child_process', () => ({ execFile: execFileMock, spawn: spawnMock }))

import {
  getStatus,
  getDiff,
  stageFiles,
  unstageFiles,
  commitChanges,
} from '../../../extensions/git-integration/src/git/git-service'

function customMock() {
  return (execFileMock as unknown as Record<symbol, ReturnType<typeof vi.fn>>)[CUSTOM]
}

function mockResolve(stdout: string) {
  customMock().mockResolvedValue({ stdout, stderr: '' })
}

// Creates a fake child process. Call proc.resolve(code) or proc.fail(err) to
// drive it; stdout/stderr chunks can be pushed before resolving.
function makeFakeProc() {
  const stdout = new EventEmitter()
  const stderr = new EventEmitter()
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
    kill: () => void
    pushStdout: (s: string) => void
    pushStderr: (s: string) => void
    resolve: (code?: number) => void
    fail: (err: Error) => void
  }
  proc.stdout = stdout
  proc.stderr = stderr
  proc.kill = () => proc.emit('close', null)
  proc.pushStdout = (s: string) => stdout.emit('data', Buffer.from(s))
  proc.pushStderr = (s: string) => stderr.emit('data', Buffer.from(s))
  proc.resolve = (code = 0) => proc.emit('close', code)
  proc.fail = (err: Error) => proc.emit('error', err)
  return proc
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('extension git-service', () => {
  describe('getStatus', () => {
    it('returns parsed status with branch', async () => {
      customMock().mockImplementation((_cmd: string, args: string[]) => {
        if (args.includes('status')) return Promise.resolve({ stdout: '?? foo.ts\0', stderr: '' })
        return Promise.resolve({ stdout: 'main', stderr: '' })
      })
      const result = await getStatus('/repo')
      expect(result.branch).toBe('main')
      expect(result.files[0].status).toBe('untracked')
    })

    it('returns HEAD when branch command fails', async () => {
      customMock().mockImplementation((_cmd: string, args: string[]) => {
        if (args.includes('status')) return Promise.resolve({ stdout: '', stderr: '' })
        return Promise.reject(new Error('not a repo'))
      })
      const result = await getStatus('/repo')
      expect(result.branch).toBe('HEAD')
    })
  })

  describe('getDiff', () => {
    it('returns unstaged diff for false staged flag', async () => {
      mockResolve('@@ -1,1 +1,1 @@\n-old\n+new\n')
      const result = await getDiff('/repo', 'src/app.ts', false)
      const args = customMock().mock.calls[0][1] as string[]
      expect(args).not.toContain('--cached')
      expect(result.path).toBe('src/app.ts')
    })

    it('passes --cached for staged diff', async () => {
      mockResolve('')
      await getDiff('/repo', 'src/app.ts', true)
      const args = customMock().mock.calls[0][1] as string[]
      expect(args).toContain('--cached')
    })
  })

  describe('stageFiles', () => {
    it('calls git add with the paths', async () => {
      mockResolve('')
      await stageFiles('/repo', ['a.ts', 'b.ts'])
      const args = customMock().mock.calls[0][1] as string[]
      expect(args).toContain('add')
      expect(args).toContain('a.ts')
      expect(args).toContain('b.ts')
    })
  })

  describe('unstageFiles', () => {
    it('calls git restore --staged', async () => {
      mockResolve('')
      await unstageFiles('/repo', ['a.ts'])
      const args = customMock().mock.calls[0][1] as string[]
      expect(args).toContain('restore')
      expect(args).toContain('--staged')
    })
  })

  describe('commitChanges', () => {
    it('returns commitHash on success', async () => {
      const proc = makeFakeProc()
      spawnMock.mockReturnValue(proc)
      const p = commitChanges('/repo', 'commit message')
      proc.pushStdout('[main abc1234] commit message\n')
      proc.resolve(0)
      const result = await p
      expect('commitHash' in result && result.commitHash).toBe('abc1234')
    })

    it('returns empty commitHash when hash not found in output', async () => {
      const proc = makeFakeProc()
      spawnMock.mockReturnValue(proc)
      const p = commitChanges('/repo', 'msg')
      proc.pushStdout('nothing useful\n')
      proc.resolve(0)
      const result = await p
      expect('commitHash' in result && result.commitHash).toBe('')
    })

    it('appends --signoff when requested', async () => {
      const proc = makeFakeProc()
      spawnMock.mockReturnValue(proc)
      const p = commitChanges('/repo', 'signed', true)
      proc.resolve(0)
      await p
      const args = spawnMock.mock.calls[0][1] as string[]
      expect(args).toContain('--signoff')
    })

    it('appends --no-verify when noVerify is true', async () => {
      const proc = makeFakeProc()
      spawnMock.mockReturnValue(proc)
      const p = commitChanges('/repo', 'skip', false, true)
      proc.resolve(0)
      await p
      const args = spawnMock.mock.calls[0][1] as string[]
      expect(args).toContain('--no-verify')
    })

    it('returns NOTHING_TO_COMMIT when git output says nothing to commit', async () => {
      const proc = makeFakeProc()
      spawnMock.mockReturnValue(proc)
      const p = commitChanges('/repo', 'msg')
      proc.pushStdout('nothing to commit, working tree clean\n')
      proc.resolve(1)
      const result = await p
      expect('error' in result && result.error).toBe('NOTHING_TO_COMMIT')
    })

    it('returns HOOK_FAILED with hookOutput when pre-commit hook fails', async () => {
      const proc = makeFakeProc()
      spawnMock.mockReturnValue(proc)
      const p = commitChanges('/repo', 'msg')
      proc.pushStdout('lint-staged output: 3 errors\n')
      proc.pushStderr(
        "husky - pre-commit hook exited with code 1 (error)\nerror: 'pre-commit' hook failed\n"
      )
      proc.resolve(1)
      const result = await p
      expect('error' in result && result.error).toBe('HOOK_FAILED')
      expect('hookOutput' in result && result.hookOutput).toContain('lint-staged output')
      expect('isHookFailure' in result && result.isHookFailure).toBe(true)
    })

    it('returns TIMEOUT when kill timer fires', async () => {
      vi.useFakeTimers()
      try {
        const proc = makeFakeProc()
        spawnMock.mockReturnValue(proc)
        const p = commitChanges('/repo', 'msg')
        vi.advanceTimersByTime(120_001)
        proc.resolve(null as unknown as number) // kill fires close
        const result = await p
        expect('error' in result && result.error).toBe('TIMEOUT')
      } finally {
        vi.useRealTimers()
      }
    })

    it('strips ANSI escape codes from hook output', async () => {
      const proc = makeFakeProc()
      spawnMock.mockReturnValue(proc)
      const p = commitChanges('/repo', 'msg')
      proc.pushStderr('\x1b[31merror\x1b[0m: hook failed\nhook exited with code 1\n')
      proc.resolve(1)
      const result = await p
      expect('hookOutput' in result && result.hookOutput).not.toContain('\x1b[')
      expect('hookOutput' in result && result.hookOutput).toContain('error: hook failed')
    })

    it('calls onOutput callback with streamed lines', async () => {
      const proc = makeFakeProc()
      spawnMock.mockReturnValue(proc)
      const lines: string[] = []
      const p = commitChanges('/repo', 'msg', false, false, (l) => lines.push(l))
      proc.pushStdout('running eslint...\n')
      proc.pushStderr('warning: found 1 issue\n')
      proc.pushStdout('[main abc1234] msg\n')
      proc.resolve(0)
      await p
      expect(lines).toContain('running eslint...')
      expect(lines).toContain('warning: found 1 issue')
    })
  })
})
