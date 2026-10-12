import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { wrapDb } from '../../../src/main/db/index'
import type { ExtensionAPI } from '../../../src/main/extensions/api'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn().mockReturnValue([]) },
  globalShortcut: { register: vi.fn(), unregister: vi.fn() },
}))
vi.mock('../src/ipc/vault.ipc.js', () => ({ registerVaultIpcHandlers: vi.fn(() => vi.fn()) }))
vi.mock('../src/ipc/projects.ipc.js', () => ({
  registerProjectsIpcHandlers: vi.fn(() => vi.fn()),
}))
vi.mock('../src/ipc/links.ipc.js', () => ({ registerLinksIpcHandlers: vi.fn(() => vi.fn()) }))
vi.mock('../src/ipc/kanban.ipc.js', () => ({ registerKanbanIpcHandlers: vi.fn(() => vi.fn()) }))
vi.mock('../src/ipc/admin.ipc.js', () => ({ registerAdminIpcHandlers: vi.fn(() => vi.fn()) }))
vi.mock('../src/ipc/weekly-review.ipc.js', () => ({
  registerWeeklyReviewIpcHandlers: vi.fn(() => vi.fn()),
}))
vi.mock('../src/notifications/task-scheduler.js', () => ({
  startTaskScheduler: vi.fn(() => ({ dispose: vi.fn(), tick: vi.fn() })),
  setSchedulerTick: vi.fn(),
}))

type Handler = () => Promise<unknown>

let pg: PGlite

beforeEach(async () => {
  pg = new PGlite()
  await pg.waitReady
})

afterEach(async () => {
  await pg.close()
})

async function activateAndGetResetHandler(): Promise<Handler> {
  const handlers = new Map<string, Handler>()
  const api = {
    db: wrapDb(pg),
    ipc: {
      registerHandler: vi.fn((channel: string, handler: Handler) => {
        handlers.set(channel, handler)
        return { dispose: vi.fn() }
      }),
    },
    settings: { register: vi.fn(() => ({ dispose: vi.fn() })), get: vi.fn(() => '0') },
    window: { broadcast: vi.fn(), focusSelf: vi.fn() },
    notifications: { showToast: vi.fn(), createNotification: vi.fn() },
    nativeMenu: { addViewMenuItem: vi.fn(() => ({ dispose: vi.fn() })) },
    globalShortcut: { register: vi.fn(() => ({ dispose: vi.fn() })) },
    commands: { register: vi.fn(() => ({ dispose: vi.fn() })) },
  } as unknown as ExtensionAPI
  const { activate } = await import('../src/index.ts')
  await activate(api)
  return handlers.get('task-vault:db.reset') as Handler
}

describe('task-vault reset', () => {
  it('removes its own settings and leaves another extension settings alone', async () => {
    const reset = await activateAndGetResetHandler()
    await pg.query(
      `INSERT INTO settings (extension_id, key, value) VALUES
         ('task-vault', 'stale_days_threshold', '9'),
         ('notepad', 'font_size', '14')`
    )

    const result = await reset()

    expect(result).toEqual({ data: { ok: true } })
    const rows = await pg.query<{ extension_id: string; key: string }>(
      `SELECT extension_id, key FROM settings ORDER BY extension_id`
    )
    expect(rows.rows).toEqual([{ extension_id: 'notepad', key: 'font_size' }])
  })
})
