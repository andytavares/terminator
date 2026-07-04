import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('electron-store', () => {
  const stores: Record<string, Record<string, unknown>> = {}
  return {
    default: class MockStore {
      private name: string
      private data: Record<string, unknown>
      constructor({ name, defaults }: { name: string; defaults: Record<string, unknown> }) {
        this.name = name
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

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))

describe('settings-store', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('getGlobalSettings returns defaults', async () => {
    const { getGlobalSettings } = await import('../../../src/main/storage/settings-store')
    const settings = getGlobalSettings()
    expect(settings.appearance.theme).toBe('dark')
    expect(settings.terminal.scrollbackLimit).toBe(10000)
    expect(settings.notifications).toEqual({
      defaultTargets: ['system', 'center', 'toast'],
      overrides: {},
    })
  })

  it('updateGlobalSettings replaces the notifications default targets', async () => {
    const { getGlobalSettings, updateGlobalSettings } = await import(
      '../../../src/main/storage/settings-store'
    )
    updateGlobalSettings({ notifications: { defaultTargets: ['toast'] } })
    const settings = getGlobalSettings()
    expect(settings.notifications.defaultTargets).toEqual(['toast'])
    expect(settings.notifications.overrides).toEqual({})
  })

  it('updateGlobalSettings patches a single core notification override without clobbering others', async () => {
    const { getGlobalSettings, updateGlobalSettings } = await import(
      '../../../src/main/storage/settings-store'
    )
    updateGlobalSettings({
      notifications: { overrides: { terminalBell: ['system'] } },
    })
    updateGlobalSettings({
      notifications: { overrides: { branchSwitchFailed: ['toast'] } },
    })
    const settings = getGlobalSettings()
    expect(settings.notifications.overrides).toEqual({
      terminalBell: ['system'],
      branchSwitchFailed: ['toast'],
    })
  })

  it('updateGlobalSettings merges patch', async () => {
    const { getGlobalSettings, updateGlobalSettings } = await import(
      '../../../src/main/storage/settings-store'
    )
    updateGlobalSettings({ appearance: { theme: 'light' } })
    const settings = getGlobalSettings()
    expect(settings.appearance.theme).toBe('light')
  })

  it('getWorkspaceSettings returns global defaults when no override', async () => {
    const { getWorkspaceSettings } = await import('../../../src/main/storage/settings-store')
    const ws = getWorkspaceSettings('non-existent-id')
    expect(ws.workspaceId).toBe('non-existent-id')
    expect(ws.overrides).toEqual({})
  })

  it('updateWorkspaceSettings stores workspace-scoped override', async () => {
    const { updateWorkspaceSettings, getWorkspaceSettings } = await import(
      '../../../src/main/storage/settings-store'
    )
    updateWorkspaceSettings('ws-1', { appearance: { theme: 'light' } })
    const ws = getWorkspaceSettings('ws-1')
    expect(ws.overrides?.appearance?.theme).toBe('light')
  })

  it('workspace override takes precedence — test via resolveSettings logic', async () => {
    const {
      updateGlobalSettings,
      updateWorkspaceSettings,
      getGlobalSettings,
      getWorkspaceSettings,
    } = await import('../../../src/main/storage/settings-store')
    updateGlobalSettings({ appearance: { theme: 'dark' } })
    updateWorkspaceSettings('ws-override', { appearance: { theme: 'light' } })
    const global = getGlobalSettings()
    const ws = getWorkspaceSettings('ws-override')
    const resolved = {
      ...global,
      appearance: { ...global.appearance, ...ws.overrides?.appearance },
    }
    expect(resolved.appearance.theme).toBe('light')
  })
})
