import { join } from 'path'
import type { Branch, WorktreeInfo } from '../../shared/types/index.js'
import type { ChangeStats } from '../../shared/schemas/git.schema.js'
import { runTextCommand } from '../shell/command-runner.js'
import { GIT_ENV } from './git-env.js'

const GIT_TIMEOUT = 10_000
const FETCH_TIMEOUT = 60_000

/** Runs git and resolves with its trimmed stdout, or rejects with its stderr. Through
 * runTextCommand, so a git still running when the app quits is stopped with whatever it started
 * (stopRunningCommands). */
async function git(args: string[], cwd: string, timeoutMs = GIT_TIMEOUT): Promise<string> {
  const result = await runTextCommand({ command: 'git', args, cwd, timeoutMs }, GIT_ENV)
  if (result.exitCode !== 0) {
    throw new Error(`Command failed: git ${args.join(' ')}\n${result.stderr}`)
  }
  return result.stdout.trim()
}

/**
 * Uncommitted change volume for one working tree.
 *
 * `cwd` is the branch's own directory — its worktree path when it has one, the
 * repo root otherwise. Diffing against HEAD counts staged and unstaged work in
 * a single call, which is the number a sidebar row wants: "how much have I
 * changed on this branch". Untracked files are not counted, consistent with
 * `git diff` everywhere else in the app.
 */
export async function getChangeStats(cwd: string): Promise<ChangeStats> {
  let out: string
  try {
    // Without the refresh, a diff after a file is saved unchanged rewrites `.git/index`, which
    // the file watch reports (https://git-scm.com/docs/diff-config). The counts are the same.
    out = await git(['-c', 'diff.autoRefreshIndex=false', 'diff', '--numstat', 'HEAD'], cwd)
  } catch (err) {
    // A repository with no commits has no HEAD to diff against. That is an
    // empty tree, not a failure — every other error still propagates.
    if (err instanceof Error && /unknown revision|ambiguous argument/i.test(err.message)) {
      return { added: 0, removed: 0, files: 0 }
    }
    throw err
  }

  let added = 0
  let removed = 0
  let files = 0
  for (const line of out.split('\n')) {
    // <added>\t<removed>\t<path>. Binary files report '-' in both columns;
    // they are a changed file but contribute no line counts.
    const parts = line.split('\t')
    if (parts.length < 3) continue
    files += 1
    const a = Number(parts[0])
    const r = Number(parts[1])
    if (Number.isFinite(a)) added += a
    if (Number.isFinite(r)) removed += r
  }
  return { added, removed, files }
}

/** True or false only when git answered; rejects when it did not (timed out, never started, ended
 * by a signal). Git documents a nonzero exit outside a repository but no code or message, so any
 * nonzero answer means no (https://git-scm.com/docs/git-rev-parse). */
export async function isGitRepo(dirPath: string): Promise<boolean> {
  const result = await runTextCommand(
    { command: 'git', args: ['rev-parse', '--git-dir'], cwd: dirPath, timeoutMs: GIT_TIMEOUT },
    GIT_ENV
  )
  if (result.timedOut)
    throw new Error(`git rev-parse timed out after ${GIT_TIMEOUT} ms in ${dirPath}`)
  if (result.didNotRun) throw new Error(`git could not run in ${dirPath}: ${result.stderr.trim()}`)
  return result.exitCode === 0
}

export async function getGitRoot(dirPath: string): Promise<string> {
  return git(['rev-parse', '--show-toplevel'], dirPath)
}

export async function getCurrentBranch(dirPath: string): Promise<string> {
  const branch = await git(['branch', '--show-current'], dirPath)
  return branch || 'HEAD'
}

/** One line of `git branch --format=%(HEAD)|%(refname)` as a branch, or null for a ref no
 * configured remote owns, a remote's HEAD, or a pull ref. */
function branchFromRef(line: string, remotePrefixes: string[]): Branch | null {
  const [head, ref] = line.split('|')
  if (ref.startsWith('refs/heads/')) {
    return { name: ref.slice('refs/heads/'.length), isCurrent: head === '*', isRemote: false }
  }
  const prefix = remotePrefixes.find((p) => ref.startsWith(p))
  if (prefix === undefined) return null
  const name = ref.slice(prefix.length)
  if (name === 'HEAD' || name.startsWith('pull/')) return null
  return { name, isCurrent: false, isRemote: true }
}

