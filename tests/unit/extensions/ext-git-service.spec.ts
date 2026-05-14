import { describe, it, expect, vi, beforeEach } from 'vitest'

const CUSTOM = Symbol.for('nodejs.util.promisify.custom')

const { execFileMock } = vi.hoisted(() => {
  const CUSTOM_SYM = Symbol.for('nodejs.util.promisify.custom')
  const mock = vi.fn()
  ;(mock as unknown as Record<symbol, ReturnType<typeof vi.fn>>)[CUSTOM_SYM] = vi.fn()
  return { execFileMock: mock }
})

vi.mock('child_process', () => ({ execFile: execFileMock }))

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
      mockResolve('[main abc1234] commit message')
      const result = await commitChanges('/repo', 'commit message')
      expect('commitHash' in result && result.commitHash).toBe('abc1234')
    })

    it('returns empty commitHash when hash not found in output', async () => {
      mockResolve('nothing useful')
      const result = await commitChanges('/repo', 'msg')
      expect('commitHash' in result && result.commitHash).toBe('')
    })

    it('appends --signoff when requested', async () => {
      mockResolve('[main abc1234] signed')
      await commitChanges('/repo', 'signed', true)
      const args = customMock().mock.calls[0][1] as string[]
      expect(args).toContain('--signoff')
    })

    it('appends --no-verify when noVerify is true', async () => {
      mockResolve('[main abc1234] skip')
      await commitChanges('/repo', 'skip', false, true)
      const args = customMock().mock.calls[0][1] as string[]
      expect(args).toContain('--no-verify')
    })

    it('returns NOTHING_TO_COMMIT error when git output says nothing to commit', async () => {
      customMock().mockRejectedValue(
        Object.assign(new Error('Command failed'), {
          stdout: 'nothing to commit, working tree clean',
          stderr: '',
        })
      )
      const result = await commitChanges('/repo', 'msg')
      expect('error' in result && result.error).toBe('NOTHING_TO_COMMIT')
    })

    it('returns HOOK_FAILED with hookOutput when pre-commit hook fails', async () => {
      customMock().mockRejectedValue(
        Object.assign(new Error('Command failed'), {
          stdout: 'lint-staged output: 3 errors',
          stderr:
            "husky - pre-commit hook exited with code 1 (error)\nerror: 'pre-commit' hook failed",
        })
      )
      const result = await commitChanges('/repo', 'msg')
      expect('error' in result && result.error).toBe('HOOK_FAILED')
      expect('hookOutput' in result && result.hookOutput).toContain('lint-staged output')
      expect('isHookFailure' in result && result.isHookFailure).toBe(true)
    })

    it('returns TIMEOUT error when process is killed', async () => {
      customMock().mockRejectedValue(
        Object.assign(new Error('Command failed'), { killed: true, stdout: '', stderr: '' })
      )
      const result = await commitChanges('/repo', 'msg')
      expect('error' in result && result.error).toBe('TIMEOUT')
    })

    it('strips ANSI escape codes from hook output', async () => {
      customMock().mockRejectedValue(
        Object.assign(new Error('Command failed'), {
          stdout: '',
          stderr: '\x1b[31merror\x1b[0m: hook failed\nhook exited with code 1',
        })
      )
      const result = await commitChanges('/repo', 'msg')
      expect('hookOutput' in result && result.hookOutput).not.toContain('\x1b[')
      expect('hookOutput' in result && result.hookOutput).toContain('error: hook failed')
    })
  })
})
