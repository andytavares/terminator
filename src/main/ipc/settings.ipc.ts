import { handleChannel } from './channel-registrar.js'
import {
  getGlobalSettings,
  updateGlobalSettings,
  getWorkspaceSettings,
  updateWorkspaceSettings,
} from '../storage/settings-store.js'

export function registerSettingsHandlers(): void {
  handleChannel('settings:get-global', () => {
    return { settings: getGlobalSettings() }
  })

  handleChannel('settings:update-global', (_event, { patch }) => {
    return { settings: updateGlobalSettings(patch) }
  })

  handleChannel('settings:get-workspace', (_event, { workspaceId }) => {
    return { settings: getWorkspaceSettings(workspaceId) }
  })

  handleChannel('settings:update-workspace', (_event, { workspaceId, patch }) => {
    return { settings: updateWorkspaceSettings(workspaceId, patch) }
  })
}
