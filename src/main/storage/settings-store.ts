import Store from 'electron-store'
import type { GlobalSettings, WorkspaceSettings } from '../../shared/types/index.js'
import { DEFAULT_GLOBAL_SETTINGS } from '../../shared/schemas/settings.schema.js'

interface StoreSchema {
  global: GlobalSettings
  workspaces: Record<string, WorkspaceSettings>
}

const store = new Store<StoreSchema>({
  name: 'settings',
  defaults: {
    global: DEFAULT_GLOBAL_SETTINGS,
    workspaces: {},
  },
})

export function getGlobalSettings(): GlobalSettings {
  // Always normalize against defaults so schema migrations don't surface missing fields
  return deepMerge(DEFAULT_GLOBAL_SETTINGS as unknown as GlobalSettings, store.get('global') as Partial<GlobalSettings>)
}

export function updateGlobalSettings(patch: unknown): GlobalSettings {
  const current = getGlobalSettings()
  const merged = deepMerge(current, patch as Partial<GlobalSettings>)
  store.set('global', merged)
  return merged
}

export function getWorkspaceSettings(workspaceId: string): WorkspaceSettings {
  const workspaces = store.get('workspaces')
  return workspaces[workspaceId] ?? { workspaceId, overrides: {}, extensions: {} }
}

export function updateWorkspaceSettings(workspaceId: string, patch: unknown): WorkspaceSettings {
  const workspaces = store.get('workspaces')
  const current = workspaces[workspaceId] ?? { workspaceId, overrides: {}, extensions: {} }
  const updated: WorkspaceSettings = {
    ...current,
    overrides: deepMerge(current.overrides ?? {}, (patch as Partial<GlobalSettings>) ?? {}),
  }
  store.set('workspaces', { ...workspaces, [workspaceId]: updated })
  return updated
}

function deepMerge<T>(target: T, source: Partial<T>): T {
  const result = { ...target }
  for (const key in source) {
    const val = source[key]
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      result[key] = deepMerge(result[key] as object, val as object) as T[typeof key]
    } else if (val !== undefined) {
      result[key] = val as T[typeof key]
    }
  }
  return result
}
