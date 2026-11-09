import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { readFileSync, rmSync } from 'fs'
import { execFileSync } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'
import { ensureReviewWorktree } from '../../src/review/worktree.js'
import { bindRealShell } from '../unit/support/shell'
import { GIT_FREE_ENV } from '../unit/support/git-repo'
import { makeTempDir } from '../../../../packages/test-support/src/temp-dir'

const git = (cwd: string, args: string[], input?: string) =>
  execFileSync('git', args, { cwd, env: GIT_FREE_ENV, input, encoding: 'utf-8' }).trim()

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
    bindRealShell(GIT_FREE_ENV)
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
