import { create } from 'zustand'
import type { GlobalSettings, WorkspaceSettings } from '../../shared/types/index'

interface SettingsState {
  globalSettings: GlobalSettings | null
  workspaceSettings: Map<string, WorkspaceSettings>
  resolvedTheme: 'dark' | 'light'

  loadSettings: (workspaceId?: string) => Promise<void>
  updateGlobalTheme: (theme: 'dark' | 'light') => Promise<void>
  updateWorkspaceTheme: (workspaceId: string, theme: 'dark' | 'light') => Promise<void>
  updateScrollbackLimit: (limit: number) => Promise<void>
  updateWorkspaceScrollback: (workspaceId: string, limit: number) => Promise<void>
  updateWorktreeBaseDir: (dir: string) => Promise<void>
  updateWorkspaceWorktreeBaseDir: (workspaceId: string, dir: string | undefined) => Promise<void>
  markWelcomeSeen: () => Promise<void>
  resolveSettings: (workspaceId?: string | null) => GlobalSettings
}

const DEFAULT_SETTINGS: GlobalSettings = {
  appearance: { theme: 'dark' },
  terminal: { scrollbackLimit: 10000, defaultShell: '/bin/zsh' },
  git: { worktreeBaseDir: '' },
  extensions: {},
  ui: { hasSeenWelcome: false },
}

function mergeSettings(
  global: GlobalSettings,
  workspace?: WorkspaceSettings | null
): GlobalSettings {
  // Normalize global against defaults first to survive schema migrations
  const g: GlobalSettings = {
    ...DEFAULT_SETTINGS,
    ...global,
    appearance: { ...DEFAULT_SETTINGS.appearance, ...global.appearance },
    terminal: { ...DEFAULT_SETTINGS.terminal, ...global.terminal },
    git: { ...DEFAULT_SETTINGS.git, ...global.git },
  }
  if (!workspace?.overrides) return g
  return {
    ...g,
    appearance: { ...g.appearance, ...workspace.overrides.appearance },
    terminal: { ...g.terminal, ...workspace.overrides.terminal },
    git: { ...g.git, ...workspace.overrides.git },
  }
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  globalSettings: null,
  workspaceSettings: new Map(),
  resolvedTheme: 'dark',

  loadSettings: async (workspaceId) => {
    const globalResult = await window.electronAPI.settings.getGlobal()
    const global = globalResult.settings ?? DEFAULT_SETTINGS
    set({ globalSettings: global })

    if (workspaceId) {
      const wsResult = await window.electronAPI.settings.getWorkspace(workspaceId)
      set((s) => {
        const map = new Map(s.workspaceSettings)
        map.set(workspaceId, wsResult.settings)
        return { workspaceSettings: map }
      })
    }

    const ws = workspaceId ? get().workspaceSettings.get(workspaceId) : null
    const resolved = mergeSettings(global, ws)
    set({ resolvedTheme: resolved.appearance.theme })
  },

  updateGlobalTheme: async (theme) => {
    const result = await window.electronAPI.settings.updateGlobal({ appearance: { theme } })
    set({ globalSettings: result.settings, resolvedTheme: theme })
  },

  updateWorkspaceTheme: async (workspaceId, theme) => {
    const result = await window.electronAPI.settings.updateWorkspace(workspaceId, {
      appearance: { theme },
    })
    set((s) => {
      const map = new Map(s.workspaceSettings)
      map.set(workspaceId, result.settings)
      return { workspaceSettings: map, resolvedTheme: theme }
    })
  },

  updateScrollbackLimit: async (limit) => {
    const result = await window.electronAPI.settings.updateGlobal({
      terminal: { scrollbackLimit: limit },
    })
    set({ globalSettings: result.settings })
  },

  updateWorkspaceScrollback: async (workspaceId, limit) => {
    const result = await window.electronAPI.settings.updateWorkspace(workspaceId, {
      terminal: { scrollbackLimit: limit },
    })
    set((s) => {
      const map = new Map(s.workspaceSettings)
      map.set(workspaceId, result.settings)
      return { workspaceSettings: map }
    })
  },

  updateWorktreeBaseDir: async (dir) => {
    const result = await window.electronAPI.settings.updateGlobal({ git: { worktreeBaseDir: dir } })
    set({ globalSettings: result.settings })
  },

  updateWorkspaceWorktreeBaseDir: async (workspaceId, dir) => {
    const result = await window.electronAPI.settings.updateWorkspace(workspaceId, {
      git: dir !== undefined ? { worktreeBaseDir: dir } : undefined,
    })
    set((s) => {
      const map = new Map(s.workspaceSettings)
      map.set(workspaceId, result.settings)
      return { workspaceSettings: map }
    })
  },

  markWelcomeSeen: async () => {
    const result = await window.electronAPI.settings.updateGlobal({ ui: { hasSeenWelcome: true } })
    set({ globalSettings: result.settings })
  },

  resolveSettings: (workspaceId) => {
    const global = get().globalSettings ?? DEFAULT_SETTINGS
    const ws = workspaceId ? get().workspaceSettings.get(workspaceId) : null
    return mergeSettings(global, ws)
  },
}))
