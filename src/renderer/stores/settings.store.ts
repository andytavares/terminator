import { create, type StoreApi } from 'zustand'
import type { ElectronAPI } from '../../shared/electron-api/api-type'
import type {
  CustomAction,
  GlobalSettings,
  NotificationTarget,
  QuickActionsSettings,
  WorkspaceSettings,
} from '../../shared/types/index'
import { defaultGlobalSettings } from '../../shared/settings-defaults'
import type { HomeLayout } from '../../shared/schemas/settings.schema'

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
  /** The workspace's own default shell; undefined hands it back to the global one. */
  updateWorkspaceDefaultShell: (workspaceId: string, shell: string | undefined) => Promise<void>
  updateBranchExcludePatterns: (patterns: string[]) => Promise<void>
  updateWorkspaceBranchExcludePatterns: (
    workspaceId: string,
    patterns: string[] | undefined
  ) => Promise<void>
  markWelcomeSeen: () => Promise<void>
  updateShowMetricsBar: (show: boolean) => Promise<void>
  updateHideSidebarOnHome: (hide: boolean) => Promise<void>
  updateHomeLayout: (layout: HomeLayout) => Promise<void>
  updatePromptForName: (enabled: boolean) => Promise<void>
  updateNotificationDefaultTargets: (targets: NotificationTarget[]) => Promise<void>
  updateNotificationOverride: (key: string, targets: NotificationTarget[]) => Promise<void>
  updateQuickActions: (patch: Partial<QuickActionsSettings>) => Promise<void>
  updateWorkspaceQuickActions: (workspaceId: string, custom: CustomAction[]) => Promise<void>
  /** A `workspaceScoped` extension setting's own value here; undefined hands it back to the global one. */
  updateWorkspaceExtensionSetting: (
    workspaceId: string,
    key: string,
    value: unknown
  ) => Promise<void>
  resolveSettings: (workspaceId?: string | null) => GlobalSettings
}

// The main process answers with $SHELL; this stands in until it does.
const DEFAULT_SETTINGS = defaultGlobalSettings('/bin/zsh')

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
    notifications: { ...DEFAULT_SETTINGS.notifications, ...global.notifications },
  }
  if (!workspace?.overrides) return g
  return {
    ...g,
    appearance: { ...g.appearance, ...workspace.overrides.appearance },
    terminal: { ...g.terminal, ...workspace.overrides.terminal },
    git: { ...g.git, ...workspace.overrides.git },
  }
}

type SetSettings = StoreApi<SettingsState>['setState']
type GetSettings = StoreApi<SettingsState>['getState']
type GlobalPatch = Parameters<ElectronAPI['settings']['updateGlobal']>[0]
type WorkspacePatch = Parameters<ElectronAPI['settings']['updateWorkspace']>[1]

function withWorkspace(
  s: SettingsState,
  workspaceId: string,
  settings: WorkspaceSettings
): Pick<SettingsState, 'workspaceSettings'> {
  const map = new Map(s.workspaceSettings)
  map.set(workspaceId, settings)
  return { workspaceSettings: map }
}

/** Saves a change to the global settings and keeps what main answers with. */
async function saveGlobal(
  set: SetSettings,
  patch: GlobalPatch,
  alongside: Partial<SettingsState> = {}
): Promise<void> {
  const result = await window.electronAPI.settings.updateGlobal(patch)
  set({ globalSettings: result.settings, ...alongside })
}

/** Saves a change to one repo's settings and keeps what main answers with. */
async function saveWorkspace(
  set: SetSettings,
  workspaceId: string,
  patch: WorkspacePatch
): Promise<void> {
  const result = await window.electronAPI.settings.updateWorkspace(workspaceId, patch)
  set((s) => withWorkspace(s, workspaceId, result.settings))
}

/** Saves one extension setting's value in one workspace and keeps what main answers with. */
async function saveWorkspaceExtensionSetting(
  set: SetSettings,
  workspaceId: string,
  { key, value }: { key: string; value: unknown }
): Promise<void> {
  const result = await window.electronAPI.extension.updateWorkspaceSetting(workspaceId, key, value)
  if ('settings' in result) set((s) => withWorkspace(s, workspaceId, result.settings))
}

async function loadSettings(
  set: SetSettings,
  get: GetSettings,
  workspaceId: string | undefined
): Promise<void> {
  const globalResult = await window.electronAPI.settings.getGlobal()
  const global = globalResult.settings ?? DEFAULT_SETTINGS
  set({ globalSettings: global })

  if (workspaceId) {
    const wsResult = await window.electronAPI.settings.getWorkspace(workspaceId)
    set((s) => withWorkspace(s, workspaceId, wsResult.settings))
  }

  const ws = workspaceId ? get().workspaceSettings.get(workspaceId) : null
  const resolved = mergeSettings(global, ws)
  set({ resolvedTheme: resolved.appearance.theme })
}

