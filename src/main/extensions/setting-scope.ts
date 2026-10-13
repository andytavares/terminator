import { isAbsolute, relative } from 'node:path'

/** Every stored extension setting: the global values by key, and the values a workspace sets for
 * itself (`workspaceScoped` settings) by workspace id, then extension id, then key. */
export interface ExtensionSettingsSnapshot {
  global: Record<string, unknown>
  workspaces: Record<string, Record<string, Record<string, unknown>>>
}

/** The workspaces and their projects' worktrees, as far as path ownership needs them. */
export interface WorkspaceFolders {
  workspaces: ReadonlyArray<{ id: string; folderPath: string }>
  projects: Record<string, ReadonlyArray<{ worktreePath?: string }>>
}

/** One setting read for one extension, at a path when the caller has one. */
export interface ScopedSettingRead {
  extensionId: string
  key: string
  repoPath?: string
}

function isWithin(target: string, folder: string): boolean {
  const rel = relative(folder, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** The workspace that owns `path`: its folder holds it, or one of its projects' worktrees does
 * (a worktree under a custom base directory sits outside the folder). */
export function workspaceOwning(path: string, folders: WorkspaceFolders): string | undefined {
  const owner = folders.workspaces.find(
    (workspace) =>
      isWithin(path, workspace.folderPath) ||
      (folders.projects[workspace.id] ?? []).some(
        (project) => project.worktreePath !== undefined && isWithin(path, project.worktreePath)
      )
  )
  return owner?.id
}

/** The stored value of a setting: the one the workspace owning `repoPath` sets for itself, else
 * the global one. Undefined when neither is set, so the caller falls back to the default its
 * schema declares. */
export function storedSettingValue(
  settings: ExtensionSettingsSnapshot,
  folders: WorkspaceFolders,
  read: ScopedSettingRead
): unknown {
  const workspaceId =
    read.repoPath === undefined ? undefined : workspaceOwning(read.repoPath, folders)
  const own =
    workspaceId === undefined
      ? undefined
      : settings.workspaces[workspaceId]?.[read.extensionId]?.[read.key]
  return own ?? settings.global[read.key]
}
