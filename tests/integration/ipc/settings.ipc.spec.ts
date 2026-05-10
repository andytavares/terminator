import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}))

vi.mock('../../../src/main/storage/settings-store', () => ({
  getGlobalSettings: vi.fn(),
  updateGlobalSettings: vi.fn(),
  getWorkspaceSettings: vi.fn(),
  updateWorkspaceSettings: vi.fn(),
}))

import * as settingsStore from '../../../src/main/storage/settings-store'
import { registerSettingsHandlers } from '../../../src/main/ipc/settings.ipc'

function captureHandler(channel: string): (event: unknown, payload?: unknown) => unknown {
  const calls = vi.mocked(ipcMain.handle).mock.calls
  const match = calls.find(([ch]) => ch === channel)
  if (!match) throw new Error(`No handler registered for: ${channel}`)
  return match[1] as (event: unknown, payload?: unknown) => unknown
}

describe('settings IPC handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registerSettingsHandlers()
  })

  describe('settings:get-global', () => {
    it('returns global settings from store', () => {
      const settings = { appearance: { theme: 'dark' } }
      vi.mocked(settingsStore.getGlobalSettings).mockReturnValue(settings as any)
      const handler = captureHandler('settings:get-global')
      const result = handler({}) as { settings: unknown }
      expect(result.settings).toEqual(settings)
    })
  })

  describe('settings:update-global', () => {
    it('calls updateGlobalSettings with patch and returns updated settings', () => {
      const updated = { appearance: { theme: 'light' } }
      vi.mocked(settingsStore.updateGlobalSettings).mockReturnValue(updated as any)
      const handler = captureHandler('settings:update-global')
      const result = handler({}, { patch: { appearance: { theme: 'light' } } }) as {
        settings: unknown
      }
      expect(settingsStore.updateGlobalSettings).toHaveBeenCalledWith({
        appearance: { theme: 'light' },
      })
      expect(result.settings).toEqual(updated)
    })
  })

  describe('settings:get-workspace', () => {
    it('returns workspace-specific settings', () => {
      const settings = { overrides: { appearance: { theme: 'light' } } }
      vi.mocked(settingsStore.getWorkspaceSettings).mockReturnValue(settings as any)
      const handler = captureHandler('settings:get-workspace')
      const result = handler({}, { workspaceId: 'ws-1' }) as { settings: unknown }
      expect(settingsStore.getWorkspaceSettings).toHaveBeenCalledWith('ws-1')
      expect(result.settings).toEqual(settings)
    })
  })

  describe('settings:update-workspace', () => {
    it('calls updateWorkspaceSettings with workspaceId and patch', () => {
      const updated = { overrides: { terminal: { scrollbackLimit: 5000 } } }
      vi.mocked(settingsStore.updateWorkspaceSettings).mockReturnValue(updated as any)
      const handler = captureHandler('settings:update-workspace')
      const result = handler(
        {},
        { workspaceId: 'ws-1', patch: { terminal: { scrollbackLimit: 5000 } } }
      ) as { settings: unknown }
      expect(settingsStore.updateWorkspaceSettings).toHaveBeenCalledWith('ws-1', {
        terminal: { scrollbackLimit: 5000 },
      })
      expect(result.settings).toEqual(updated)
    })
  })
})
