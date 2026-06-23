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

const DEFAULT_SETTINGS = {
  appearance: { theme: 'dark' },
  terminal: {
    scrollbackLimit: 10000,
    defaultShell: '/bin/zsh',
  },
  git: { worktreeBaseDir: '', branchExcludePatterns: [] },
  extensions: {},
  ui: { hasSeenWelcome: false },
}

function resetStore() {
  useSettingsStore.setState({
    globalSettings: null,
    workspaceSettings: new Map(),
    resolvedTheme: 'dark',
  })
}

describe('useSettingsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStore()
  })

  describe('loadSettings', () => {
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

  describe('updateScrollbackLimit', () => {
    it('calls updateGlobal with scrollbackLimit and updates store', async () => {
      const updated = {
        ...DEFAULT_SETTINGS,
        terminal: { scrollbackLimit: 5000, defaultShell: '/bin/zsh' },
      }
      mockElectronAPI.settings.updateGlobal.mockResolvedValue({ settings: updated })

      await useSettingsStore.getState().updateScrollbackLimit(5000)
      expect(mockElectronAPI.settings.updateGlobal).toHaveBeenCalledWith({
        terminal: { scrollbackLimit: 5000 },
      })
      expect(useSettingsStore.getState().globalSettings).toEqual(updated)
    })
  })

  describe('updateWorktreeBaseDir', () => {
    it('calls updateGlobal with worktreeBaseDir', async () => {
      const updated = { ...DEFAULT_SETTINGS, git: { worktreeBaseDir: '/my/worktrees' } }
      mockElectronAPI.settings.updateGlobal.mockResolvedValue({ settings: updated })

      await useSettingsStore.getState().updateWorktreeBaseDir('/my/worktrees')
      expect(mockElectronAPI.settings.updateGlobal).toHaveBeenCalledWith({
        git: { worktreeBaseDir: '/my/worktrees' },
      })
    })
  })

  describe('updateWorkspaceWorktreeBaseDir', () => {
    it('calls updateWorkspace with git override when dir is provided', async () => {
      const wsSettings = { overrides: { git: { worktreeBaseDir: '/ws/worktrees' } } }
      mockElectronAPI.settings.updateWorkspace.mockResolvedValue({ settings: wsSettings })

      await useSettingsStore.getState().updateWorkspaceWorktreeBaseDir('ws-1', '/ws/worktrees')
      expect(mockElectronAPI.settings.updateWorkspace).toHaveBeenCalledWith('ws-1', {
        git: { worktreeBaseDir: '/ws/worktrees' },
      })
    })

    it('calls updateWorkspace with undefined git override when dir is undefined', async () => {
      const wsSettings = { overrides: undefined }
      mockElectronAPI.settings.updateWorkspace.mockResolvedValue({ settings: wsSettings })

      await useSettingsStore.getState().updateWorkspaceWorktreeBaseDir('ws-1', undefined)
      expect(mockElectronAPI.settings.updateWorkspace).toHaveBeenCalledWith('ws-1', {
        git: undefined,
      })
    })
  })

  describe('resolveSettings', () => {
    it('returns defaults merged with global settings when no workspace', () => {
      useSettingsStore.setState({ globalSettings: DEFAULT_SETTINGS })
      const resolved = useSettingsStore.getState().resolveSettings()
      expect(resolved.appearance.theme).toBe('dark')
    })

    it('merges workspace overrides over global settings', () => {
      useSettingsStore.setState({
        globalSettings: DEFAULT_SETTINGS,
        workspaceSettings: new Map([
          ['ws-1', { overrides: { appearance: { theme: 'light' as const } } }],
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

    it('ignores workspace overrides when no workspace id provided', () => {
      useSettingsStore.setState({
        globalSettings: { ...DEFAULT_SETTINGS, appearance: { theme: 'dark' as const } },
        workspaceSettings: new Map([
          ['ws-1', { overrides: { appearance: { theme: 'light' as const } } }],
        ]),
      })
      const resolved = useSettingsStore.getState().resolveSettings(null)
      expect(resolved.appearance.theme).toBe('dark')
    })
  })

  describe('markWelcomeSeen', () => {
    it('calls updateGlobal with hasSeenWelcome true', async () => {
      const updated = { ...DEFAULT_SETTINGS, ui: { hasSeenWelcome: true } }
      mockElectronAPI.settings.updateGlobal.mockResolvedValue({ settings: updated })

      await useSettingsStore.getState().markWelcomeSeen()
      expect(mockElectronAPI.settings.updateGlobal).toHaveBeenCalledWith({
        ui: { hasSeenWelcome: true },
      })
      expect(useSettingsStore.getState().globalSettings).toEqual(updated)
    })
  })

  describe('updateWorkspaceScrollback', () => {
    it('calls updateWorkspace with scrollbackLimit and updates workspace settings', async () => {
      const wsSettings = { overrides: { terminal: { scrollbackLimit: 3000 } } }
      mockElectronAPI.settings.updateWorkspace.mockResolvedValue({ settings: wsSettings })

      await useSettingsStore.getState().updateWorkspaceScrollback('ws-1', 3000)
      expect(mockElectronAPI.settings.updateWorkspace).toHaveBeenCalledWith('ws-1', {
        terminal: { scrollbackLimit: 3000 },
      })
      const stored = useSettingsStore.getState().workspaceSettings.get('ws-1')
      expect(stored).toEqual(wsSettings)
    })
  })

  describe('updateShowMetricsBar', () => {
    it('calls updateGlobal with showMetricsBar true and updates store', async () => {
      const updated = { ...DEFAULT_SETTINGS, ui: { hasSeenWelcome: false, showMetricsBar: true } }
      mockElectronAPI.settings.updateGlobal.mockResolvedValue({ settings: updated })

      await useSettingsStore.getState().updateShowMetricsBar(true)
      expect(mockElectronAPI.settings.updateGlobal).toHaveBeenCalledWith({
        ui: { showMetricsBar: true },
      })
      expect(useSettingsStore.getState().globalSettings?.ui?.showMetricsBar).toBe(true)
    })

    it('calls updateGlobal with showMetricsBar false', async () => {
      const updated = { ...DEFAULT_SETTINGS, ui: { hasSeenWelcome: false, showMetricsBar: false } }
      mockElectronAPI.settings.updateGlobal.mockResolvedValue({ settings: updated })

      await useSettingsStore.getState().updateShowMetricsBar(false)
      expect(mockElectronAPI.settings.updateGlobal).toHaveBeenCalledWith({
        ui: { showMetricsBar: false },
      })
    })
  })
})
