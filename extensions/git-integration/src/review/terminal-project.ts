import { canonical } from '../ipc/repo-root.js'

interface Workspaces {
  list(): Array<{ id: string; folderPath: string }>
  listProjects(workspaceId: string): Array<{ id: string; worktreePath?: string | null }>
}

/**
 * The branch whose checkout is `repoRoot`, compared after realpath: a project
 * records git's top level (the real path) while the view names the workspace's
 * folder, and on macOS /var and /tmp are symlinks into /private.
 */
export function projectForCheckout(workspaces: Workspaces, repoRoot: string): string | undefined {
  const target = canonical(repoRoot)
  for (const workspace of workspaces.list()) {
    const match = workspaces
      .listProjects(workspace.id)
      .find((p) => canonical(p.worktreePath ?? workspace.folderPath) === target)
    if (match) return match.id
  }
  return undefined
}
