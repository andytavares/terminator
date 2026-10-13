import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { wrapDb, type ExtensionDB } from '../../../src/main/db/index'
import { dispatchChannel } from '@terminator/extension-sdk'
import type { ChannelSpec, ExtensionAPI } from '@terminator/extension-sdk'
import { partialFake } from '../../../tests/support/fakes'
import { applyTaskVaultSchema } from '../src/vault/db'

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
  bindBroadcast: vi.fn(),
}))

type Handler = () => Promise<unknown>

let db: ExtensionDB

beforeEach(() => {
  db = wrapDb(new DatabaseSync(':memory:'))
})

const disposable = () => ({ dispose: vi.fn() })

/** The API Task Vault activates with: channels collect into `handlers`, settings into `settings`. */
function taskVaultApi(handlers: Map<string, Handler>, settings: Map<string, unknown>) {
  return partialFake<ExtensionAPI>({
    db,
    ipc: partialFake<ExtensionAPI['ipc']>({
      registerHandler: vi.fn((spec: ChannelSpec) => {
        handlers.set(spec.channel, () => dispatchChannel(spec, undefined))
        return disposable()
      }),
    }),
    settings: partialFake<ExtensionAPI['settings']>({
      register: vi.fn(disposable),
      get: <T>(key: string) => (settings.get(key) ?? '0') as T,
      set: (key: string, value: unknown) => void settings.set(key, value),
    }),
    window: partialFake<ExtensionAPI['window']>({ broadcast: vi.fn(), focusSelf: vi.fn() }),
    notifications: partialFake<ExtensionAPI['notifications']>({
      showToast: vi.fn(),
      createNotification: vi.fn(),
    }),
    nativeMenu: partialFake<ExtensionAPI['nativeMenu']>({ addViewMenuItem: vi.fn(disposable) }),
    globalShortcut: partialFake<ExtensionAPI['globalShortcut']>({
      register: vi.fn(async () => disposable()),
    }),
    commands: partialFake<ExtensionAPI['commands']>({ register: vi.fn(disposable) }),
  })
}

/** Activates Task Vault on the test database; its channels and the settings it stored. */
async function activateTaskVault() {
  const handlers = new Map<string, Handler>()
  const settings = new Map<string, unknown>()
  const { activate } = await import('../src/index.ts')
  await activate(taskVaultApi(handlers, settings))
  return { handlers, settings }
}

async function activateAndGetResetHandler(): Promise<Handler> {
  return (await activateTaskVault()).handlers.get('task-vault:db.reset') as Handler
}

describe('task-vault activation', () => {
  it('moves a stale threshold earlier versions kept in the vault into its setting', async () => {
    await applyTaskVaultSchema(db)
    await db.run(
      `INSERT INTO settings (extension_id, key, value) VALUES ('task-vault', 'stale_days_threshold', '11')`
    )

    const { settings } = await activateTaskVault()

    expect(settings.get('terminator.task-vault.staleThresholdDays')).toBe(11)
    expect(await db.query(`SELECT key FROM settings WHERE extension_id = 'task-vault'`)).toEqual([])
  })
})

describe('task-vault re-initialize', () => {
  it('puts back a table the schema declares, and keeps the tasks', async () => {
    const { handlers } = await activateTaskVault()
    await db.run(
      `INSERT INTO tasks (id, text, status, source, created_at, updated_at) VALUES ('t1', 'Call', 'open', 'inbox', 'now', 'now')`
    )
    await db.exec('DROP TABLE weekly_review_actions')

    expect(await handlers.get('task-vault:db.reinit')!()).toEqual({ data: { ok: true } })

    const tables = await db.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table'`
    )
    expect(tables.map((t) => t.name)).toContain('weekly_review_actions')
    expect(await db.query(`SELECT id FROM tasks`)).toEqual([{ id: 't1' }])
  })
})

describe('task-vault reset', () => {
  it('removes its own settings and leaves another extension settings alone', async () => {
    const reset = await activateAndGetResetHandler()
    await db.exec(
      `INSERT INTO settings (extension_id, key, value) VALUES
         ('task-vault', 'stale_days_threshold', '9'),
         ('notepad', 'font_size', '14')`
    )

    const result = await reset()

    expect(result).toEqual({ data: { ok: true } })
    const rows = await db.query<{ extension_id: string; key: string }>(
      `SELECT extension_id, key FROM settings ORDER BY extension_id`
    )
    expect(rows).toEqual([{ extension_id: 'notepad', key: 'font_size' }])
  })
})
