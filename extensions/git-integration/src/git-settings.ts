import type { ExtensionAPI } from '@terminator/extension-sdk'
import type { GitSettings } from './ipc/git.ipc.js'

const SETTING = 'terminator.git-integration.git'

export const MAX_DISPLAYED_FILES = { default: 500, min: 10, max: 5000 }

/** The commit and status settings, read on every call; a number outside the declared bounds is clamped. */
export function gitSettings(api: ExtensionAPI): GitSettings {
  return {
    signOff: () => api.settings.get<boolean>(`${SETTING}.commit.signOff`) === true,
    maxDisplayedFiles: () =>
      clampedFileLimit(api.settings.get<number>(`${SETTING}.maxDisplayedFiles`)),
  }
}

/** The settings page stores what was typed, so an empty or out-of-range entry lands here. */
function clampedFileLimit(stored: unknown): number {
  const value = Number(stored)
  if (stored === '' || !Number.isFinite(value)) return MAX_DISPLAYED_FILES.default
  return Math.min(MAX_DISPLAYED_FILES.max, Math.max(MAX_DISPLAYED_FILES.min, Math.round(value)))
}
