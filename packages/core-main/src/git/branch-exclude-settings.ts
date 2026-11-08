import { getGlobalSettings, getWorkspaceSettings } from '../storage/settings-store.js'
import { workspaceFolders } from '../storage/workspace-folders.js'
import { workspaceOwning } from '../extensions/setting-scope.js'

/**
 * Settings → Git → Branch Exclude Patterns for the workspace that owns `path`,
 * else the global list. Without a path, the global list.
 */
export function branchExcludePatternsFor(path?: string): string[] {
  const owner = path === undefined ? undefined : workspaceOwning(path, workspaceFolders())
  const override =
    owner === undefined
      ? undefined
      : getWorkspaceSettings(owner).overrides?.git?.branchExcludePatterns
  return override ?? getGlobalSettings().git.branchExcludePatterns
}
