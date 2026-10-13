import type { SettingsChange } from '@terminator/extension-sdk'
import { CachedStore } from './cached-store.js'
import {
  listWorkspaceExtensionSettings,
  writeWorkspaceExtensionSetting,
  type WorkspaceExtensionSettingChange,
} from './settings-store.js'
import type { ExtensionSettingsSnapshot } from '../extensions/setting-scope.js'
import type { WorkspaceSettings } from '../../shared/schemas/settings.schema.js'

interface ExtensionSettingsStoreSchema {
  values: Record<string, unknown>
}

const store = new CachedStore<ExtensionSettingsStoreSchema>({
  name: 'extension-settings',
  defaults: { values: {} },
})

const workspaceListeners = new Set<(change: SettingsChange) => void>()

export function getExtensionSetting(key: string): unknown {
  return store.get('values')[key]
}

export function setExtensionSetting(key: string, value: unknown): void {
  const values = store.get('values')
  store.set('values', { ...values, [key]: value })
}

/** Sets a `workspaceScoped` setting for one workspace, in that workspace's settings; no value
 * hands it back to the global one ("Use global default"). */
export function setWorkspaceExtensionSetting(
  workspaceId: string,
  change: WorkspaceExtensionSettingChange
): WorkspaceSettings {
  const updated = writeWorkspaceExtensionSetting(workspaceId, change)
  for (const listener of workspaceListeners) listener({ workspaceId })
  return updated
}

/** Calls `listener` after any change, with the workspace it was made in, or null for a global one. */
export function onExtensionSettingsChanged(listener: (change: SettingsChange) => void): () => void {
  workspaceListeners.add(listener)
  const stopGlobal = store.onAnyChange(() => listener({ workspaceId: null }))
  return () => {
    workspaceListeners.delete(listener)
    stopGlobal()
  }
}

export function getAllExtensionSettings(): Record<string, unknown> {
  return store.get('values')
}

/** Every value set, globally and per workspace, as the extension host reads them. */
export function extensionSettingsSnapshot(): ExtensionSettingsSnapshot {
  return { global: getAllExtensionSettings(), workspaces: listWorkspaceExtensionSettings() }
}
