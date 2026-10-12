import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'

const mockSend = vi.fn()
const mockWindow = {
  webContents: { send: mockSend, isDestroyed: vi.fn(() => false) },
  isDestroyed: vi.fn(() => false),
}

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => [mockWindow]),
  },
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
  Menu: {
    getApplicationMenu: vi.fn(() => null),
    buildFromTemplate: vi.fn((t) => t),
    setApplicationMenu: vi.fn(),
  },
  MenuItem: vi.fn().mockImplementation((opts) => opts),
  Notification: Object.assign(
    vi.fn().mockImplementation(() => ({ show: vi.fn() })),
    {
      isSupported: vi.fn(() => false),
    }
  ),
  app: { dock: null },
}))

vi.mock('../../../../src/main/shell/shell-executor', () => ({
  execShell: vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'ok', stderr: '', timedOut: false }),
  assertCommandAllowed: vi.fn(),
  assertCwdInScope: vi.fn(),
  CommandNotAllowedError: class CommandNotAllowedError extends Error {
    readonly code = 'COMMAND_NOT_ALLOWED'
    constructor(cmd: string) {
      super(`COMMAND_NOT_ALLOWED: "${cmd}" is not allowed`)
    }
  },
  CwdOutOfScopeError: class CwdOutOfScopeError extends Error {
    readonly code = 'CWD_OUT_OF_SCOPE'
  },
}))

const mockExtensionStore: Record<string, unknown> = {}
vi.mock('../../../../src/main/storage/extension-settings-store', () => ({
  getExtensionSetting: (key: string) => mockExtensionStore[key],
  setExtensionSetting: (key: string, value: unknown) => {
    mockExtensionStore[key] = value
  },
  getAllExtensionSettings: () => ({ ...mockExtensionStore }),
}))

const mockGetGlobalSettings = vi.fn()
const mockGetWorkspaceSettings = vi.fn()
vi.mock('../../../../src/main/storage/settings-store', () => ({
  getGlobalSettings: () => mockGetGlobalSettings(),
  getWorkspaceSettings: (id: string) => mockGetWorkspaceSettings(id),
}))

const mockListWorkspaces = vi.fn(
  () => [] as Array<{ id: string; name: string; folderPath: string }>
)
vi.mock('../../../../src/main/storage/workspace-store', () => ({
  listWorkspaces: () => mockListWorkspaces(),
  listProjects: () => [],
  deleteProject: vi.fn(),
}))

import {
  createExtensionAPI,
  globalRegistry,
  listExtensionCommands,
  executeExtensionCommand,
  isExtensionCommandRegistered,
} from '../../../../src/main/extensions/api'

beforeEach(() => {
  vi.clearAllMocks()
  mockGetGlobalSettings.mockReturnValue({
    notifications: { defaultTargets: ['system', 'center', 'toast'], extensionOverrides: {} },
  })
  globalRegistry.commandContributions.clear()
  globalRegistry.commandHandlers.clear()
})

describe('api.commands.register', () => {
  it('has no keyboard.register member — the interface was deleted', () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    expect('keyboard' in api).toBe(false)
  })

  it('registers a command with mnemonic and requires', () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    api.commands.register({ id: 'push', label: 'Push', mnemonic: 'p', requires: 'repo' }, vi.fn())
    const cmd = listExtensionCommands().find((c) => c.id === 'push')
    expect(cmd).toMatchObject({
      extensionId: 'test.ext',
      id: 'push',
      label: 'Push',
      mnemonic: 'p',
      requires: 'repo',
    })
  })

  it('passes CommandContext through to the handler', async () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    const handler = vi.fn()
    api.commands.register({ id: 'push', label: 'Push' }, handler)
    const key = listExtensionCommands().find((c) => c.id === 'push')!.key

    const ctx = { projectId: 'p1', sessionId: 's1', repoRoot: '/repo' }
    await executeExtensionCommand(key, ctx)

    expect(handler).toHaveBeenCalledWith(ctx)
  })

  it('zero-arg handlers still work when a ctx is passed', async () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    const handler = vi.fn(() => {})
    api.commands.register({ id: 'noop', label: 'Noop' }, handler)
    const key = listExtensionCommands().find((c) => c.id === 'noop')!.key

    await executeExtensionCommand(key, { projectId: null, sessionId: null, repoRoot: null })

    expect(handler).toHaveBeenCalledTimes(1)
  })
})