async function updateWorkspaceTheme(
  set: SetSettings,
  workspaceId: string,
  theme: 'dark' | 'light'
): Promise<void> {
  const result = await window.electronAPI.settings.updateWorkspace(workspaceId, {
    appearance: { theme },
  })
  set((s) => ({ ...withWorkspace(s, workspaceId, result.settings), resolvedTheme: theme }))
}

type Slice<Keys extends keyof SettingsState> = Pick<SettingsState, Keys>

function globalSlice(
  set: SetSettings
): Slice<
  | 'updateGlobalTheme'
  | 'updateScrollbackLimit'
  | 'updateWorktreeBaseDir'
  | 'updateBranchExcludePatterns'
  | 'updatePromptForName'
> {
  return {
    updateGlobalTheme: (theme) =>
      saveGlobal(set, { appearance: { theme } }, { resolvedTheme: theme }),
    updateScrollbackLimit: (limit) => saveGlobal(set, { terminal: { scrollbackLimit: limit } }),
    updateWorktreeBaseDir: (dir) => saveGlobal(set, { git: { worktreeBaseDir: dir } }),
    updateBranchExcludePatterns: (patterns) =>
      saveGlobal(set, { git: { branchExcludePatterns: patterns } }),
    updatePromptForName: (enabled) => saveGlobal(set, { terminal: { promptForName: enabled } }),
  }
}

/** The app's own preferences: the welcome, the metrics bar, notifications and Quick Actions. */
function preferenceSlice(
  set: SetSettings
): Slice<
  | 'markWelcomeSeen'
  | 'updateShowMetricsBar'
  | 'updateHideSidebarOnHome'
  | 'updateHomeLayout'
  | 'updateNotificationDefaultTargets'
  | 'updateNotificationOverride'
  | 'updateQuickActions'
> {
  return {
    markWelcomeSeen: () => saveGlobal(set, { ui: { hasSeenWelcome: true } }),
    updateShowMetricsBar: (show) => saveGlobal(set, { ui: { showMetricsBar: show } }),
    updateHideSidebarOnHome: (hide) => saveGlobal(set, { ui: { hideSidebarOnHome: hide } }),
    updateHomeLayout: (layout) => saveGlobal(set, { ui: { homeLayout: layout } }),
    updateNotificationDefaultTargets: (targets) =>
      saveGlobal(set, { notifications: { defaultTargets: targets } }),
    updateNotificationOverride: (key, targets) =>
      saveGlobal(set, { notifications: { overrides: { [key]: targets } } }),
    updateQuickActions: (patch) => saveGlobal(set, { quickActions: patch }),
  }
}

function workspaceSettingsSlice(
  set: SetSettings
): Slice<
  | 'updateWorkspaceTheme'
  | 'updateWorkspaceScrollback'
  | 'updateWorkspaceWorktreeBaseDir'
  | 'updateWorkspaceDefaultShell'
  | 'updateWorkspaceBranchExcludePatterns'
  | 'updateWorkspaceQuickActions'
  | 'updateWorkspaceExtensionSetting'
> {
  return {
    updateWorkspaceTheme: (workspaceId, theme) => updateWorkspaceTheme(set, workspaceId, theme),
    updateWorkspaceScrollback: (workspaceId, limit) =>
      saveWorkspace(set, workspaceId, { terminal: { scrollbackLimit: limit } }),
    updateWorkspaceDefaultShell: (workspaceId, shell) =>
      saveWorkspace(set, workspaceId, { terminal: { defaultShell: shell } }),
    // An undefined value hands only that setting back to the global one.
    updateWorkspaceWorktreeBaseDir: (workspaceId, dir) =>
      saveWorkspace(set, workspaceId, { git: { worktreeBaseDir: dir } }),
    updateWorkspaceBranchExcludePatterns: (workspaceId, patterns) =>
      saveWorkspace(set, workspaceId, { git: { branchExcludePatterns: patterns } }),
    updateWorkspaceQuickActions: (workspaceId, custom) =>
      saveWorkspace(set, workspaceId, { quickActions: { custom } }),
    updateWorkspaceExtensionSetting: (workspaceId, key, value) =>
      saveWorkspaceExtensionSetting(set, workspaceId, { key, value }),
  }
}

// One store built from slices: https://zustand.docs.pmnd.rs/guides/slices-pattern
export const useSettingsStore = create<SettingsState>((set, get) => ({
  globalSettings: null,
  workspaceSettings: new Map(),
  resolvedTheme: 'dark',
  loadSettings: (workspaceId) => loadSettings(set, get, workspaceId),
  ...globalSlice(set),
  ...preferenceSlice(set),
  ...workspaceSettingsSlice(set),
  resolveSettings: (workspaceId) => {
    const global = get().globalSettings ?? DEFAULT_SETTINGS
    const ws = workspaceId ? get().workspaceSettings.get(workspaceId) : null
    return mergeSettings(global, ws)
  },
}))
