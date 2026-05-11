import Store from 'electron-store'

interface ExtensionSettingsStoreSchema {
  values: Record<string, unknown>
}

const store = new Store<ExtensionSettingsStoreSchema>({
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

export function getAllExtensionSettings(): Record<string, unknown> {
  return store.get('values')
}