/** Local branches, then each remote branch whose name nothing local or on another remote already
 * carries; git's checkout and worktree add resolve the bare name to it. */
function withoutShadowedRemotes(branches: Branch[]): Branch[] {
  const local = branches.filter((b) => !b.isRemote)
  const seen = new Set(local.map((b) => b.name))
  const remote = branches.filter((b) => {
    if (!b.isRemote || seen.has(b.name)) return false
    seen.add(b.name)
    return true
  })
  return [...local, ...remote]
}

export async function listBranches(dirPath: string): Promise<Branch[]> {
  // Full refnames: `refname:short` prints a remote-tracking branch as
  // `origin/main`, indistinguishable from a local branch with a slash in it.
  const [output, remotes] = await Promise.all([
    git(['branch', '-a', '--sort=-committerdate', '--format=%(HEAD)|%(refname)'], dirPath),
    git(['remote'], dirPath),
  ])
  // Only refs under a configured remote: a repo can carry stray
  // refs/remotes/pull/<n>/head from a one-off fetch, which no remote owns.
  const prefixes = remotes
    .split('\n')
    .filter(Boolean)
    .map((r) => `refs/remotes/${r}/`)
  const branches = output
    .split('\n')
    .filter(Boolean)
    .map((line) => branchFromRef(line, prefixes))
    .filter((branch): branch is Branch => branch !== null)
  return withoutShadowedRemotes(branches)
}

export async function fetchRemotes(dirPath: string): Promise<void> {
  await git(['fetch', '--all', '--prune'], dirPath, FETCH_TIMEOUT)
}

export async function checkoutBranch(dirPath: string, branch: string): Promise<void> {
  await git(['checkout', branch], dirPath)
}

export async function createBranch(dirPath: string, branch: string): Promise<void> {
  await git(['checkout', '-b', branch], dirPath)
}

export async function listWorktrees(dirPath: string): Promise<WorktreeInfo[]> {
  const output = await git(['worktree', 'list', '--porcelain'], dirPath)
  const worktrees: WorktreeInfo[] = []
  const blocks = output.split('\n\n').filter(Boolean)

  for (let i = 0; i < blocks.length; i++) {
    const lines = blocks[i].split('\n')
    const wtLine = lines.find((l) => l.startsWith('worktree '))
    const headLine = lines.find((l) => l.startsWith('HEAD '))
    const branchLine = lines.find((l) => l.startsWith('branch '))
    if (wtLine) {
      worktrees.push({
        path: wtLine.slice('worktree '.length),
        branch: branchLine ? branchLine.slice('branch refs/heads/'.length) : 'HEAD',
        isMain: i === 0,
        head: headLine ? headLine.slice('HEAD '.length) : '',
        detached: lines.includes('detached'),
        prunable: lines.some((l) => l.startsWith('prunable ')),
      })
    }
  }
  return worktrees
}

/** Returns the default suggested path for a new worktree.
 *  Defaults to <repoRoot>/.worktrees/<safe-branch>; pass baseDir to override. */
export function suggestWorktreePath(repoRoot: string, branch: string, baseDir?: string): string {
  const safeBranch = branch.replace(/[/\\: ]/g, '-')
  const dir = baseDir ?? join(repoRoot, '.worktrees')
  return join(dir, safeBranch)
}

export interface CreateWorktreeRequest {
  repoRoot: string
  worktreePath: string
  branch: string
  /** Create `branch` with the worktree, rather than check out one that exists. */
  isNewBranch: boolean
}

export async function createWorktree({
  repoRoot,
  worktreePath,
  branch,
  isNewBranch,
}: CreateWorktreeRequest): Promise<void> {
  if (isNewBranch) {
    await git(['worktree', 'add', '-b', branch, worktreePath], repoRoot)
  } else {
    await git(['worktree', 'add', worktreePath, branch], repoRoot)
  }
}

export async function removeWorktree(repoRoot: string, worktreePath: string): Promise<void> {
  await git(['worktree', 'remove', '--force', worktreePath], repoRoot)
}
