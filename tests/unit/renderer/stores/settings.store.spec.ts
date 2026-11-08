import { describe, it, expect, vi, beforeEach } from 'vitest'

// Must mock window.electronAPI before importing the store
const mockElectronAPI = {
  settings: {
    getGlobal: vi.fn(),
    updateGlobal: vi.fn(),
    getWorkspace: vi.fn(),
    updateWorkspace: vi.fn(),
  },
}

Object.defineProperty(globalThis, 'window', {
  value: { electronAPI: mockElectronAPI },
  writable: true,
})

import { useSettingsStore } from '../../../../src/renderer/stores/settings.store'
import type { GlobalSettings } from '../../../../src/shared/schemas/settings.schema'

const DEFAULT_SETTINGS: GlobalSettings = {
  appearance: { theme: 'dark' },
  terminal: {
    scrollbackLimit: 10000,
    defaultShell: '/bin/zsh',
    promptForName: false,
  },
  git: { worktreeBaseDir: '', branchExcludePatterns: [] },
  ui: {
    hasSeenWelcome: false,
    editor: '',
    hideSidebarOnHome: true,
    showUsageTab: true,
    homeLayout: 'tasks',
    sidebarMode: 'tree',
  },
  sidebar: { staleAfterMs: 2 * 60 * 60 * 1000 },
  sessions: { deleteClosedAfterHours: 24 },
  notifications: { defaultTargets: ['system', 'center', 'toast'], overrides: {} },
  quickActions: { pins: [], usage: [], directUse: [], custom: [] },
  agents: { default: 'claude', custom: [] },
}

