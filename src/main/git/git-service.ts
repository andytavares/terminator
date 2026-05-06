import { execFile as execFileCb } from 'child_process'
import { promisify } from 'util'
import { join } from 'path'
import type { Branch, WorktreeInfo } from '../../shared/types/index.js'

const execFile = promisify(execFileCb)

const GIT_TIMEOUT = 10_000

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFile('git', args, {
    cwd,
    timeout: GIT_TIMEOUT,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
  return stdout.trim()
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
    if (!isRemote) localNames.add(name)
    all.push({ name, isCurrent, isRemote })
  }

  // deduplicate: drop remote branches that have a local equivalent
  return all.filter((b) => !b.isRemote || !localNames.has(b.name))
}

export async function checkoutBranch(dirPath: string, branch: string): Promise<void> {
  await git(['checkout', branch], dirPath)
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
        branch: branchLine
          ? branchLine.slice('branch refs/heads/'.length)
          : 'HEAD',
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
