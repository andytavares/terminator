import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', getVersion: () => '0.1.0' },
  globalShortcut: { register: vi.fn(), unregister: vi.fn(), isRegistered: vi.fn(() => false) },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  Menu: {
    getApplicationMenu: vi.fn(() => null),
    buildFromTemplate: vi.fn((t) => t),
    setApplicationMenu: vi.fn(),
  },
  MenuItem: vi.fn().mockImplementation((opts) => opts),
}))
vi.mock('../../../../src/main/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  makeLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

const usageStore = vi.hoisted(() => ({
  declare: vi.fn(() => Promise.resolve()),
  recordUse: vi.fn(() => Promise.resolve()),
}))
vi.mock('../../../../src/main/usage/usage-store', () => ({ getUsageStore: () => usageStore }))

import {
  createExtensionAPI,
  executeExtensionCommand,
  globalRegistry,
  listNativeViewMenuItems,
} from '../../../../src/main/extensions/api'

const noContext = { projectId: null, sessionId: null, repoRoot: null }

beforeEach(() => {
  vi.clearAllMocks()
  globalRegistry.commandContributions.clear()
  globalRegistry.commandHandlers.clear()
  globalRegistry.nativeMenuItems.clear()
})

describe('api.usage.record', () => {
  it('records the id under the extension id, via app', () => {
    createExtensionAPI('terminator.notepad').usage.record('export')
    expect(usageStore.recordUse).toHaveBeenCalledWith({
      feature: 'terminator.notepad.export',
      via: 'app',
      failed: undefined,
    })
  })

  it('passes a failed outcome on', () => {
    createExtensionAPI('terminator.notepad').usage.record('export', { failed: true })
    expect(usageStore.recordUse).toHaveBeenCalledWith(
      expect.objectContaining({ feature: 'terminator.notepad.export', failed: true })
    )
  })
})

describe('a registered command', () => {
  it('is declared as a command of the extension', () => {
    createExtensionAPI('test.ext').commands.register({ id: 'push', label: 'Push' }, vi.fn())
    expect(usageStore.declare).toHaveBeenCalledWith([
      { id: 'test.ext.command.push', label: 'Push', kind: 'command', source: 'test.ext' },
    ])
  })

  it('is not declared itself when it counts under a manifest usage id', () => {
    createExtensionAPI('test.ext').commands.register(
      { id: 'go', label: 'Go', usage: 'go-to-run' },
      vi.fn()
    )
    expect(usageStore.declare).not.toHaveBeenCalled()
  })
})

describe('running a registered command', () => {
  it('records its run with the via of the caller', async () => {
    createExtensionAPI('test.ext').commands.register({ id: 'push', label: 'Push' }, vi.fn())
    await executeExtensionCommand('test.ext.command.push', noContext, { via: 'palette' })
    expect(usageStore.recordUse).toHaveBeenCalledWith({
      feature: 'test.ext.command.push',
      via: 'palette',
      failed: false,
    })
  })

  it('records a failure when the handler throws', async () => {
    const handler = vi.fn(() => {
      throw new Error('boom')
    })
    createExtensionAPI('test.ext').commands.register({ id: 'push', label: 'Push' }, handler)
    await executeExtensionCommand('test.ext.command.push', noContext, { via: 'app' })
    expect(usageStore.recordUse).toHaveBeenCalledWith(
      expect.objectContaining({ feature: 'test.ext.command.push', failed: true })
    )
  })
})

describe('running a command with a usage id', () => {
  it('records under the usage id of its contribution', async () => {
    createExtensionAPI('test.ext').commands.register(
      { id: 'go', label: 'Go', usage: 'go-to-run' },
      vi.fn()
    )
    await executeExtensionCommand('test.ext.command.go', noContext, { via: 'app' })
    expect(usageStore.recordUse).toHaveBeenCalledWith(
      expect.objectContaining({ feature: 'test.ext.go-to-run' })
    )
  })

  it('records nothing for a command that is not registered', async () => {
    await executeExtensionCommand('test.ext.command.none', noContext, { via: 'app' })
    expect(usageStore.recordUse).not.toHaveBeenCalled()
  })
})

describe('a native menu item', () => {
  it('is declared as an action, and a click records via menu', () => {
    const onClick = vi.fn()
    createExtensionAPI('test.ext').nativeMenu.addViewMenuItem({
      id: 'open',
      label: 'Open it',
      onClick,
    })
    expect(usageStore.declare).toHaveBeenCalledWith([
      { id: 'test.ext.menu.open', label: 'Open it', kind: 'action', source: 'test.ext' },
    ])
    listNativeViewMenuItems()[0].onClick()
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(usageStore.recordUse).toHaveBeenCalledWith({
      feature: 'test.ext.menu.open',
      via: 'menu',
    })
  })
})