function resetStore() {
  useSettingsStore.setState({
    globalSettings: null,
    workspaceSettings: new Map(),
    resolvedTheme: 'dark',
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  resetStore()
})

describe('useSettingsStore — loadSettings', () => {
  it('loads and stores global settings', async () => {
    const globalSettings = { ...DEFAULT_SETTINGS, appearance: { theme: 'light' as const } }
    mockElectronAPI.settings.getGlobal.mockResolvedValue({ settings: globalSettings })

    await useSettingsStore.getState().loadSettings()
    expect(useSettingsStore.getState().globalSettings).toEqual(globalSettings)
  })

  it('falls back to DEFAULT_SETTINGS when global settings is null', async () => {
    mockElectronAPI.settings.getGlobal.mockResolvedValue({ settings: null })

    await useSettingsStore.getState().loadSettings()
    expect(useSettingsStore.getState().globalSettings).toEqual(DEFAULT_SETTINGS)
  })

  it('loads workspace settings when workspaceId is provided', async () => {
    mockElectronAPI.settings.getGlobal.mockResolvedValue({ settings: DEFAULT_SETTINGS })
    const wsSettings = { overrides: { appearance: { theme: 'light' as const } } }
    mockElectronAPI.settings.getWorkspace.mockResolvedValue({ settings: wsSettings })

    await useSettingsStore.getState().loadSettings('ws-1')
    const stored = useSettingsStore.getState().workspaceSettings.get('ws-1')
    expect(stored).toEqual(wsSettings)
  })

  it('sets resolvedTheme based on merged settings', async () => {
    const globalSettings = { ...DEFAULT_SETTINGS }
    mockElectronAPI.settings.getGlobal.mockResolvedValue({ settings: globalSettings })
    const wsSettings = { overrides: { appearance: { theme: 'light' as const } } }
    mockElectronAPI.settings.getWorkspace.mockResolvedValue({ settings: wsSettings })

    await useSettingsStore.getState().loadSettings('ws-1')
    expect(useSettingsStore.getState().resolvedTheme).toBe('light')
  })
})

describe('useSettingsStore — updateGlobalTheme', () => {
  describe('updateGlobalTheme', () => {
    it('calls updateGlobal and updates store', async () => {
      const updated = { ...DEFAULT_SETTINGS, appearance: { theme: 'light' as const } }
      mockElectronAPI.settings.updateGlobal.mockResolvedValue({ settings: updated })

      await useSettingsStore.getState().updateGlobalTheme('light')
      expect(mockElectronAPI.settings.updateGlobal).toHaveBeenCalledWith({
        appearance: { theme: 'light' },
      })
      expect(useSettingsStore.getState().resolvedTheme).toBe('light')
      expect(useSettingsStore.getState().globalSettings).toEqual(updated)
    })
  })

  describe('updateWorkspaceTheme', () => {
    it('calls updateWorkspace and updates workspace settings map', async () => {
      const wsSettings = { overrides: { appearance: { theme: 'light' as const } } }
      mockElectronAPI.settings.updateWorkspace.mockResolvedValue({ settings: wsSettings })

      await useSettingsStore.getState().updateWorkspaceTheme('ws-1', 'light')
      expect(mockElectronAPI.settings.updateWorkspace).toHaveBeenCalledWith('ws-1', {
        appearance: { theme: 'light' },
      })
      const stored = useSettingsStore.getState().workspaceSettings.get('ws-1')
      expect(stored).toEqual(wsSettings)
      expect(useSettingsStore.getState().resolvedTheme).toBe('light')
    })
  })
})

describe('useSettingsStore — resolveSettings', () => {
  it('returns defaults merged with global settings when no workspace', () => {
    useSettingsStore.setState({ globalSettings: DEFAULT_SETTINGS })
    const resolved = useSettingsStore.getState().resolveSettings()
    expect(resolved.appearance.theme).toBe('dark')
  })

  it('merges workspace overrides over global settings', () => {
    useSettingsStore.setState({
      globalSettings: DEFAULT_SETTINGS,
      workspaceSettings: new Map([
        [
          'ws-1',
          { workspaceId: 'ws-1', extensions: {}, overrides: { appearance: { theme: 'light' } } },
        ],
      ]),
    })
    const resolved = useSettingsStore.getState().resolveSettings('ws-1')
    expect(resolved.appearance.theme).toBe('light')
  })

  it('uses defaults when globalSettings is null', () => {
    useSettingsStore.setState({ globalSettings: null })
    const resolved = useSettingsStore.getState().resolveSettings()
    expect(resolved.terminal.scrollbackLimit).toBe(10000)
  })
})

describe('useSettingsStore — resolveSettings — ignores workspace overrides when no workspace id provided', () => {
  it('ignores workspace overrides when no workspace id provided', () => {
    useSettingsStore.setState({
      globalSettings: { ...DEFAULT_SETTINGS, appearance: { theme: 'dark' as const } },
      workspaceSettings: new Map([
        [
          'ws-1',
          { workspaceId: 'ws-1', extensions: {}, overrides: { appearance: { theme: 'light' } } },
        ],
      ]),
    })
    const resolved = useSettingsStore.getState().resolveSettings(null)
    expect(resolved.appearance.theme).toBe('dark')
  })
})

// Main answers each save with the settings it stored; the store keeps that answer.
const SAVED_GLOBAL: GlobalSettings = { ...DEFAULT_SETTINGS, appearance: { theme: 'light' } }
const SAVED_WORKSPACE = { workspaceId: 'ws-1', extensions: {}, overrides: { terminal: {} } }

type SettingsAction = (...args: unknown[]) => Promise<void>

const GLOBAL_SAVES = [
  ['updateScrollbackLimit', [5000], { terminal: { scrollbackLimit: 5000 } }],
  ['updateWorktreeBaseDir', ['/my/worktrees'], { git: { worktreeBaseDir: '/my/worktrees' } }],
  ['markWelcomeSeen', [], { ui: { hasSeenWelcome: true } }],
  ['updateShowMetricsBar', [true], { ui: { showMetricsBar: true } }],
  ['updateHideSidebarOnHome', [false], { ui: { hideSidebarOnHome: false } }],
  ['updateShowUsageTab', [false], { ui: { showUsageTab: false } }],
  ['updateHomeLayout', ['classic'], { ui: { homeLayout: 'classic' } }],
  ['updateSidebarMode', ['inbox'], { ui: { sidebarMode: 'inbox' } }],
  ['updatePromptForName', [true], { terminal: { promptForName: true } }],
  [
    'updateNotificationDefaultTargets',
    [['toast']],
    { notifications: { defaultTargets: ['toast'] } },
  ],
  [
    'updateNotificationOverride',
    ['terminalBell', ['system']],
    { notifications: { overrides: { terminalBell: ['system'] } } },
  ],
  [
    'updateQuickActions',
    [{ pins: ['core.new-tab'] }],
    { quickActions: { pins: ['core.new-tab'] } },
  ],
  ['updateBranchExcludePatterns', [['wip/*']], { git: { branchExcludePatterns: ['wip/*'] } }],
] as const

describe('useSettingsStore — global setters', () => {
  it.each(GLOBAL_SAVES)(
    '%s saves its patch and keeps what main returns',
    async (method, args, patch) => {
      mockElectronAPI.settings.updateGlobal.mockResolvedValue({ settings: SAVED_GLOBAL })

      await (useSettingsStore.getState()[method] as SettingsAction)(...args)

      expect(mockElectronAPI.settings.updateGlobal).toHaveBeenCalledWith(patch)
      expect(useSettingsStore.getState().globalSettings).toEqual(SAVED_GLOBAL)
    }
  )
})

const WORKSPACE_SAVES = [
  [
    'updateWorkspaceWorktreeBaseDir',
    ['/ws/worktrees'],
    { git: { worktreeBaseDir: '/ws/worktrees' } },
  ],
  ['updateWorkspaceDefaultShell', [undefined], { terminal: { defaultShell: undefined } }],
  ['updateWorkspaceScrollback', [3000], { terminal: { scrollbackLimit: 3000 } }],
  [
    'updateWorkspaceQuickActions',
    [[{ id: 'custom-1', label: 'Echo', kind: 'shell', target: 'new-tab', body: 'echo' }]],
    {
      quickActions: {
        custom: [{ id: 'custom-1', label: 'Echo', kind: 'shell', target: 'new-tab', body: 'echo' }],
      },
    },
  ],
  [
    'updateWorkspaceBranchExcludePatterns',
    [['tmp/*']],
    { git: { branchExcludePatterns: ['tmp/*'] } },
  ],
] as const

describe('useSettingsStore — workspace setters', () => {
  it.each(WORKSPACE_SAVES)(
    '%s saves its patch for the repo and keeps what main returns',
    async (method, args, patch) => {
      mockElectronAPI.settings.updateWorkspace.mockResolvedValue({ settings: SAVED_WORKSPACE })

      await (useSettingsStore.getState()[method] as SettingsAction)('ws-1', ...args)

      expect(mockElectronAPI.settings.updateWorkspace).toHaveBeenCalledWith('ws-1', patch)
      expect(useSettingsStore.getState().workspaceSettings.get('ws-1')).toEqual(SAVED_WORKSPACE)
    }
  )
})
