import { ipcMain } from 'electron'
import {
  getGlobalSettings,
  updateGlobalSettings,
  getWorkspaceSettings,
  updateWorkspaceSettings,
} from '../storage/settings-store.js'

export function registerSettingsHandlers(): void {
  ipcMain.handle('settings:get-global', () => {
    return { settings: getGlobalSettings() }
  })

  ipcMain.handle('settings:update-global', (_event, { patch }) => {
    return { settings: updateGlobalSettings(patch) }
  })

  ipcMain.handle('settings:get-workspace', (_event, { workspaceId }) => {
    return { settings: getWorkspaceSettings(workspaceId) }
  })

  ipcMain.handle('settings:update-workspace', (_event, { workspaceId, patch }) => {
    return { settings: updateWorkspaceSettings(workspaceId, patch) }
  })
}
