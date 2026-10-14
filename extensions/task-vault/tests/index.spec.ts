import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ExtensionAPI } from '@terminator/extension-sdk'
import { partialFake } from '../../../tests/support/fakes'
import { disposableSpy } from './support/disposable'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
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
}))
vi.mock('../src/vault/ensure-next-occurrence.js', () => ({
  backfillRecurringTasks: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../src/notifications/task-scheduler.js', () => ({
  startTaskScheduler: vi.fn(() => ({ dispose: vi.fn(), tick: vi.fn() })),
  setSchedulerTick: vi.fn(),
  bindBroadcast: vi.fn(),
}))
vi.mock('../src/navigation.js', () => ({
  openInVault: vi.fn(),
  popPendingNavigation: vi.fn(),
}))

/** The API Task Vault activates with; settings not in `settings` read as '0'. */
function makeApi(settings: Record<string, unknown> = {}) {
  const commandsRegister = vi.fn<ExtensionAPI['commands']['register']>(disposableSpy)
  const globalShortcutRegister = vi.fn(async () => disposableSpy())
  const api = partialFake<ExtensionAPI>({
    db: partialFake<ExtensionAPI['db']>({ get: vi.fn(async () => undefined) }),
    ipc: partialFake<ExtensionAPI['ipc']>({ registerHandler: vi.fn(disposableSpy) }),
    settings: partialFake<ExtensionAPI['settings']>({
      register: vi.fn(disposableSpy),
      get: <T>(key: string) => (settings[key] ?? '0') as T,
    }),
    window: partialFake<ExtensionAPI['window']>({
      broadcast: vi.fn(),
      focusSelf: vi.fn(),
      raise: vi.fn(),
    }),
    notifications: partialFake<ExtensionAPI['notifications']>({
      showToast: vi.fn(),
      createNotification: vi.fn(disposableSpy),
    }),
    nativeMenu: partialFake<ExtensionAPI['nativeMenu']>({ addViewMenuItem: vi.fn(disposableSpy) }),
    globalShortcut: partialFake<ExtensionAPI['globalShortcut']>({
      register: globalShortcutRegister,
    }),
    commands: partialFake<ExtensionAPI['commands']>({ register: commandsRegister }),
  })
  return { api, commandsRegister, globalShortcutRegister }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the weekly review nudge', weeklyReviewNudgeTests)

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

describe(
  'task-vault activate() quick-actions command registration',
  taskVaultActivateQuickActionsTests
)

describe('task-vault activate() exports (ADR 094)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns an API whose open() takes the operator to the destination it was given', async () => {
    const { api } = makeApi()
    const { activate } = await import('../src/index.ts')
    const { openInVault } = await import('../src/navigation.js')
    const vault = await activate(api)
    vault.open({ taskId: 'task-1', view: 'daily' })

    expect(openInVault).toHaveBeenCalledWith(api, { taskId: 'task-1', view: 'daily' })
  })

  it('returns an API whose openCapture() opens the capture overlay, as the command does', async () => {
    const { api } = makeApi()
    const { activate } = await import('../src/index.ts')
    const vault = await activate(api)
    vault.openCapture()

    expect(api.window.raise).toHaveBeenCalled()
    expect(api.window.broadcast).toHaveBeenCalledWith('task-vault:push:open-capture', undefined)
    expect(api.window.broadcast).toHaveBeenCalledWith(
      'extension:activate-global-tab',
      'terminator.task-vault'
    )
    expect(api.window.focusSelf).toHaveBeenCalledWith('main')
  })
})

const REVIEW_DAY = 'terminator.task-vault.weeklyReviewDay'
// 2026-10-14 is a Wednesday, day 3.
const WEDNESDAY_MORNING = new Date(2026, 9, 14, 9, 0)
const DAY_MS = 24 * 60 * 60 * 1000

/** How many "Weekly review is ready" notifications the API was asked for. */
function reviewNudges(api: ExtensionAPI): number {
  return vi
    .mocked(api.notifications.createNotification)
    .mock.calls.filter(([notification]) => notification.title === 'Weekly review is ready').length
}

