import type { ExtensionSettingsSchema } from '@terminator/extension-sdk'
import { listProjects, listWorkspaces } from '../storage/workspace-store.js'

/** What an extension's shell roots are built from, read on every call (ADR 102). */
export interface ShellRootSources {
  /** `api.paths.userData`. */
  userData: string
  /** The manifest's `contributes.shellRoots`. */
  declaredKeys: readonly string[]
  /** The extension's registered settings: a declared key counts only as a `folder` there. */
  schema: ExtensionSettingsSchema | undefined
  readSetting: (key: string) => unknown
}

/**
 * Every directory an extension's git and gh may run in: each workspace folder,
 * each project worktree, `api.paths.userData`, and the current value of each
 * folder setting the extension declared and registered.
 */
export function extensionShellRoots(sources: ShellRootSources): string[] {
  return [...workspaceRoots(), sources.userData, ...declaredFolders(sources)]
}

function workspaceRoots(): string[] {
  return listWorkspaces().flatMap((workspace) => [
    workspace.folderPath,
    ...listProjects(workspace.id).flatMap((project) => project.worktreePath ?? []),
  ])
}

function declaredFolders({ declaredKeys, schema, readSetting }: ShellRootSources): string[] {
  return declaredKeys.flatMap((key) => {
    const value = readSetting(key)
    return schema?.properties[key]?.type === 'folder' && typeof value === 'string' ? [value] : []
  })
}
