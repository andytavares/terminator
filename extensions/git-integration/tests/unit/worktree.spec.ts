import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, readFileSync, rmSync, utimesSync } from 'fs'
import { execFileSync } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'
import { ensureReviewWorktree } from '../../src/review/worktree.js'
import { bindRealShell } from './support/shell'
import { makeTempDir } from '../../../../tests/support/temp-dir'

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

// Scrub GIT_* so a hook's environment can never point these commands at the real repo.
const scrubbedGitEnv = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') || k === 'GIT_TRACE2_EVENT')
) as NodeJS.ProcessEnv

const git = (cwd: string, args: string[], input?: string) =>
  execFileSync('git', args, { cwd, env: scrubbedGitEnv, input, encoding: 'utf-8' }).trim()

/** fast-import input: an empty `main`, a PR head adding shard.ts, then the head's SHA on stdout. */
function pullRequestStream(): string {
  const fastImportData = (text: string) => `data ${Buffer.byteLength(text)}\n${text}\n`
  const signature = 'Reviewer <reviewer@example.com> 1700000000 +0000'
  const fastImportCommit = (ref: string, mark: number, message: string) =>
    `commit ${ref}\nmark :${mark}\nauthor ${signature}\ncommitter ${signature}\n${fastImportData(message)}`
  return [
    `blob\nmark :1\n${fastImportData('export const shards = 2\n')}`,
    fastImportCommit('refs/heads/main', 2, 'base'),
    `${fastImportCommit('refs/pull/212/head', 3, 'feature')}from :2\nM 100644 :1 shard.ts\n`,
    'get-mark :3\n',
  ].join('')
}

/** The origin GitHub would be: `main`, and the PR head under pull/212/head, written by one
 *  `git fast-import` (https://git-scm.com/docs/git-fast-import), which signs no commit (a gpgSign
 *  signer took 80-180 ms each), runs no hook and, with fixed dates, gives the same SHAs. */
function originWithPullRequest(): { origin: string; head: string } {
  const origin = join(makeTempDir('review-worktree-origin-'), 'origin.git')
  git(tmpdir(), ['init', '-q', '--bare', '-b', 'main', origin])
  return { origin, head: git(origin, ['fast-import', '--quiet'], pullRequestStream()) }
}

/** A checkout with `origin` set, which is all the fetch needs; `git clone` took 30-290 ms on a busy
 *  machine for the same. */
function checkoutOf(origin: string, dir: string): string {
  const checkout = join(dir, 'checkout')
  git(dir, ['init', '-q', '-b', 'main', checkout])
  git(checkout, ['remote', 'add', 'origin', origin])
  return checkout
}

describe('ensureReviewWorktree against real git', () => {
  let dir: string
  let origin: string
  let head: string

  beforeAll(() => {
    ;({ origin, head } = originWithPullRequest())
  })

  beforeEach(() => {
    dir = makeTempDir('review-worktree-real-')
    bindRealShell(scrubbedGitEnv)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('checks out the PR head GitHub publishes under pull/N/head, and reuses it', async () => {
    const checkout = checkoutOf(origin, dir)
    const pr = { repoRoot: checkout, prNumber: 212, headSHA: head }

    const wt = await ensureReviewWorktree(pr)
    expect(git(wt, ['rev-parse', 'HEAD'])).toBe(head)
    expect(readFileSync(join(wt, 'shard.ts'), 'utf-8')).toContain('shards = 2')
    // The reviewer's own checkout is untouched.
    expect(git(checkout, ['symbolic-ref', '--short', 'HEAD'])).toBe('main')

    expect(await ensureReviewWorktree(pr)).toBe(wt)
  })

  // A running review's "Continue in terminal" asks for the worktree while the
  // run's own call may still be creating it (a slow git, as on macOS CI). The
  // second call must get that same worktree, not race `git worktree add` into it.
  it('gives a call made while the worktree is being created that same worktree', async () => {
    const pr = { repoRoot: checkoutOf(origin, dir), prNumber: 212, headSHA: head }

    const [first, second] = await Promise.all([ensureReviewWorktree(pr), ensureReviewWorktree(pr)])

    expect(second).toBe(first)
    expect(git(second, ['rev-parse', 'HEAD'])).toBe(head)
  })
})
