import { describe, it, expect, afterAll, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runAgentReview, type RunAgentReviewInput } from '../../src/review/review-agent'

// A real `claude` starts processes of its own (tools' shells, MCP servers); cancelling a review,
// as deactivation does for every run, must end those too. This stand-in claude starts a `sleep`
// and writes its pid down.

const scratch = mkdtempSync(join(tmpdir(), 'review-agent-group-'))
const pidFile = join(scratch, 'grandchild.pid')
const claude = join(scratch, 'claude')
writeFileSync(claude, `#!/bin/sh\nsleep 30 &\necho $! > "${pidFile}"\nwait\n`)
chmodSync(claude, 0o755)

afterAll(() => rmSync(scratch, { recursive: true, force: true }))

const input: RunAgentReviewInput = {
  repoRoot: scratch,
  worktreePath: scratch,
  prNumber: 42,
  headSHA: 'abc1234',
  baseRefName: 'main',
  title: 'Add review agent',
  body: 'body',
  scope: { kind: 'pr', path: null, startLine: null, endLine: null, side: null, chapter: null },
  request: 'review',
  sessionId: 'sess-1',
  model: 'opus',
}

/** Running, and not a zombie waiting for its new parent to reap it. */
function isProcessAlive(pid: number): boolean {
  try {
    const state = execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' })
    return !state.startsWith('Z')
  } catch {
    return false
  }
}

describe('runAgentReview — cancelling a running claude', () => {
  it('ends the processes claude started as well as claude', async () => {
    const execDiff = async () => ({ stdout: 'diff' })
    const { done, cancel } = runAgentReview(input, {
      exec: execDiff,
      resolveClaude: async () => claude,
    })
    await expect.poll(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8') !== '').toBe(true)
    const grandchild = Number(readFileSync(pidFile, 'utf8'))

    cancel()

    expect((await done).status).toBe('cancelled')
    await expect.poll(() => isProcessAlive(grandchild)).toBe(false)
  })
})

describe('runAgentReview — cancelling while claude is looked up', () => {
  // claude is found by asking the person's interactive login shell, whose rc
  // files can start processes of their own and take a while.
  it('ends the login shell, and what it started, at once', async () => {
    rmSync(pidFile, { force: true })
    vi.stubEnv('SHELL', claude)
    const execDiff = async () => ({ stdout: 'diff' })
    const { done, cancel } = runAgentReview(input, { exec: execDiff })
    await expect.poll(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8') !== '').toBe(true)
    const grandchild = Number(readFileSync(pidFile, 'utf8'))

    cancel()

    expect((await done).status).toBe('cancelled')
    await expect.poll(() => isProcessAlive(grandchild)).toBe(false)
    vi.unstubAllEnvs()
  })
})
