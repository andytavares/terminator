import type { WorkOrder } from '../order/schema.js'

// One project per order, per repository (spec 061, ADR-061).
//
// Every session of an order runs in its lane checkout, and `createProject`
// reuses the project already pointing at a directory — so the checkout path
// is what makes it one project. What this file adds is where that project
// lives, which ticket it carries, and how it goes away again.

interface WorkspaceRef {
  readonly id: string
  readonly folderPath: string
}

interface ProjectRef {
  readonly id: string
  readonly worktreePath?: string
}

const trimmed = (p: string): string => p.replace(/\/+$/, '')

/**
 * The workspace a repository's projects belong under.
 *
 * The first workspace in the sidebar used to be the answer for every order,
 * whatever repository it was about. It is still the fallback, for a repository
 * nobody has added as a workspace.
 */
export function workspaceFor(workspaces: readonly WorkspaceRef[], repoPath: string): string {
  const own = workspaces.find((w) => trimmed(w.folderPath) === trimmed(repoPath))
  return own?.id ?? workspaces[0]?.id ?? ''
}

/** The ticket the project is for, when the order was seeded from one. */
export function issueOf(order: WorkOrder): { tracker: 'linear' | 'jira'; key: string } | undefined {
  const { tracker, key } = order.source
  return tracker === null || key === null ? undefined : { tracker, key }
}

/** Deletes whichever project points at a checkout. True when one did. */
export function projectRemover(workspace: {
  list(): readonly WorkspaceRef[]
  listProjects(workspaceId: string): readonly ProjectRef[]
  deleteProject(projectId: string): void
}): (worktreePath: string) => boolean {
  return (worktreePath) => {
    const target = trimmed(worktreePath)
    const found = workspace
      .list()
      .flatMap((w) => workspace.listProjects(w.id))
      .find((p) => p.worktreePath !== undefined && trimmed(p.worktreePath) === target)
    if (found === undefined) return false
    workspace.deleteProject(found.id)
    return true
  }
}
