/**
 * Coverage for extensions/git-integration/src/git/git-service.ts pushBranch()
 * and pullFastForward() — the service functions quick-actions commands and
 * git.ipc.ts's git:push handler both call, so the git CLI invocation lives in
 * exactly one place.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockExecFile } = vi.hoisted(() => ({ mockExecFile: vi.fn() }))

vi.mock('child_process', () => ({
  execFile: mockExecFile,
  spawn: vi.fn(),
}))

import { pushBranch, pullFastForward } from '../../src/git/git-service'

type ExecCallback = (err: Error | null, result?: { stdout: string; stderr: string }) => void

function mockExecSuccess(stdout = '') {
  mockExecFile.mockImplementationOnce(
    (_cmd: string, _args: string[], _opts: unknown, cb: ExecCallback) =>
      cb(null, { stdout, stderr: '' })
  )
}

function mockExecError(message: string) {
  mockExecFile.mockImplementationOnce(
    (_cmd: string, _args: string[], _opts: unknown, cb: ExecCallback) => cb(new Error(message))
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('pushBranch', () => {
  it('pushes, then reports the branch and remote on success', async () => {
    mockExecSuccess('') // git push
    mockExecSuccess('main\n') // git branch --show-current
    mockExecSuccess('origin/main\n') // git rev-parse --abbrev-ref --symbolic-full-name @{u}

    const result = await pushBranch('/repo')

    expect(result).toEqual({ success: true, branch: 'main', remote: 'origin' })
    expect(mockExecFile).toHaveBeenNthCalledWith(
      1,
      'git',
      ['push'],
      expect.objectContaining({ cwd: '/repo' }),
      expect.any(Function)
    )
  })

  it('falls back to remote "origin" when there is no upstream to read', async () => {
    mockExecSuccess('') // git push
    mockExecSuccess('feature\n') // git branch --show-current
    mockExecError('fatal: no upstream configured') // @{u} lookup fails

    const result = await pushBranch('/repo')

    expect(result).toEqual({ success: true, branch: 'feature', remote: 'origin' })
  })

  it('returns NO_UPSTREAM when the branch has no upstream', async () => {
    mockExecError('error: The current branch has no upstream branch')
    const result = await pushBranch('/repo')
    expect(result).toEqual({ error: 'NO_UPSTREAM' })
  })

  it('returns REJECTED when the push is rejected', async () => {
    mockExecError('! [rejected] main -> main (fetch first)')
    const result = await pushBranch('/repo')
    expect(result).toEqual({ error: 'REJECTED' })
  })

  it('returns the raw error message for other failures', async () => {
    mockExecError('network unreachable')
    const result = (await pushBranch('/repo')) as { error: string }
    expect(result.error).toContain('network unreachable')
  })
})

describe('pullFastForward', () => {
  it('pulls --ff-only and reports the branch on success', async () => {
    mockExecSuccess('') // git pull --ff-only
    mockExecSuccess('main\n') // git branch --show-current

    const result = await pullFastForward('/repo')

    expect(result).toEqual({ success: true, branch: 'main' })
    expect(mockExecFile).toHaveBeenNthCalledWith(
      1,
      'git',
      ['pull', '--ff-only'],
      expect.objectContaining({ cwd: '/repo' }),
      expect.any(Function)
    )
  })

  it('returns the error message when the pull is not a fast-forward', async () => {
    mockExecError('fatal: Not possible to fast-forward, aborting.')
    const result = (await pullFastForward('/repo')) as { error: string }
    expect(result.error).toContain('Not possible to fast-forward')
  })
})
