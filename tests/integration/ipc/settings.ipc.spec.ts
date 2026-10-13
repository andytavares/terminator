import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DEFAULT_GLOBAL_SETTINGS } from '../../../src/shared/schemas/settings.schema'

type Handler = (event: unknown, payload?: unknown) => unknown
const handlers = vi.hoisted(() => new Map<string, Handler>())

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
}))
vi.mock('electron-store', async () =>
  (await import('../../support/stores')).inMemoryElectronStore()
)

function invoke(channel: string, payload?: unknown): Promise<unknown> {
  return Promise.resolve(handlers.get(channel)!({}, payload))
}

beforeEach(async () => {
  vi.resetModules()
  handlers.clear()
  const { registerSettingsHandlers } = await import('../../../src/main/ipc/settings.ipc')
  registerSettingsHandlers()
})

describe('settings:get-global', () => {
  it('answers the defaults before anything has been changed', async () => {
    expect(await invoke('settings:get-global')).toEqual({ settings: DEFAULT_GLOBAL_SETTINGS })
  })
})

describe('settings:update-global', () => {
  it('keeps the merged patch and answers the merged settings', async () => {
    const reply = await invoke('settings:update-global', {
      patch: { appearance: { theme: 'light' } },
    })

    expect(reply).toEqual({
      settings: {
        ...DEFAULT_GLOBAL_SETTINGS,
        appearance: { ...DEFAULT_GLOBAL_SETTINGS.appearance, theme: 'light' },
      },
    })
    expect(await invoke('settings:get-global')).toEqual(reply)
  })

  it('answers VALIDATION_ERROR and keeps what was stored when the merge breaks the schema', async () => {
    const reply = await invoke('settings:update-global', {
      patch: { terminal: { scrollbackLimit: 5 } },
    })

    expect(reply).toEqual({ error: 'VALIDATION_ERROR' })
    expect(await invoke('settings:get-global')).toEqual({ settings: DEFAULT_GLOBAL_SETTINGS })
  })
})

describe('settings:update-workspace', () => {
  it('keeps the override for that workspace and no other', async () => {
    const patch = { terminal: { scrollbackLimit: 5000 } }

    expect(await invoke('settings:update-workspace', { workspaceId: 'ws-2', patch })).toEqual({
      settings: { workspaceId: 'ws-2', overrides: patch, extensions: {} },
    })
    expect(await invoke('settings:get-workspace', { workspaceId: 'ws-2' })).toEqual({
      settings: { workspaceId: 'ws-2', overrides: patch, extensions: {} },
    })
    expect(await invoke('settings:get-workspace', { workspaceId: 'ws-1' })).toEqual({
      settings: { workspaceId: 'ws-1', overrides: {}, extensions: {} },
    })
  })

  it('answers VALIDATION_ERROR and keeps nothing when the override breaks the schema', async () => {
    const reply = await invoke('settings:update-workspace', {
      workspaceId: 'ws-1',
      patch: { appearance: { theme: 'neon' } },
    })

    expect(reply).toEqual({ error: 'VALIDATION_ERROR' })
    expect(await invoke('settings:get-workspace', { workspaceId: 'ws-1' })).toEqual({
      settings: { workspaceId: 'ws-1', overrides: {}, extensions: {} },
    })
  })
})

describe('settings:update-workspace — handing an override back', () => {
  it('hands a setting back to the global value when the patch sets it to undefined', async () => {
    const theme = { appearance: { theme: 'light' } }
    await invoke('settings:update-workspace', { workspaceId: 'ws-3', patch: theme })

    const reply = await invoke('settings:update-workspace', {
      workspaceId: 'ws-3',
      patch: { appearance: undefined },
    })

    expect(reply).toEqual({ settings: { workspaceId: 'ws-3', overrides: {}, extensions: {} } })
  })
})
