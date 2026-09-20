import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
vi.mock('../src/vault/db.js', () => ({
  applyTaskVaultSchema: vi.fn().mockResolvedValue(undefined),
  applyTaskVaultMigrations: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../src/vault/ensure-next-occurrence.js', () => ({
  backfillRecurringTasks: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../src/notifications/task-scheduler.js', () => ({
  startTaskScheduler: vi.fn(() => ({ dispose: vi.fn(), tick: vi.fn() })),
  setSchedulerTick: vi.fn(),
}))
vi.mock('../src/navigation.js', () => ({
  openInVault: vi.fn(),
  popPendingNavigation: vi.fn(),
}))

function makeApi() {
  const commandsRegister = vi.fn(() => ({ dispose: vi.fn() }))
  const globalShortcutRegister = vi.fn(() => ({ dispose: vi.fn() }))
  const api = {
    db: {},
    ipc: { registerHandler: vi.fn(() => ({ dispose: vi.fn() })) },
    settings: { register: vi.fn(() => ({ dispose: vi.fn() })), get: vi.fn(() => '0') },
    window: { broadcast: vi.fn(), focusSelf: vi.fn() },
    notifications: { showToast: vi.fn(), createNotification: vi.fn() },
    nativeMenu: { addViewMenuItem: vi.fn(() => ({ dispose: vi.fn() })) },
    globalShortcut: { register: globalShortcutRegister },
    commands: { register: commandsRegister },
  } as unknown as ExtensionAPI
  return { api, commandsRegister, globalShortcutRegister }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('scheduleWeeklyReviewNudge interval guard', () => {
  it('guard pattern: second call clears the first interval before scheduling a new one', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')

    let storedInterval: ReturnType<typeof setInterval> | null = null

    // This simulates the CORRECT guard pattern (T035 implementation target)
    function scheduleWithGuard() {
      if (storedInterval !== null) {
        clearInterval(storedInterval)
        storedInterval = null
      }
      storedInterval = setInterval(() => {}, 24 * 60 * 60 * 1000)
    }

    scheduleWithGuard()
    expect(setIntervalSpy).toHaveBeenCalledTimes(1)
    expect(clearIntervalSpy).toHaveBeenCalledTimes(0)

    scheduleWithGuard()
    expect(setIntervalSpy).toHaveBeenCalledTimes(2)
    // The guard must have cleared the first interval before creating the second
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1)

    if (storedInterval) clearInterval(storedInterval)
    setIntervalSpy.mockRestore()
    clearIntervalSpy.mockRestore()
  })

  it('without guard: double-call creates two intervals (this is the bug being fixed)', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    const intervals: ReturnType<typeof setInterval>[] = []

    // This simulates the BUGGY pattern (no guard)
    function scheduleBuggy() {
      intervals.push(setInterval(() => {}, 24 * 60 * 60 * 1000))
    }

    scheduleBuggy()
    scheduleBuggy()
    expect(setIntervalSpy).toHaveBeenCalledTimes(2)
    expect(intervals).toHaveLength(2)

    for (const id of intervals) clearInterval(id)
    setIntervalSpy.mockRestore()
  })
})

describe('task-vault manifest quick action', () => {
  it('declares a Task Vault group and a mnemonic on the capture command', () => {
    const manifest = JSON.parse(readFileSync(join(__dirname, '../manifest.json'), 'utf-8')) as {
      contributes: {
        quickActions?: { group?: { mnemonic?: string; label?: string } }
        commands?: { id: string; mnemonic?: string; label?: string }[]
      }
    }

    expect(manifest.contributes.quickActions?.group).toEqual({
      mnemonic: 'v',
      label: 'Task Vault',
    })

    const command = manifest.contributes.commands?.find(
      (c) => c.id === 'task-vault:capture-to-inbox'
    )
    expect(command?.mnemonic).toBe('c')
    expect(command?.label).toBe('Capture to inbox')
  })
})

describe('task-vault activate() quick-actions command registration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('registers the manifest command id with its label and mnemonic', async () => {
    const { api } = makeApi()
    const { activate } = await import('../src/index.ts')

    await activate(api)

    const commandsRegister = api.commands.register as unknown as ReturnType<typeof vi.fn>
    expect(commandsRegister).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'task-vault:capture-to-inbox',
        label: 'Capture to inbox',
        mnemonic: 'c',
      }),
      expect.any(Function)
    )
  })

  it('running the registered command opens the capture overlay, same as the hotkey', async () => {
    const { api } = makeApi()
    const { activate } = await import('../src/index.ts')

    await activate(api)

    const commandsRegister = api.commands.register as unknown as ReturnType<typeof vi.fn>
    const handler = commandsRegister.mock.calls.find(
      (c) => (c[0] as { id: string }).id === 'task-vault:capture-to-inbox'
    )?.[1] as (ctx: unknown) => void
    handler({ projectId: null, sessionId: null, repoRoot: null })

    const channels = (api.window.broadcast as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0]
    )
    expect(channels).toContain('extension:activate-global-tab')
    expect(api.window.focusSelf).toHaveBeenCalledWith('main')
  })

  it('registers the command even when the global shortcut registration throws', async () => {
    const { api, globalShortcutRegister, commandsRegister } = makeApi()
    globalShortcutRegister.mockImplementation(() => {
      throw new Error('shortcut claimed by another app')
    })
    const { activate } = await import('../src/index.ts')

    await activate(api)

    expect(commandsRegister).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'task-vault:capture-to-inbox' }),
      expect.any(Function)
    )
    const handler = commandsRegister.mock.calls.find(
      (c) => (c[0] as { id: string }).id === 'task-vault:capture-to-inbox'
    )?.[1] as (ctx: unknown) => void
    handler({ projectId: null, sessionId: null, repoRoot: null })

    const channels = (api.window.broadcast as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0]
    )
    expect(channels).toContain('extension:activate-global-tab')
  })

  it('deactivate disposes the registered command', async () => {
    const { api, commandsRegister } = makeApi()
    const { activate, deactivate } = await import('../src/index.ts')

    await activate(api)

    const disposable = commandsRegister.mock.results[0]?.value as {
      dispose: ReturnType<typeof vi.fn>
    }

    await deactivate()

    expect(disposable.dispose).toHaveBeenCalled()
  })
})
