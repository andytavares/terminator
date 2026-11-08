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
vi.mock('../src/ipc/admin.ipc.js', () => ({ registerAdminIpcHandlers: vi.fn(() => vi.fn()) }))
vi.mock('../src/vault/db.js', () => ({
  applyTaskVaultSchema: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../src/vault/ensure-next-occurrence.js', () => ({
  backfillRecurringTasks: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../src/notifications/task-scheduler.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/notifications/task-scheduler.js')>()),
  startTaskScheduler: vi.fn(() => ({ dispose: vi.fn(), tick: vi.fn() })),
  setSchedulerTick: vi.fn(),
}))
vi.mock('../src/navigation.js', () => ({
  openInVault: vi.fn(),
  popPendingNavigation: vi.fn(),
}))

function emptyDb() {
  return partialFake<ExtensionAPI['db']>({
    get: vi.fn(async () => undefined),
    query: vi.fn(async () => []),
  })
}

/** The API Task Vault activates with; settings not in `settings` read as '0'. */
function makeApi(settings: Record<string, unknown> = {}) {
  const commandsRegister = vi.fn<ExtensionAPI['commands']['register']>(disposableSpy)
  const globalShortcutRegister = vi.fn(async () => disposableSpy())
  const api = partialFake<ExtensionAPI>({
    db: emptyDb(),
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
    home: { publish: vi.fn(), onAction: vi.fn(disposableSpy) },
  })
  return { api, commandsRegister, globalShortcutRegister }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe(
  'task-vault activate() quick-actions command registration',
  taskVaultActivateQuickActionsTests
)

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
  it('registers the capture command exactly as the manifest declares it, in the Task Vault group', async () => {
    const manifest = JSON.parse(readFileSync(join(__dirname, '../manifest.json'), 'utf-8')) as {
      contributes: {
        quickActions: { group: { mnemonic: string; label: string } }
        commands: { id: string }[]
      }
    }
    const declared = manifest.contributes.commands.find(
      (c) => c.id === 'task-vault:capture-to-inbox'
    )
    const { api } = makeApi()
    const { activate } = await import('../src/index.ts')

    await activate(api)

    expect(manifest.contributes.quickActions.group).toEqual({ mnemonic: 'v', label: 'Task Vault' })
    expect(api.commands.register).toHaveBeenCalledWith(declared, expect.any(Function))
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
    await handler({ projectId: null, sessionId: null, repoRoot: null })

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

describe('task-vault activate() Home feed', () => {
  it('publishes 500 ms after the vault says its index changed', async () => {
    const { api } = makeApi()
    const { activate } = await import('../src/index.ts')
    const { broadcast } = await import('../src/notifications/task-scheduler.js')
    await activate(api)
    const publish = vi.mocked(api.home.publish)
    await vi.advanceTimersByTimeAsync(500)
    publish.mockClear()

    broadcast('task-vault:push:index-updated', {})
    await vi.advanceTimersByTimeAsync(499)
    expect(publish).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(publish).toHaveBeenCalledTimes(1)
  })

  it('registers the open command', async () => {
    const { api, commandsRegister } = makeApi()
    const { activate } = await import('../src/index.ts')
    await activate(api)

    expect(commandsRegister).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'task-vault:open' }),
      expect.any(Function)
    )
  })
})

describe('task-vault activate() — the View menu', () => {
  it('adds "Toggle Vault Calendar", ticked by its panel, which asks the window to toggle that panel', async () => {
    const { api } = makeApi()
    const { activate } = await import('../src/index.ts')
    await activate(api)

    const [item] = vi
      .mocked(api.nativeMenu.addViewMenuItem)
      .mock.calls.map(([options]) => options)
      .filter((options) => options.label === 'Toggle Vault Calendar')
    expect(item).toMatchObject({ type: 'checkbox', panelId: 'terminator.task-vault' })
    item.onClick()

    expect(api.window.broadcast).toHaveBeenCalledWith(
      'extension:toggle-panel',
      'terminator.task-vault'
    )
  })
})
