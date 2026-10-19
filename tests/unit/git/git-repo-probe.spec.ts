import { describe, it, expect, vi } from 'vitest'
import type { ShellExecOutput } from '../../../src/main/shell/command-runner'

// isGitRepo answers true or false only when git ran and answered; when it did not (it timed out,
// never started, or was ended by a signal) there is no answer, and the call rejects.

const runTextCommand = vi.hoisted(() =>
  vi.fn<() => Promise<ShellExecOutput & { didNotRun: boolean }>>()
)
vi.mock('../../../src/main/shell/command-runner.js', () => ({ runTextCommand }))

import { isGitRepo } from '../../../src/main/git/git-service'

const answered = (exitCode: number, stderr = '') => ({
  exitCode,
  stdout: '',
  stderr,
  timedOut: false,
  exceededMaxBuffer: false,
  didNotRun: false,
})

describe('isGitRepo — git answered', () => {
  it('is true when git finds a repository', async () => {
    runTextCommand.mockResolvedValue(answered(0))
    expect(await isGitRepo('/repo')).toBe(true)
  })

  it('is false when git says the folder is not a repository, whatever its exit code', async () => {
    runTextCommand.mockResolvedValue(answered(128, 'fatal: not a git repository'))
    expect(await isGitRepo('/plain')).toBe(false)
    runTextCommand.mockResolvedValue(answered(1, 'something else'))
    expect(await isGitRepo('/plain')).toBe(false)
  })
})

describe('isGitRepo — git gave no answer', () => {
  it('rejects when git timed out, instead of saying the folder is not a repository', async () => {
    runTextCommand.mockResolvedValue({ ...answered(124), timedOut: true, didNotRun: false })
    await expect(isGitRepo('/repo')).rejects.toThrow(/timed out/i)
  })

  it('rejects when git could not start', async () => {
    runTextCommand.mockResolvedValue({
      ...answered(1, 'spawn git ENOENT'),
      didNotRun: true,
    })
    await expect(isGitRepo('/repo')).rejects.toThrow(/ENOENT/)
  })

  it('rejects when a signal ended git', async () => {
    runTextCommand.mockResolvedValue({ ...answered(1), didNotRun: true })
    await expect(isGitRepo('/repo')).rejects.toThrow()
  })
})
