import { execFile as execFileCb } from 'child_process'
import { promisify } from 'util'
import { existsSync, readdirSync, statSync, utimesSync } from 'fs'
import { join } from 'path'

const execFileAsync = promisify(execFileCb)

const GIT_TIMEOUT = 30_000
const DEFAULT_MAX_WORKTREES = 5

export type ExecFn = (
  cmd: string,
  args: string[],
  opts: { cwd?: string }
) => Promise<{ stdout: string }>

export interface WorktreeDeps {
  exec?: ExecFn
  /** How many review worktrees to keep around; oldest by last-used are removed beyond this. */
  maxWorktrees?: number
}

async function defaultExec(cmd: string, args: string[], opts: { cwd?: string }) {
  return execFileAsync(cmd, args, {
    cwd: opts.cwd,
    timeout: GIT_TIMEOUT,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
}

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

/**
 * Ensures a detached git worktree exists at the PR head, reusing one already
 * checked out at that SHA and keeping only the most recently used few around.
 */
export async function ensureReviewWorktree(
  repoRoot: string,
  prNumber: number,
  headSHA: string,
  deps: WorktreeDeps = {}
): Promise<string> {
  const exec = deps.exec ?? defaultExec
  const maxWorktrees = deps.maxWorktrees ?? DEFAULT_MAX_WORKTREES
  const dir = worktreeDir(repoRoot, prNumber, headSHA)

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
