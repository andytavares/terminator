import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'
import { ensureReviewWorktree } from '../../src/review/worktree.js'

describe('ensureReviewWorktree', () => {
  let repoRoot: string

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'review-worktree-'))
  })

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true })
  })

  it('fetches the PR ref then adds a detached worktree at the head SHA, in order', async () => {
    const calls: { cmd: string; args: string[]; cwd?: string }[] = []
    const exec = vi.fn(async (cmd: string, args: string[], opts: { cwd?: string }) => {
      calls.push({ cmd, args, cwd: opts.cwd })
      if (args[0] === 'worktree' && args[1] === 'add') {
        mkdirSync(args[3], { recursive: true })
      }
      return { stdout: '' }
    })

    const dir = await ensureReviewWorktree(repoRoot, 42, 'abc1234def', { exec })

    expect(dir).toBe(join(repoRoot, '.git', 'terminator-review', 'pr-42-abc1234'))

    const relevant = calls.filter((c) => c.cmd === 'git' && c.args[0] !== 'worktree')
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
    void relevant
  })

  it('reuses an existing worktree already at the head SHA without fetching or re-adding', async () => {
    const dir = join(repoRoot, '.git', 'terminator-review', 'pr-42-abc1234')
    mkdirSync(dir, { recursive: true })

    const exec = vi.fn(async (_cmd: string, args: string[]) => {
      if (args[0] === 'rev-parse') return { stdout: 'abc1234def\n' }
      return { stdout: '' }
    })

    const result = await ensureReviewWorktree(repoRoot, 42, 'abc1234def', { exec })

    expect(result).toBe(dir)
    expect(exec).not.toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['fetch']),
      expect.anything()
    )
    expect(exec).not.toHaveBeenCalledWith('git', expect.arrayContaining(['add']), expect.anything())
  })

  it('re-creates the worktree when the existing directory is at a different SHA', async () => {
    const dir = join(repoRoot, '.git', 'terminator-review', 'pr-42-abc1234')
    mkdirSync(dir, { recursive: true })

    const exec = vi.fn(async (_cmd: string, args: string[]) => {
      if (args[0] === 'rev-parse') return { stdout: 'differentsha\n' }
      if (args[0] === 'worktree' && args[1] === 'add') return { stdout: '' }
      return { stdout: '' }
    })

    await ensureReviewWorktree(repoRoot, 42, 'abc1234def', { exec })

    const addCall = exec.mock.calls.find((c) => c[1][0] === 'worktree' && c[1][1] === 'add')
    expect(addCall).toBeDefined()
  })

  it('keeps only the 5 most recently used review worktrees, pruning first then removing older ones', async () => {
    const base = join(repoRoot, '.git', 'terminator-review')
    const now = Date.now()
    for (let i = 0; i < 5; i++) {
      const d = join(base, `pr-${i}-0000000`)
      mkdirSync(d, { recursive: true })
      const t = new Date(now - (5 - i) * 60_000)
      utimesSync(d, t, t)
    }

    const removed: string[] = []
    const exec = vi.fn(async (_cmd: string, args: string[]) => {
      if (args[0] === 'worktree' && args[1] === 'add') {
        mkdirSync(args[3], { recursive: true })
      }
      if (args[0] === 'worktree' && args[1] === 'remove') {
        removed.push(args[3])
      }
      return { stdout: '' }
    })

    await ensureReviewWorktree(repoRoot, 99, 'newsha1234', { exec })

    // 6 dirs now exist (5 pre-seeded + the new one); the oldest must be removed.
    expect(removed).toEqual([join(base, 'pr-0-0000000')])
  })
})

describe('ensureReviewWorktree against real git', () => {
  let dir: string
  // Scrub GIT_* so a hook's environment can never point these commands at the real repo.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') || k === 'GIT_TRACE2_EVENT')
  ) as NodeJS.ProcessEnv
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, env, encoding: 'utf-8' }).trim()

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'review-worktree-real-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('checks out the PR head GitHub publishes under pull/N/head, and reuses it', async () => {
    const origin = join(dir, 'origin')
    mkdirSync(origin)
    git(origin, 'init', '-q', '-b', 'main')
    git(
      origin,
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@t',
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      'base'
    )
    git(origin, 'checkout', '-q', '-b', 'feature')
    writeFileSync(join(origin, 'shard.ts'), 'export const shards = 2\n')
    git(origin, 'add', 'shard.ts')
    git(origin, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'feature')
    const head = git(origin, 'rev-parse', 'HEAD')
    git(origin, 'update-ref', 'refs/pull/212/head', head)
    const clone = join(dir, 'clone')
    execFileSync('git', ['clone', '-q', '-b', 'main', origin, clone], { env })

    const wt = await ensureReviewWorktree(clone, 212, head)
    expect(git(wt, 'rev-parse', 'HEAD')).toBe(head)
    expect(readFileSync(join(wt, 'shard.ts'), 'utf-8')).toContain('shards = 2')
    // The reviewer's own checkout is untouched.
    expect(git(clone, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main')

    expect(await ensureReviewWorktree(clone, 212, head)).toBe(wt)
  })
})