describe('executeExtensionCommand', () => {
  it('is a no-op for an unknown key', async () => {
    await expect(
      executeExtensionCommand('unknown-key', { projectId: null, sessionId: null, repoRoot: null })
    ).resolves.toEqual({ ok: false, reason: 'not-registered' })
  })

  it('logs, and does not throw, when the handler rejects', async () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    api.commands.register(
      { id: 'boom', label: 'Boom' },
      vi.fn().mockRejectedValue(new Error('kaboom'))
    )
    const key = listExtensionCommands().find((c) => c.id === 'boom')!.key

    await expect(
      executeExtensionCommand(key, { projectId: null, sessionId: null, repoRoot: null })
    ).resolves.toMatchObject({ ok: false, reason: expect.stringContaining('kaboom') })
  })

  it('logs, and does not throw, when the handler throws synchronously', async () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    api.commands.register(
      { id: 'boom', label: 'Boom' },
      vi.fn(() => {
        throw new Error('kaboom')
      })
    )
    const key = listExtensionCommands().find((c) => c.id === 'boom')!.key

    await expect(
      executeExtensionCommand(key, { projectId: null, sessionId: null, repoRoot: null })
    ).resolves.toMatchObject({ ok: false, reason: expect.stringContaining('kaboom') })
  })
})

describe('executeExtensionCommand with args', () => {
  const noCtx = { projectId: null, sessionId: null, repoRoot: null }
  const schema = z.object({ repoRoot: z.string(), number: z.number() })

  function register(handler = vi.fn()) {
    const api = createExtensionAPI('test.ext', '0.1.0')
    api.commands.register({ id: 'review', label: 'Review', args: schema }, handler)
    return { handler, key: 'test.ext.command.review' }
  }

  it('hands the validated args to the handler', async () => {
    const { handler, key } = register()

    const result = await executeExtensionCommand(key, noCtx, { repoRoot: '/r', number: 7 })

    expect(result).toEqual({ ok: true })
    expect(handler).toHaveBeenCalledWith(noCtx, { repoRoot: '/r', number: 7 })
  })

  it('rejects invalid args with a reason and never runs the handler', async () => {
    const { handler, key } = register()

    const result = await executeExtensionCommand(key, noCtx, { repoRoot: '/r', number: 'seven' })

    expect(result).toMatchObject({ ok: false, reason: expect.stringMatching(/^invalid-args: /) })
    expect(handler).not.toHaveBeenCalled()
  })

  it('rejects missing args when a schema is declared', async () => {
    const { handler, key } = register()

    const result = await executeExtensionCommand(key, noCtx)

    expect(result).toMatchObject({ ok: false })
    expect(handler).not.toHaveBeenCalled()
  })

  it('a command without a schema receives no args', async () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    const handler = vi.fn()
    api.commands.register({ id: 'plain', label: 'Plain' }, handler)

    await executeExtensionCommand('test.ext.command.plain', noCtx, { sneaky: true })

    expect(handler).toHaveBeenCalledWith(noCtx)
  })

  it('reports not-registered for an unknown command and after dispose', async () => {
    const { key } = register()
    expect(isExtensionCommandRegistered(key)).toBe(true)
    await expect(executeExtensionCommand('nobody.command.x', noCtx, {})).resolves.toEqual({
      ok: false,
      reason: 'not-registered',
    })

    const api = createExtensionAPI('test.ext', '0.1.0')
    api.commands.register({ id: 'gone', label: 'Gone' }, vi.fn()).dispose()
    expect(isExtensionCommandRegistered('test.ext.command.gone')).toBe(false)
  })

  it('keeps a command that takes args out of the quick-actions list', () => {
    register()
    expect(listExtensionCommands().find((c) => c.id === 'review')).toBeUndefined()
  })
})

describe('api.window.showSelf', () => {
  it('broadcasts extension:show-surface with the extension id and default view', () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    api.window.showSelf()

    expect(mockSend).toHaveBeenCalledWith('extension:show-surface', {
      extensionId: 'test.ext',
      view: 'main',
    })
  })

  it('broadcasts the given view', () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    api.window.showSelf('sidebar')

    expect(mockSend).toHaveBeenCalledWith('extension:show-surface', {
      extensionId: 'test.ext',
      view: 'sidebar',
    })
  })
})

// Settings → Extensions reads the pages once when it opens. A backend that
// registers its page after that (it activates late, or is reloaded) must be
// announced, or its ⚙ never appears until the panel is reopened.
describe('api.settings.register', () => {
  it('announces the change when a page is registered and when it is removed', () => {
    const broadcastToWindows = vi.fn()
    const api = createExtensionAPI('test.ext', '0.1.0', { broadcastToWindows })
    const page = api.settings.register({ label: 'Test', properties: {} })
    expect(broadcastToWindows).toHaveBeenCalledWith('extension:list-changed', null)
    broadcastToWindows.mockClear()
    page.dispose()
    expect(broadcastToWindows).toHaveBeenCalledWith('extension:list-changed', null)
  })
})
