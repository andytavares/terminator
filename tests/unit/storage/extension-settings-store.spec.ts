import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('electron-store', () => {
  const stores: Record<string, Record<string, unknown>> = {}
  return {
    default: class MockStore {
      private listeners: Array<() => void> = []
      onDidAnyChange(listener: () => void) {
        this.listeners.push(listener)
        return () => {}
      }
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
        for (const listener of this.listeners) listener()
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
})

describe('extension-settings-store — listing and overwriting', () => {
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

// A `workspaceScoped` setting's per-workspace values live in that workspace's
// settings, under `extensions`, by extension id then key.
const SIGN_OFF = {
  extensionId: 'terminator.git-integration',
  key: 'terminator.git-integration.git.commit.signOff',
}

describe("extension-settings-store — a workspace's own values", () => {
  it('stores a value for one workspace only, beside the global value', async () => {
    const { extensionSettingsSnapshot, setExtensionSetting, setWorkspaceExtensionSetting } =
      await import('../../../src/main/storage/extension-settings-store')
    setExtensionSetting(SIGN_OFF.key, false)
    setWorkspaceExtensionSetting('ws-own', { ...SIGN_OFF, value: true })

    const snapshot = extensionSettingsSnapshot()
    expect(snapshot.global[SIGN_OFF.key]).toBe(false)
    expect(snapshot.workspaces['ws-own']).toEqual({
      [SIGN_OFF.extensionId]: { [SIGN_OFF.key]: true },
    })
  })

  it('"Use global default" (no value) removes the workspace value and keeps its others', async () => {
    const { extensionSettingsSnapshot, setWorkspaceExtensionSetting } = await import(
      '../../../src/main/storage/extension-settings-store'
    )
    const enabled = { ...SIGN_OFF, key: 'terminator.git-integration.git.enabled' }
    setWorkspaceExtensionSetting('ws-reset', { ...SIGN_OFF, value: true })
    setWorkspaceExtensionSetting('ws-reset', { ...enabled, value: false })
    setWorkspaceExtensionSetting('ws-reset', { ...SIGN_OFF, value: undefined })

    expect(extensionSettingsSnapshot().workspaces['ws-reset']).toEqual({
      [SIGN_OFF.extensionId]: { [enabled.key]: false },
    })
  })
})

describe("extension-settings-store — a workspace's own values beside its core overrides", () => {
  it("leaves the workspace's core overrides alone", async () => {
    const { setWorkspaceExtensionSetting } = await import(
      '../../../src/main/storage/extension-settings-store'
    )
    const { getWorkspaceSettings, updateWorkspaceSettings } = await import(
      '../../../src/main/storage/settings-store'
    )
    updateWorkspaceSettings('ws-core', { terminal: { defaultShell: '/bin/fish' } })
    setWorkspaceExtensionSetting('ws-core', { ...SIGN_OFF, value: true })

    expect(getWorkspaceSettings('ws-core').overrides).toEqual({
      terminal: { defaultShell: '/bin/fish' },
    })
  })
})

describe('extension-settings-store — which scope a change was made in', () => {
  it('says the workspace for a workspace value, and null for a global one', async () => {
    const { onExtensionSettingsChanged, setExtensionSetting, setWorkspaceExtensionSetting } =
      await import('../../../src/main/storage/extension-settings-store')
    const changes: unknown[] = []
    onExtensionSettingsChanged((change) => changes.push(change))

    setWorkspaceExtensionSetting('ws-event', { ...SIGN_OFF, value: true })
    setExtensionSetting(SIGN_OFF.key, true)

    expect(changes).toEqual([{ workspaceId: 'ws-event' }, { workspaceId: null }])
  })
})
