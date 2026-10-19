import type { GlobalSettings } from './schemas/settings.schema'

/** The global settings before the operator has changed any. The shell is a parameter because
 * only the main process can read $SHELL; the renderer's copy is a placeholder until
 * settings:get-global answers. */
export function defaultGlobalSettings(defaultShell: string): GlobalSettings {
  return {
    appearance: { theme: 'dark' },
    terminal: { scrollbackLimit: 10000, defaultShell, promptForName: false },
    git: { worktreeBaseDir: '', branchExcludePatterns: [] },
    ui: { hasSeenWelcome: false, editor: '', hideSidebarOnHome: true },
    sidebar: { staleAfterMs: 2 * 60 * 60 * 1000 },
    notifications: { defaultTargets: ['system', 'center', 'toast'], overrides: {} },
    quickActions: { pins: [], usage: [], directUse: [], custom: [] },
  }
}
