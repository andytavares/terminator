import type { ExtensionAPI } from '@terminator/extension-sdk'
import type { GitSettings } from './ipc/git.ipc.js'

const SETTING = 'terminator.git-integration.git'

export const MAX_DISPLAYED_FILES = { default: 500, min: 10, max: 5000 }

/** The commit and status settings, read on every call; a number outside the declared bounds is
 *  clamped. Sign-off is workspace-scoped: the repository's workspace's, else the global one. */
export function gitSettings(api: ExtensionAPI): GitSettings {
  return {
    signOff: (repoRoot) =>
      api.settings.get<boolean>(`${SETTING}.commit.signOff`, { repoPath: repoRoot }) === true,
    maxDisplayedFiles: () =>
      clampedFileLimit(api.settings.get<number>(`${SETTING}.maxDisplayedFiles`)),
  }
}

/** "Enable Git Integration" in the workspace holding `repoPath`, or the global value without one. */
export function gitEnabled(api: ExtensionAPI, repoPath?: string): boolean {
  const scope = repoPath === undefined ? undefined : { repoPath }
  return api.settings.get<boolean>(`${SETTING}.enabled`, scope) !== false
}

/** On globally or in at least one workspace; off everywhere, activation registers only the settings page. */
export function gitEnabledAnywhere(api: ExtensionAPI): boolean {
  const folders = api.workspace.list().map((workspace) => workspace.folderPath)
  return [undefined, ...folders].some((folder) => gitEnabled(api, folder))
}

/** The settings page stores what was typed, so an empty or out-of-range entry lands here. */
function clampedFileLimit(stored: unknown): number {
  const value = Number(stored)
  if (stored === '' || !Number.isFinite(value)) return MAX_DISPLAYED_FILES.default
  return Math.min(MAX_DISPLAYED_FILES.max, Math.max(MAX_DISPLAYED_FILES.min, Math.round(value)))
}
