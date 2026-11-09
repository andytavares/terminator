import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, rmSync, utimesSync } from 'fs'
import { join } from 'path'
import { ensureReviewWorktree } from '../../src/review/worktree.js'
import { makeTempDir } from '../../../../packages/test-support/src/temp-dir'

interface GitCall {
  cmd: string
  args: string[]
  cwd?: string
}

/** A recording git: `worktree add` creates its directory, `rev-parse` answers `headAt`. */
function recordingGit(headAt = '') {
  const calls: GitCall[] = []
  const removed: string[] = []
  const exec = vi.fn(async (cmd: string, args: string[], opts: { cwd?: string }) => {
    calls.push({ cmd, args, cwd: opts.cwd })
    if (args[0] === 'worktree' && args[1] === 'add') mkdirSync(args[3], { recursive: true })
    if (args[0] === 'worktree' && args[1] === 'remove') removed.push(args[3])
    if (args[0] === 'rev-parse') return { stdout: headAt }
    return { stdout: '' }
  })
  return { exec, calls, removed }
}

let repoRoot: string

beforeEach(() => {
  repoRoot = makeTempDir('review-worktree-')
})

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true })
})

const pr42 = () => ({ repoRoot, prNumber: 42, headSHA: 'abc1234def' })
const pr42Dir = () => join(repoRoot, '.git', 'terminator-review', 'pr-42-abc1234')

describe('ensureReviewWorktree — a new worktree', () => {
  it('fetches the PR ref then adds a detached worktree at the head SHA, in order', async () => {
    const { exec, calls } = recordingGit()

    const dir = await ensureReviewWorktree(pr42(), { exec })

    expect(dir).toBe(pr42Dir())
    expect(calls[0].args).toEqual(['worktree', 'prune'])
    const fetchCall = calls.find((c) => c.args[0] === 'fetch')
    expect(fetchCall?.args).toEqual([
      'fetch',
      'origin',
      'pull/42/head:refs/terminator/review/42/abc1234def',
    ])
    const addCall = calls.find((c) => c.args[0] === 'worktree' && c.args[1] === 'add')
    expect(addCall?.args).toEqual(['worktree', 'add', '--detach', dir, 'abc1234def'])
    // fetch must happen before worktree add
    const fetchIdx = calls.indexOf(fetchCall!)
    const addIdx = calls.indexOf(addCall!)
    expect(fetchIdx).toBeLessThan(addIdx)
  })
})

describe('ensureReviewWorktree — a new worktree — removes nothing when git left no review folder behind', () => {
  it('removes nothing when git left no review folder behind', async () => {
    const exec = vi.fn(async () => ({ stdout: '' }))
    expect(await ensureReviewWorktree(pr42(), { exec })).toBe(pr42Dir())
    expect(exec).not.toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['remove']),
      expect.anything()
    )
  })
})

describe('ensureReviewWorktree — an existing worktree', () => {
  it('reuses an existing worktree already at the head SHA without fetching or re-adding', async () => {
    mkdirSync(pr42Dir(), { recursive: true })
    const { exec } = recordingGit('abc1234def\n')

    const result = await ensureReviewWorktree(pr42(), { exec })

    expect(result).toBe(pr42Dir())
    expect(exec).not.toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['fetch']),
      expect.anything()
    )
    expect(exec).not.toHaveBeenCalledWith('git', expect.arrayContaining(['add']), expect.anything())
  })

  it('re-creates the worktree when the existing directory is at a different SHA', async () => {
    mkdirSync(pr42Dir(), { recursive: true })
    const { exec } = recordingGit('differentsha\n')

    await ensureReviewWorktree(pr42(), { exec })

    const addCall = exec.mock.calls.find((c) => c[1][0] === 'worktree' && c[1][1] === 'add')
    expect(addCall).toBeDefined()
  })
})

describe('ensureReviewWorktree — pruning', () => {
  it('keeps only the 5 most recently used review worktrees, pruning first then removing older ones', async () => {
    const base = join(repoRoot, '.git', 'terminator-review')
    const now = Date.now()
    for (let i = 0; i < 5; i++) {
      const d = join(base, `pr-${i}-0000000`)
      mkdirSync(d, { recursive: true })
      const t = new Date(now - (5 - i) * 60_000)
      utimesSync(d, t, t)
    }
    const { exec, removed } = recordingGit()

    await ensureReviewWorktree({ repoRoot, prNumber: 99, headSHA: 'newsha1234' }, { exec })

    // 6 dirs now exist (5 pre-seeded + the new one); the oldest must be removed.
    expect(removed).toEqual([join(base, 'pr-0-0000000')])
  })
})
