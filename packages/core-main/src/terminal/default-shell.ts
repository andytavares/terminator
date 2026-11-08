import { getProjectById } from '../storage/workspace-store.js'
import { getGlobalSettings, getWorkspaceSettings } from '../storage/settings-store.js'

/** The shell a project's terminal opens in: its workspace's own default, else the global one. */
export function defaultShellFor(projectId: string): string {
  const workspaceId = getProjectById(projectId)?.workspaceId
  const own = workspaceId
    ? getWorkspaceSettings(workspaceId).overrides?.terminal?.defaultShell
    : undefined
  return own ?? getGlobalSettings().terminal.defaultShell
}
