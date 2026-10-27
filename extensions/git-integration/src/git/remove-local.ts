import type { WorktreeEntry } from './local-inventory.js'

// The Worktrees tab's removals: each item's worktree first, then its branch,
// and one `git worktree prune` at the end.

export interface RemoveItem {
  branch: string | null
  worktreePath: string | null
  forceBranch: boolean
}

export interface RemoveResult {
  branch: string | null
  worktreePath: string | null
  ok: boolean
  reason?: string
}

interface ShellProject {
  id: string
  name: string
  worktreePath?: string
}

/** A terminal that is open: where it runs and the project card it belongs to. */
interface ShellSession {
  cwd: string
  projectId?: string
}

/** The part of the shell removeLocalItems needs. */
export interface RemoveShell {
  exec(cwd: string, args: string[]): Promise<string>
  listWorktrees(repoRoot: string): Promise<WorktreeEntry[]>
  listProjects(): Promise<ShellProject[]>
  listSessions(): Promise<ShellSession[]>
  deleteProject(projectId: string): void
}

interface RemoveContext {
  repoRoot: string
  shell: RemoveShell
  mainWorktree: string
  currentBranch: string
  projects: ShellProject[]
  sessions: ShellSession[]
  /** Worktree folders git removed, whether or not the branch delete after them succeeded. */
  removedWorktrees: string[]
}

/** Whether a terminal is open in the worktree, by where it runs or by its project card. */
function hasOpenSession(context: RemoveContext, worktreePath: string): boolean {
  const cardIds = context.projects.filter((p) => p.worktreePath === worktreePath).map((p) => p.id)
  return context.sessions.some(
    (session) =>
      session.cwd === worktreePath ||
      session.cwd.startsWith(`${worktreePath}/`) ||
      (session.projectId !== undefined && cardIds.includes(session.projectId))
  )
}

/** Why an item must not be removed, or null when it may be. */
function refusalOf(context: RemoveContext, item: RemoveItem): string | null {
  const { worktreePath, branch } = item
  if (worktreePath !== null && worktreePath === context.mainWorktree) return 'main worktree'
  if (branch !== null && branch === context.currentBranch) return 'current branch'
  if (worktreePath !== null && hasOpenSession(context, worktreePath)) return 'open session'
  return null
}

/** The worktree and branch removals of one item, in that order. */
async function runRemoval(context: RemoveContext, item: RemoveItem): Promise<void> {
  const { repoRoot, shell } = context
  if (item.worktreePath !== null) {
    await shell.exec(repoRoot, ['worktree', 'remove', item.worktreePath])
    context.removedWorktrees.push(item.worktreePath)
  }
  if (item.branch !== null)
    await shell.exec(repoRoot, ['branch', item.forceBranch ? '-D' : '-d', item.branch])
}

async function removeOne(context: RemoveContext, item: RemoveItem): Promise<RemoveResult> {
  const base = { branch: item.branch, worktreePath: item.worktreePath }
  const refusal = refusalOf(context, item)
  if (refusal !== null) return { ...base, ok: false, reason: refusal }
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

async function contextFor(repoRoot: string, shell: RemoveShell): Promise<RemoveContext> {
  const worktrees = await shell.listWorktrees(repoRoot)
  return {
    repoRoot,
    shell,
    mainWorktree: worktrees[0]?.path ?? repoRoot,
    currentBranch: (await shell.exec(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim(),
    projects: await shell.listProjects(),
    sessions: await shell.listSessions(),
    removedWorktrees: [],
  }
}

/** Removes the given worktrees and branches, then prunes once. */
export async function removeLocalItems(
  repoRoot: string,
  shell: RemoveShell,
  items: RemoveItem[]
): Promise<{ results: RemoveResult[] }> {
  const context = await contextFor(repoRoot, shell)
  const results: RemoveResult[] = []
  for (const item of items) results.push(await removeOne(context, item))
  await shell.exec(repoRoot, ['worktree', 'prune']).catch(() => '')
  deleteProjectsOf(context)
  return { results }
}

/** The sidebar card of every worktree git removed goes too, even when its branch stayed. */
function deleteProjectsOf({ shell, projects, removedWorktrees }: RemoveContext): void {
  for (const project of projects) {
    if (project.worktreePath && removedWorktrees.includes(project.worktreePath))
      shell.deleteProject(project.id)
  }
}