function weeklyReviewNudgeTests() {
  beforeEach(() => vi.setSystemTime(WEDNESDAY_MORNING))

  it('comes on the day "Weekly Review Day" names, and not on another', async () => {
    const { activate, deactivate } = await import('../src/index.ts')
    const onWednesday = makeApi({ [REVIEW_DAY]: '3' }).api
    await activate(onWednesday)
    await deactivate()
    const onMonday = makeApi({ [REVIEW_DAY]: '1' }).api
    await activate(onMonday)
    await deactivate()

    expect(reviewNudges(onWednesday)).toBe(1)
    expect(reviewNudges(onMonday)).toBe(0)
  })

  it('follows a day changed after activation, from the next daily check', async () => {
    const settings: Record<string, unknown> = { [REVIEW_DAY]: '1' }
    const { api } = makeApi(settings)
    const { activate, deactivate } = await import('../src/index.ts')
    await activate(api)
    settings[REVIEW_DAY] = '4'
    vi.advanceTimersByTime(DAY_MS)
    await deactivate()

    expect(reviewNudges(api)).toBe(1)
  })

  describe('the daily check', weeklyReviewNudgeDailyCheckTests)
}

function weeklyReviewNudgeDailyCheckTests() {
  it('comes on a review day that has 23 hours, when the app was started late the evening before', async () => {
    vi.stubEnv('TZ', 'America/New_York')
    // Saturday 23:30; the clocks go forward on Sunday, so 24 hours later is Monday 00:30.
    vi.setSystemTime(new Date('2026-03-07T23:30:00'))
    const { api } = makeApi({ [REVIEW_DAY]: '0' })
    const { activate, deactivate } = await import('../src/index.ts')
    await activate(api)
    vi.advanceTimersByTime(DAY_MS)
    await deactivate()
    vi.unstubAllEnvs()

    expect(reviewNudges(api)).toBe(1)
  })

  it('checks once a day for as long as the app runs', async () => {
    const { api } = makeApi({ [REVIEW_DAY]: '3' })
    const { activate, deactivate } = await import('../src/index.ts')
    await activate(api)
    vi.advanceTimersByTime(14 * DAY_MS)
    await deactivate()
    vi.advanceTimersByTime(14 * DAY_MS)

    expect(reviewNudges(api)).toBe(3)
  })
}

function taskVaultActivateQuickActionsTests() {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('registering', taskVaultActivateQuickActionsRegisteringTests)
  describe('running', taskVaultActivateQuickActionsRunningTests)
  describe('without a shortcut', taskVaultActivateQuickActionsWithoutShortcutTests)
  describe('disposing', taskVaultActivateQuickActionsDisposingTests)
}

function taskVaultActivateQuickActionsRegisteringTests() {
  it('registers the manifest command id with its label and mnemonic', async () => {
    const { api } = makeApi()
    const { activate } = await import('../src/index.ts')

    await activate(api)

    const commandsRegister = vi.mocked(api.commands.register)
    expect(commandsRegister).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'task-vault:capture-to-inbox',
        label: 'Capture to inbox',
        mnemonic: 'c',
      }),
      expect.any(Function)
    )
  })
}

function taskVaultActivateQuickActionsRunningTests() {
  it('running the registered command opens the capture overlay, same as the hotkey', async () => {
    const { api } = makeApi()
    const { activate } = await import('../src/index.ts')

    await activate(api)

    const commandsRegister = vi.mocked(api.commands.register)
    const handler = commandsRegister.mock.calls.find(
      (c) => (c[0] as { id: string }).id === 'task-vault:capture-to-inbox'
    )?.[1] as (ctx: unknown) => void
    handler({ projectId: null, sessionId: null, repoRoot: null })

    const channels = vi.mocked(api.window.broadcast).mock.calls.map((c) => c[0])
    expect(channels).toContain('extension:activate-global-tab')
    expect(api.window.focusSelf).toHaveBeenCalledWith('main')
  })
}

function taskVaultActivateQuickActionsWithoutShortcutTests() {
  it('registers the command even when the global shortcut registration throws', async () => {
    const { api, globalShortcutRegister, commandsRegister } = makeApi()
    globalShortcutRegister.mockRejectedValue(new Error('shortcut claimed by another app'))
    const { activate } = await import('../src/index.ts')

    await activate(api)

    expect(commandsRegister).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'task-vault:capture-to-inbox' }),
      expect.any(Function)
    )
    const [, handler] = commandsRegister.mock.calls.find(
      ([command]) => command.id === 'task-vault:capture-to-inbox'
    )!
    handler({ projectId: null, sessionId: null, repoRoot: null })

    const channels = vi.mocked(api.window.broadcast).mock.calls.map((c) => c[0])
    expect(channels).toContain('extension:activate-global-tab')
  })
}

function taskVaultActivateQuickActionsDisposingTests() {
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
}
