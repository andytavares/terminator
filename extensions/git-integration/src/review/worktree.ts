import { existsSync, readdirSync, statSync, utimesSync } from 'fs'
import { join } from 'path'
import { runGit } from '../shell/run-git.js'
import type { PrHead } from '../schemas/pr-review.schema.js'

const DEFAULT_MAX_WORKTREES = 5

export interface ExecFn {
  (cmd: 'git', args: string[], opts: { cwd: string }): Promise<{ stdout: string }>
}

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

/** Whether `dir` is a worktree checked out at `headSHA`. */
async function isCheckedOutAt(dir: string, headSHA: string, exec: ExecFn): Promise<boolean> {
  if (!existsSync(dir)) return false
  try {
    const { stdout } = await exec('git', ['rev-parse', 'HEAD'], { cwd: dir })
    return stdout.trim() === headSHA
  } catch {
    // dir exists but isn't a valid worktree at this SHA — it is recreated
    return false
  }
}

async function addWorktreeAt(head: PrHead, dir: string, exec: ExecFn): Promise<void> {
  const { repoRoot, prNumber, headSHA } = head
  const ref = `pull/${prNumber}/head:refs/terminator/review/${prNumber}/${headSHA}`
  await exec('git', ['fetch', 'origin', ref], { cwd: repoRoot })
  await exec('git', ['worktree', 'add', '--detach', dir, headSHA], { cwd: repoRoot })
}

/**
 * Ensures a detached git worktree exists at the PR head, reusing one already
 * checked out at that SHA and keeping only the most recently used few around.
 */
export async function ensureReviewWorktree(head: PrHead, deps: WorktreeDeps = {}): Promise<string> {
  const exec = deps.exec ?? defaultExec
  const { repoRoot } = head
  const dir = worktreeDir(repoRoot, head.prNumber, head.headSHA)
  await exec('git', ['worktree', 'prune'], { cwd: repoRoot }).catch(() => {})
  if (!(await isCheckedOutAt(dir, head.headSHA, exec))) await addWorktreeAt(head, dir, exec)
  markUsed(dir)
  await pruneOldWorktrees(repoRoot, exec, deps.maxWorktrees ?? DEFAULT_MAX_WORKTREES)
  return dir
}
