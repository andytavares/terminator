import { CachedStore } from './cached-store.js'

interface ExtensionSettingsStoreSchema {
  values: Record<string, unknown>
}

const store = new CachedStore<ExtensionSettingsStoreSchema>({
  name: 'extension-settings',
  defaults: { values: {} },
})

export function getExtensionSetting(key: string): unknown {
  return store.get('values')[key]
}

export function setExtensionSetting(key: string, value: unknown): void {
  const values = store.get('values')
  store.set('values', { ...values, [key]: value })
}

export function onExtensionSettingsChanged(listener: () => void): () => void {
  return store.onChange(listener)
}

export function getAllExtensionSettings(): Record<string, unknown> {
  return store.get('values')
}
