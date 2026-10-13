import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('electron-store', () => {
  const stores: Record<string, Record<string, unknown>> = {}
  return {
    default: class MockStore {
      onDidAnyChange() {
        return () => {}
      }
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

function useEmptyStores(): void {
  beforeEach(() => {
    vi.resetModules()
  })
}

describe('settings-store', () => {
  useEmptyStores()

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
})

describe('settings-store — notification overrides and merging', () => {
  useEmptyStores()

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
})

describe('settings-store — refused values', () => {
  useEmptyStores()

  it('updateGlobalSettings refuses a value the settings schema rejects and keeps what was stored', async () => {
    const { getGlobalSettings, updateGlobalSettings } = await import(
      '../../../src/main/storage/settings-store'
    )
    const before = getGlobalSettings().terminal.scrollbackLimit
    expect(() => updateGlobalSettings({ terminal: { scrollbackLimit: 5 } })).toThrow()
    expect(getGlobalSettings().terminal.scrollbackLimit).toBe(before)
  })

  it('updateWorkspaceSettings refuses an override the settings schema rejects', async () => {
    const { getWorkspaceSettings, updateWorkspaceSettings } = await import(
      '../../../src/main/storage/settings-store'
    )
    expect(() => updateWorkspaceSettings('ws-bad', { appearance: { theme: 'purple' } })).toThrow()
    expect(getWorkspaceSettings('ws-bad').overrides).toEqual({})
  })
})

describe('settings-store — workspace overrides', () => {
  useEmptyStores()

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
})

describe('settings-store — handing a workspace override back', () => {
  useEmptyStores()

  it('"Use global default" drops the override it names, and keeps the others', async () => {
    const { updateWorkspaceSettings, getWorkspaceSettings } = await import(
      '../../../src/main/storage/settings-store'
    )
    updateWorkspaceSettings('ws-reset', {
      appearance: { theme: 'light' },
      terminal: { scrollbackLimit: 2000, defaultShell: '/bin/fish' },
    })
    updateWorkspaceSettings('ws-reset', { appearance: undefined })
    updateWorkspaceSettings('ws-reset', { terminal: { scrollbackLimit: undefined } })

    expect(getWorkspaceSettings('ws-reset').overrides).toEqual({
      terminal: { defaultShell: '/bin/fish' },
    })
  })
})
