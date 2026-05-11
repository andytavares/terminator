import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('electron-store', () => {
  const stores: Record<string, Record<string, unknown>> = {}
  return {
    default: class MockStore {
      private data: Record<string, unknown>
      constructor({ name, defaults }: { name: string; defaults: Record<string, unknown> }) {
        if (!stores[name]) stores[name] = { ...defaults }
        this.data = stores[name]
      }
      get(key: string) {
        return this.data[key]
      }
      set(key: string, value: unknown) {
        this.data[key] = value
      }
    },
  }
})

beforeEach(() => {
  vi.resetModules()
})

describe('extension-settings-store', () => {
  it('getExtensionSetting returns undefined for unknown key', async () => {
    const { getExtensionSetting } = await import(
      '../../../src/main/storage/extension-settings-store'
    )
    expect(getExtensionSetting('nonexistent.key')).toBeUndefined()
  })

  it('setExtensionSetting persists a value readable by getExtensionSetting', async () => {
    const { getExtensionSetting, setExtensionSetting } = await import(
      '../../../src/main/storage/extension-settings-store'
    )
    setExtensionSetting('com.test.token', 'abc123')
    expect(getExtensionSetting('com.test.token')).toBe('abc123')
  })

  it('getAllExtensionSettings returns all stored key-value pairs', async () => {
    const { setExtensionSetting, getAllExtensionSettings } = await import(
      '../../../src/main/storage/extension-settings-store'
    )
    setExtensionSetting('com.test.a', 1)
    setExtensionSetting('com.test.b', true)
    const all = getAllExtensionSettings()
    expect(all['com.test.a']).toBe(1)
    expect(all['com.test.b']).toBe(true)
  })

  it('setExtensionSetting overwrites existing value', async () => {
    const { getExtensionSetting, setExtensionSetting } = await import(
      '../../../src/main/storage/extension-settings-store'
    )
    setExtensionSetting('com.test.key', 'first')
    setExtensionSetting('com.test.key', 'second')
    expect(getExtensionSetting('com.test.key')).toBe('second')
  })
})
