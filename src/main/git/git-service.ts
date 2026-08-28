import { execFile as execFileCb } from 'child_process'
import { promisify } from 'util'
import { join } from 'path'
import type { Branch, WorktreeInfo } from '../../shared/types/index.js'
import type { GitStatus, FileDiff, ChangeStats } from '../../shared/schemas/git.schema.js'
import { parseStatus, parseDiff } from './git-parser.js'
import { GIT_ENV } from './git-env.js'

const execFile = promisify(execFileCb)

const GIT_TIMEOUT = 10_000
const DIFF_MAX_BYTES = 500 * 1024

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFile('git', args, {
    cwd,
    timeout: GIT_TIMEOUT,
    env: GIT_ENV,
  })
  return stdout.trim()
}

export async function getStatus(repoRoot: string, maxFiles: number = 500): Promise<GitStatus> {
  const [statusOut, branch] = await Promise.all([
    execFile('git', ['status', '--porcelain=v1', '-z'], {
      cwd: repoRoot,
      timeout: GIT_TIMEOUT,
      env: GIT_ENV,
    }).then(({ stdout }) => stdout),
    git(['branch', '--show-current'], repoRoot).catch(() => 'HEAD'),
  ])
  const partial = parseStatus(statusOut, maxFiles)
  return { ...partial, branch: branch || 'HEAD' }
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
    out = await git(['diff', '--numstat', 'HEAD'], cwd)
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

export async function getDiff(
  repoRoot: string,
  filePath: string,
  staged: boolean
): Promise<FileDiff> {
  const args = staged
    ? ['diff', '--cached', '--unified=3', '--', filePath]
    : ['diff', '--unified=3', '--', filePath]

  const { stdout } = await execFile('git', args, {
    cwd: repoRoot,
    timeout: GIT_TIMEOUT,
    maxBuffer: DIFF_MAX_BYTES + 1024,
    env: GIT_ENV,
  })
  return { ...parseDiff(stdout, DIFF_MAX_BYTES), path: filePath }
}

export async function stageFiles(repoRoot: string, paths: string[]): Promise<void> {
  await git(['add', '--', ...paths], repoRoot)
}

export async function unstageFiles(repoRoot: string, paths: string[]): Promise<void> {
  await git(['restore', '--staged', '--', ...paths], repoRoot)
}

export async function commitChanges(
  repoRoot: string,
  message: string,
  signOff: boolean = false
): Promise<string> {
  const args = ['commit', '-m', message]
  if (signOff) args.push('--signoff')
  const output = await git(args, repoRoot)
  // Extract short hash from output like "[main abc1234] message"
  const match = output.match(/\[[\w/]+ ([a-f0-9]+)\]/)
  return match?.[1] ?? ''
}

export async function isGitRepo(dirPath: string): Promise<boolean> {
  try {
    await git(['rev-parse', '--git-dir'], dirPath)
    return true
  } catch {
    return false
  }
}

export async function getGitRoot(dirPath: string): Promise<string> {
  return git(['rev-parse', '--show-toplevel'], dirPath)
}

export async function getCurrentBranch(dirPath: string): Promise<string> {
  const branch = await git(['branch', '--show-current'], dirPath)
  return branch || 'HEAD'
}

export async function listBranches(dirPath: string): Promise<Branch[]> {
  const output = await git(
    ['branch', '-a', '--sort=-committerdate', '--format=%(HEAD)|%(refname:short)'],
    dirPath
  )
  const localNames = new Set<string>()
  const all: Branch[] = []

  for (const line of output.split('\n').filter(Boolean)) {
    const [head, ref] = line.split('|')
    const isCurrent = head.trim() === '*'
    const isRemote = ref.startsWith('remotes/')
    const name = isRemote ? ref.replace(/^remotes\/[^/]+\//, '') : ref.trim()
    if (name === 'HEAD') continue
    if (name.startsWith('pull/')) continue
    if (!isRemote) localNames.add(name)
    all.push({ name, isCurrent, isRemote })
  }

  // deduplicate: drop remote branches that have a local equivalent
  return all.filter((b) => !b.isRemote || !localNames.has(b.name))
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

export async function createWorktree(
  repoRoot: string,
  worktreePath: string,
  branch: string,
  isNewBranch: boolean
): Promise<void> {
  if (isNewBranch) {
    await git(['worktree', 'add', '-b', branch, worktreePath], repoRoot)
  } else {
    await git(['worktree', 'add', worktreePath, branch], repoRoot)
  }
}

export async function removeWorktree(repoRoot: string, worktreePath: string): Promise<void> {
  await git(['worktree', 'remove', '--force', worktreePath], repoRoot)
}
