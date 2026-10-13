import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DEFAULT_GLOBAL_SETTINGS } from '../../../src/shared/schemas/settings.schema'

type Handler = (event: unknown, payload?: unknown) => unknown
const handlers = vi.hoisted(() => new Map<string, Handler>())

function fakeWindow({ minimized = false, destroyed = false } = {}) {
  return {
    isDestroyed: () => destroyed,
    isMinimized: () => minimized,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    webContents: { isDestroyed: () => destroyed, send: vi.fn() },
  }
}
const windows = vi.hoisted(() => [] as Array<ReturnType<typeof fakeWindow>>)

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
  Notification: { isSupported: () => false },
  app: { dock: null },
  BrowserWindow: { getAllWindows: () => windows },
}))
vi.mock('electron-store', async () =>
  (await import('../../support/stores')).inMemoryElectronStore()
)

function invoke<T = unknown>(channel: string, payload?: unknown): Promise<T> {
  return Promise.resolve(handlers.get(channel)!({}, payload)) as Promise<T>
}

async function create(payload: Record<string, unknown>): Promise<string> {
  const { id } = await invoke<{ id: string }>('notifications:create', {
    type: 'info',
    title: 'Build finished',
    key: 'buildFinished',
    ...payload,
  })
  return id
}

// The real notification manager and settings store; only Electron is faked.
beforeEach(async () => {
  vi.resetModules()
  handlers.clear()
  windows.length = 0
  const { registerNotificationHandlers } = await import('../../../src/main/ipc/notification.ipc')
  registerNotificationHandlers()
})

describe('notifications:create', () => {
  it('lists the notification, delivered where the settings say rather than where the caller asks', async () => {
    const id = await create({ source: 'terminator.task-vault', targets: ['system'] })

    expect(await invoke('notifications:list')).toEqual([
      expect.objectContaining({
        id,
        type: 'info',
        title: 'Build finished',
        source: 'terminator.task-vault',
        clickable: false,
        targets: DEFAULT_GLOBAL_SETTINGS.notifications.defaultTargets,
      }),
    ])
  })
})

describe('notifications:dismiss', () => {
  it('takes the notification off the list', async () => {
    const id = await create({})

    expect(await invoke('notifications:dismiss', { id })).toEqual({ ok: true })

    expect(await invoke('notifications:list')).toEqual([])
  })
})

describe('notifications:trigger-action', () => {
  it('opening a notification about a session reveals it in every live window and keeps the row', async () => {
    const minimized = fakeWindow({ minimized: true })
    const destroyed = fakeWindow({ destroyed: true })
    windows.push(minimized, destroyed)
    const id = await create({ sessionId: 'ses-1' })

    expect(
      await invoke('notifications:trigger-action', { notifId: id, actionId: '__open__' })
    ).toEqual({ ok: true })

    expect(minimized.restore).toHaveBeenCalled()
    expect(minimized.show).toHaveBeenCalled()
    expect(minimized.focus).toHaveBeenCalled()
    expect(minimized.webContents.send).toHaveBeenCalledWith('terminal:navigate-to-session', {
      sessionId: 'ses-1',
    })
    expect(destroyed.show).not.toHaveBeenCalled()
    expect(await invoke('notifications:list')).toEqual([expect.objectContaining({ id })])
  })
})

describe('notifications:trigger-action — refusals', () => {
  it('cannot open a notification that is not about a session', async () => {
    const id = await create({})

    expect(
      await invoke('notifications:trigger-action', { notifId: id, actionId: '__open__' })
    ).toEqual({ error: 'UNKNOWN_ACTION' })
  })

  it('answers UNKNOWN_NOTIFICATION once the notification is gone', async () => {
    const id = await create({})
    await invoke('notifications:dismiss', { id })

    expect(await invoke('notifications:trigger-action', { notifId: id, actionId: 'go' })).toEqual({
      error: 'UNKNOWN_NOTIFICATION',
    })
  })
})
