import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, readFileSync, rmSync, utimesSync } from 'fs'
import { execFileSync } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'
import { ensureReviewWorktree } from '../../src/review/worktree.js'
import { bindRealShell } from './support/shell'
import { makeTempDir } from '../../../../tests/support/temp-dir'

describe('ensureReviewWorktree', () => {
  let repoRoot: string

  beforeEach(() => {
    repoRoot = makeTempDir('review-worktree-')
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
  const git = (cwd: string, args: string[], input?: string) =>
    execFileSync('git', args, { cwd, env, input, encoding: 'utf-8' }).trim()

  // The origin GitHub would be: `main`, and the PR head GitHub publishes under
  // pull/212/head. Written once per file by one `git fast-import`, which signs no
  // commit (the operator's commit.gpgSign signer took 80-180 ms a commit), runs
  // no hook and, with fixed dates, gives the same SHAs every run.
  // https://git-scm.com/docs/git-fast-import
  let origin: string
  let head: string
  beforeAll(() => {
    origin = join(makeTempDir('review-worktree-origin-'), 'origin.git')
    git(tmpdir(), ['init', '-q', '--bare', '-b', 'main', origin])
    head = git(origin, ['fast-import', '--quiet'], pullRequestStream())
  })

  beforeEach(() => {
    dir = makeTempDir('review-worktree-real-')
    bindRealShell(env)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('checks out the PR head GitHub publishes under pull/N/head, and reuses it', async () => {
    // A checkout with `origin` set, which is all the fetch needs; `git clone` took
    // 30-290 ms on a busy machine for the same.
    const checkout = join(dir, 'checkout')
    git(dir, ['init', '-q', '-b', 'main', checkout])
    git(checkout, ['remote', 'add', 'origin', origin])

    const wt = await ensureReviewWorktree(checkout, 212, head)
    expect(git(wt, ['rev-parse', 'HEAD'])).toBe(head)
    expect(readFileSync(join(wt, 'shard.ts'), 'utf-8')).toContain('shards = 2')
    // The reviewer's own checkout is untouched.
    expect(git(checkout, ['symbolic-ref', '--short', 'HEAD'])).toBe('main')

    expect(await ensureReviewWorktree(checkout, 212, head)).toBe(wt)
  })
})

/** fast-import input: an empty `main`, a PR head adding shard.ts, then the head's SHA on stdout. */
function pullRequestStream(): string {
  const data = (text: string) => `data ${Buffer.byteLength(text)}\n${text}\n`
  const signature = 'Reviewer <reviewer@example.com> 1700000000 +0000'
  const commit = (ref: string, mark: number, message: string) =>
    `commit ${ref}\nmark :${mark}\nauthor ${signature}\ncommitter ${signature}\n${data(message)}`
  return [
    `blob\nmark :1\n${data('export const shards = 2\n')}`,
    commit('refs/heads/main', 2, 'base'),
    `${commit('refs/pull/212/head', 3, 'feature')}from :2\nM 100644 :1 shard.ts\n`,
    'get-mark :3\n',
  ].join('')
}
