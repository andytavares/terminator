import { CachedStore } from './cached-store.js'
import {
  DEFAULT_GLOBAL_SETTINGS,
  GlobalSettingsSchema,
  WorkspaceSettingsSchema,
  type GlobalSettings,
  type WorkspaceSettings,
} from '../../shared/schemas/settings.schema.js'

interface StoreSchema {
  global: GlobalSettings
  workspaces: Record<string, WorkspaceSettings>
}

const store = new CachedStore<StoreSchema>({
  name: 'settings',
  defaults: {
    global: DEFAULT_GLOBAL_SETTINGS,
    workspaces: {},
  },
})

export function getGlobalSettings(): GlobalSettings {
  // Always normalize against defaults so schema migrations don't surface missing fields
  return deepMerge(DEFAULT_GLOBAL_SETTINGS, store.get('global') as Partial<GlobalSettings>)
}

/** Throws a ZodError, and stores nothing, when the merged settings break the schema. */
export function updateGlobalSettings(patch: unknown): GlobalSettings {
  const current = getGlobalSettings()
  const merged = GlobalSettingsSchema.parse(deepMerge(current, patch as Partial<GlobalSettings>))
  store.set('global', merged)
  return merged
}

export function getWorkspaceSettings(workspaceId: string): WorkspaceSettings {
  const workspaces = store.get('workspaces')
  return workspaces[workspaceId] ?? { workspaceId, overrides: {}, extensions: {} }
}

/** Throws a ZodError, and stores nothing, when the merged override breaks the schema. */
export function updateWorkspaceSettings(workspaceId: string, patch: unknown): WorkspaceSettings {
  const workspaces = store.get('workspaces')
  const current = workspaces[workspaceId] ?? { workspaceId, overrides: {}, extensions: {} }
  const overrides = WorkspaceSettingsSchema.shape.overrides.parse(
    deepMerge(current.overrides ?? {}, (patch as WorkspaceSettings['overrides']) ?? {})
  )
  const updated: WorkspaceSettings = { ...current, overrides }
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
