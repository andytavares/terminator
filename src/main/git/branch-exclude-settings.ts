import { isAbsolute, relative } from 'node:path'
import { getGlobalSettings, getWorkspaceSettings } from '../storage/settings-store.js'
import { listProjects, listWorkspaces } from '../storage/workspace-store.js'

function isWithin(target: string, folder: string): boolean {
  const rel = relative(folder, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * Settings → Git → Branch Exclude Patterns for the workspace that owns `path`,
 * else the global list. A worktree under a custom base directory sits outside
 * its workspace's folder, so a project's own worktree path also counts.
 * Without a path, the global list.
 */
export function branchExcludePatternsFor(path?: string): string[] {
  const owner =
    path === undefined
      ? undefined
      : listWorkspaces().find(
          (ws) =>
            isWithin(path, ws.folderPath) ||
            listProjects(ws.id).some(
              (p) => p.worktreePath !== undefined && isWithin(path, p.worktreePath)
            )
        )
  const override =
    owner === undefined
      ? undefined
      : getWorkspaceSettings(owner.id).overrides?.git?.branchExcludePatterns
  return override ?? getGlobalSettings().git?.branchExcludePatterns ?? []
}
