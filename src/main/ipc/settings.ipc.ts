import { ipcMain } from 'electron'
import {
  getGlobalSettings,
  updateGlobalSettings,
  getWorkspaceSettings,
  updateWorkspaceSettings,
} from '../storage/settings-store.js'

export function registerSettingsHandlers(
  onRemoteControlChange?: (enabled: boolean) => Promise<void>
): void {
  ipcMain.handle('settings:get-global', () => {
    return { settings: getGlobalSettings() }
  })

  ipcMain.handle('settings:update-global', (_event, { patch }) => {
    const before = getGlobalSettings().remoteControl?.enabled
    const result = { settings: updateGlobalSettings(patch) }
    const after = result.settings.remoteControl?.enabled
    if (onRemoteControlChange && before !== after) {
      // Fire-and-forget through the caller's queue; errors are caught inside start/stop
      onRemoteControlChange(after ?? false).catch(() => {})
    }
    return result
  })

  ipcMain.handle('settings:get-workspace', (_event, { workspaceId }) => {
    return { settings: getWorkspaceSettings(workspaceId) }
  })

  ipcMain.handle('settings:update-workspace', (_event, { workspaceId, patch }) => {
    return { settings: updateWorkspaceSettings(workspaceId, patch) }
  })
}
