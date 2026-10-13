import { existsSync, readdirSync, statSync, utimesSync } from 'fs'
import { join } from 'path'
import { runGit } from '../shell/run-git.js'

const DEFAULT_MAX_WORKTREES = 5

type ExecFn = (cmd: 'git', args: string[], opts: { cwd: string }) => Promise<{ stdout: string }>

export interface WorktreeDeps {
  exec?: ExecFn
  /** How many review worktrees to keep around; oldest by last-used are removed beyond this. */
  maxWorktrees?: number
}

const defaultExec: ExecFn = async (_cmd, args, opts) => ({
  stdout: await runGit(opts.cwd, args, { raw: true }),
})

function reviewBaseDir(repoRoot: string): string {
  return join(repoRoot, '.git', 'terminator-review')
}

function worktreeDir(repoRoot: string, prNumber: number, headSHA: string): string {
  return join(reviewBaseDir(repoRoot), `pr-${prNumber}-${headSHA.slice(0, 7)}`)
}

function markUsed(dir: string): void {
  try {
    const now = new Date()
    utimesSync(dir, now, now)
  } catch {
    // best-effort — a missed mtime bump only affects prune ordering
  }
}

async function pruneOldWorktrees(repoRoot: string, exec: ExecFn, max: number): Promise<void> {
  const base = reviewBaseDir(repoRoot)
  if (!existsSync(base)) return
  const entries = readdirSync(base)
    .map((name) => join(base, name))
    .filter((p) => {
      try {
        return statSync(p).isDirectory()
      } catch {
        return false
      }
    })
    .map((p) => ({ path: p, mtime: statSync(p).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)

  const stale = entries.slice(max)
  for (const entry of stale) {
    await exec('git', ['worktree', 'remove', '--force', entry.path], { cwd: repoRoot }).catch(
      () => {}
    )
  }
}

interface ReviewCheckout {
  repoRoot: string
  prNumber: number
  headSHA: string
  dir: string
}

// The worktree each in-flight call is preparing, by directory.
const preparing = new Map<string, Promise<string>>()

/**
 * Ensures a detached git worktree exists at the PR head, reusing one already
 * checked out at that SHA and keeping only the most recently used few around.
 * A call made while another is still preparing the same worktree (a running
 * review's "Continue in terminal") waits for it instead of racing `git worktree add`.
 */
export function ensureReviewWorktree(
  repoRoot: string,
  prNumber: number,
  headSHA: string,
  deps: WorktreeDeps = {}
): Promise<string> {
  const dir = worktreeDir(repoRoot, prNumber, headSHA)
  const inFlight = preparing.get(dir)
  if (inFlight) return inFlight
  const ready = prepareWorktree({ repoRoot, prNumber, headSHA, dir }, deps).finally(() =>
    preparing.delete(dir)
  )
  preparing.set(dir, ready)
  return ready
}

async function prepareWorktree(checkout: ReviewCheckout, deps: WorktreeDeps): Promise<string> {
  const { repoRoot, prNumber, headSHA, dir } = checkout
  const exec = deps.exec ?? defaultExec
  const maxWorktrees = deps.maxWorktrees ?? DEFAULT_MAX_WORKTREES

  await exec('git', ['worktree', 'prune'], { cwd: repoRoot }).catch(() => {})

  if (existsSync(dir)) {
    try {
      const { stdout } = await exec('git', ['rev-parse', 'HEAD'], { cwd: dir })
      if (stdout.trim() === headSHA) {
        markUsed(dir)
        await pruneOldWorktrees(repoRoot, exec, maxWorktrees)
        return dir
      }
    } catch {
      // dir exists but isn't a valid worktree at this SHA — recreate below
    }
  }

  await exec(
    'git',
    ['fetch', 'origin', `pull/${prNumber}/head:refs/terminator/review/${prNumber}/${headSHA}`],
    { cwd: repoRoot }
  )
  await exec('git', ['worktree', 'add', '--detach', dir, headSHA], { cwd: repoRoot })
  markUsed(dir)
  await pruneOldWorktrees(repoRoot, exec, maxWorktrees)
  return dir
}
