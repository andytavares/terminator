import { parseWorktreePorcelain } from './local-inventory.js'

// The Worktrees tab's removals: each item's worktree first, then its branch,
// and one `git worktree prune` at the end.

export interface RemoveItem {
  branch: string | null
  worktreePath: string | null
  forceWorktree: boolean
  forceBranch: boolean
}

export interface RemoveResult {
  branch: string | null
  worktreePath: string | null
  ok: boolean
  reason?: string
}

/** The part of the shell removeLocalItems needs. */
export interface RemoveShell {
  exec(cwd: string, args: string[]): Promise<string>
  listProjects(): Promise<Array<{ id: string; name: string; worktreePath?: string }>>
  deleteProject(projectId: string): void
}

interface RemoveContext {
  repoRoot: string
  shell: RemoveShell
  mainWorktree: string
  currentBranch: string
}

/** The worktree and branch removals of one item, in that order. */
async function runRemoval({ repoRoot, shell }: RemoveContext, item: RemoveItem): Promise<void> {
  if (item.worktreePath !== null) {
    const force = item.forceWorktree ? ['--force'] : []
    await shell.exec(repoRoot, ['worktree', 'remove', ...force, item.worktreePath])
  }
  if (item.branch !== null)
    await shell.exec(repoRoot, ['branch', item.forceBranch ? '-D' : '-d', item.branch])
}

async function removeOne(context: RemoveContext, item: RemoveItem): Promise<RemoveResult> {
  const base = { branch: item.branch, worktreePath: item.worktreePath }
  if (item.worktreePath !== null && item.worktreePath === context.mainWorktree)
    return { ...base, ok: false, reason: 'main worktree' }
  if (item.branch !== null && item.branch === context.currentBranch)
    return { ...base, ok: false, reason: 'current branch' }
  try {
    await runRemoval(context, item)
  } catch (error) {
    return { ...base, ok: false, reason: errorMessage(error) }
  }
  return { ...base, ok: true }
}

/** Git's own message, without the wrapper runGit adds. */
function errorMessage(error: unknown): string {
  if (error instanceof Error && 'stderr' in error && typeof error.stderr === 'string')
    return error.stderr.trim() || error.message
  return error instanceof Error ? error.message : String(error)
}

/** Removes the given worktrees and branches, then prunes once. */
export async function removeLocalItems(
  repoRoot: string,
  shell: RemoveShell,
  items: RemoveItem[]
): Promise<{ results: RemoveResult[] }> {
  const porcelain = await shell.exec(repoRoot, ['worktree', 'list', '--porcelain'])
  const context: RemoveContext = {
    repoRoot,
    shell,
    mainWorktree: parseWorktreePorcelain(porcelain)[0]?.path ?? repoRoot,
    currentBranch: (await shell.exec(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim(),
  }
  const results: RemoveResult[] = []
  for (const item of items) results.push(await removeOne(context, item))
  await shell.exec(repoRoot, ['worktree', 'prune']).catch(() => '')
  await deleteProjectsOf(shell, results)
  return { results }
}

/** The sidebar card of a worktree that was removed goes too. */
async function deleteProjectsOf(shell: RemoveShell, results: RemoveResult[]): Promise<void> {
  const removedPaths = results
    .filter((r) => r.ok && r.worktreePath !== null)
    .map((r) => r.worktreePath as string)
  if (removedPaths.length === 0) return
  for (const project of await shell.listProjects()) {
    if (project.worktreePath && removedPaths.includes(project.worktreePath))
      shell.deleteProject(project.id)
  }
}
