import { describe, it, expect, vi, beforeEach } from 'vitest'

type Handler = (event: unknown, payload: unknown) => unknown

const handleHandlers = new Map<string, Handler>()
const onHandlers = new Map<string, Handler>()

vi.mock('../../../../src/main/ipc/channel-registrar.js', () => ({
  handleChannel: (channel: string, handler: Handler) => handleHandlers.set(channel, handler),
  onChannel: (channel: string, handler: Handler) => onHandlers.set(channel, handler),
}))

const {
  mockExecuteExtensionCommand,
  mockListExtensionCommands,
  mockListExtensionSettingsSections,
  mockListExtensionSidebarItems,
  mockDispatchSidebarItemClick,
  mockListExtensionContextMenuItems,
  mockDispatchContextMenuClick,
} = vi.hoisted(() => ({
  mockExecuteExtensionCommand: vi.fn(),
  mockListExtensionCommands: vi.fn(() => [] as unknown[]),
  mockListExtensionSettingsSections: vi.fn(() => [] as unknown[]),
  mockListExtensionSidebarItems: vi.fn(() => [] as unknown[]),
  mockDispatchSidebarItemClick: vi.fn(),
  mockListExtensionContextMenuItems: vi.fn(() => [] as unknown[]),
  mockDispatchContextMenuClick: vi.fn(),
}))

vi.mock('../../../../src/main/extensions/api.js', () => ({
  listExtensionSettingsSections: mockListExtensionSettingsSections,
  listExtensionSidebarItems: mockListExtensionSidebarItems,
  dispatchSidebarItemClick: mockDispatchSidebarItemClick,
  listExtensionContextMenuItems: mockListExtensionContextMenuItems,
  dispatchContextMenuClick: mockDispatchContextMenuClick,
  listExtensionCommands: mockListExtensionCommands,
  executeExtensionCommand: mockExecuteExtensionCommand,
}))

const { mockGetAllExtensionSettings, mockSetExtensionSetting } = vi.hoisted(() => ({
  mockGetAllExtensionSettings: vi.fn(() => ({})),
  mockSetExtensionSetting: vi.fn(),
}))
vi.mock('../../../../src/main/storage/extension-settings-store.js', () => ({
  getAllExtensionSettings: mockGetAllExtensionSettings,
  setExtensionSetting: mockSetExtensionSetting,
}))

import { registerExtensionHandlers } from '../../../../src/main/ipc/extension.ipc'
import type { ExtensionHost } from '../../../../src/main/extensions/extension-host'

function makeExtensionHost(overrides: Partial<ExtensionHost> = {}): ExtensionHost {
  return {
    listExtensions: vi.fn(() => []),
    load: vi.fn(),
    toggle: vi.fn(),
    uninstall: vi.fn(),
    reload: vi.fn(),
    ...overrides,
  } as unknown as ExtensionHost
}

let broadcast: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  handleHandlers.clear()
  onHandlers.clear()
  broadcast = vi.fn()
})

describe('extension:execute-command', () => {
  it('forwards the key and ctx to executeExtensionCommand', () => {
    registerExtensionHandlers(makeExtensionHost())
    const listener = onHandlers.get('extension:execute-command')!
    const ctx = { projectId: 'p1', sessionId: null, repoRoot: '/repo' }

    listener({}, { key: 'ext.command.push', ctx })

    expect(mockExecuteExtensionCommand).toHaveBeenCalledWith('ext.command.push', ctx)
  })
})

describe('extension:get-commands', () => {
  it('returns listExtensionCommands()', () => {
    mockListExtensionCommands.mockReturnValue([{ key: 'ext.command.push' }])
    registerExtensionHandlers(makeExtensionHost())
    const handler = handleHandlers.get('extension:get-commands')!

    expect(handler({}, undefined)).toEqual({ commands: [{ key: 'ext.command.push' }] })
  })
})

describe('extension:list', () => {
  it('returns extensionHost.listExtensions()', () => {
    const host = makeExtensionHost({ listExtensions: vi.fn(() => [{ id: 'ext' }] as never) })
    registerExtensionHandlers(host)

    expect(handleHandlers.get('extension:list')!({}, undefined)).toEqual({
      extensions: [{ id: 'ext' }],
    })
  })
})

describe('extension:install', () => {
  it('loads the extension at the given path', async () => {
    const host = makeExtensionHost({ load: vi.fn().mockResolvedValue({ ok: true }) })
    registerExtensionHandlers(host)

    await expect(
      handleHandlers.get('extension:install')!({}, { directoryPath: '/dir' })
    ).resolves.toEqual({ ok: true })
    expect(host.load).toHaveBeenCalledWith('/dir')
  })
})

describe('extension:toggle', () => {
  it('returns the toggled extension', async () => {
    const host = makeExtensionHost({ toggle: vi.fn().mockResolvedValue({ id: 'ext' }) })
    registerExtensionHandlers(host)

    await expect(
      handleHandlers.get('extension:toggle')!({}, { id: 'ext', enabled: true })
    ).resolves.toEqual({ extension: { id: 'ext' } })
  })

  it('returns NOT_FOUND when the extension does not exist', async () => {
    const host = makeExtensionHost({ toggle: vi.fn().mockResolvedValue(undefined) })
    registerExtensionHandlers(host)

    await expect(
      handleHandlers.get('extension:toggle')!({}, { id: 'missing', enabled: true })
    ).resolves.toEqual({ error: 'NOT_FOUND' })
  })
})

describe('extension:uninstall', () => {
  it('returns ok when removed', async () => {
    const host = makeExtensionHost({ uninstall: vi.fn().mockResolvedValue(true) })
    registerExtensionHandlers(host)

    await expect(handleHandlers.get('extension:uninstall')!({}, { id: 'ext' })).resolves.toEqual({
      ok: true,
    })
  })

  it('returns NOT_FOUND when not removed', async () => {
    const host = makeExtensionHost({ uninstall: vi.fn().mockResolvedValue(false) })
    registerExtensionHandlers(host)

    await expect(handleHandlers.get('extension:uninstall')!({}, { id: 'ext' })).resolves.toEqual({
      error: 'NOT_FOUND',
    })
  })
})

describe('extension:reload', () => {
  it('broadcasts extension:renderer-reload on success', async () => {
    const host = makeExtensionHost({ reload: vi.fn().mockResolvedValue({ id: 'ext' }) })
    registerExtensionHandlers(host, broadcast)

    await handleHandlers.get('extension:reload')!({}, { id: 'ext' })

    expect(broadcast).toHaveBeenCalledWith('extension:renderer-reload', { id: 'ext' })
  })

  it('does not broadcast on error', async () => {
    const host = makeExtensionHost({ reload: vi.fn().mockResolvedValue({ error: 'NOT_FOUND' }) })
    registerExtensionHandlers(host, broadcast)

    await handleHandlers.get('extension:reload')!({}, { id: 'ext' })

    expect(broadcast).not.toHaveBeenCalled()
  })
})

describe('extension settings channels', () => {
  it('extension:get-settings-schemas returns listExtensionSettingsSections()', () => {
    mockListExtensionSettingsSections.mockReturnValue([{ extensionId: 'ext' }])
    registerExtensionHandlers(makeExtensionHost())

    expect(handleHandlers.get('extension:get-settings-schemas')!({}, undefined)).toEqual({
      schemas: [{ extensionId: 'ext' }],
    })
  })

  it('extension:get-settings-values returns getAllExtensionSettings()', () => {
    mockGetAllExtensionSettings.mockReturnValue({ 'ext.setting': 1 })
    registerExtensionHandlers(makeExtensionHost())

    expect(handleHandlers.get('extension:get-settings-values')!({}, undefined)).toEqual({
      values: { 'ext.setting': 1 },
    })
  })

  it('extension:update-setting calls setExtensionSetting', () => {
    registerExtensionHandlers(makeExtensionHost())

    expect(
      handleHandlers.get('extension:update-setting')!({}, { key: 'ext.setting', value: 2 })
    ).toEqual({ ok: true })
    expect(mockSetExtensionSetting).toHaveBeenCalledWith('ext.setting', 2)
  })
})

describe('sidebar and context-menu channels', () => {
  it('extension:get-sidebar-items returns listExtensionSidebarItems()', () => {
    mockListExtensionSidebarItems.mockReturnValue([{ id: 'sb' }])
    registerExtensionHandlers(makeExtensionHost())

    expect(handleHandlers.get('extension:get-sidebar-items')!({}, undefined)).toEqual({
      items: [{ id: 'sb' }],
    })
  })

  it('extension:sidebar-item-click dispatches the click', () => {
    registerExtensionHandlers(makeExtensionHost())

    expect(handleHandlers.get('extension:sidebar-item-click')!({}, { itemId: 'sb' })).toEqual({
      ok: true,
    })
    expect(mockDispatchSidebarItemClick).toHaveBeenCalledWith('sb')
  })

  it('extension:get-context-menu-items returns listExtensionContextMenuItems(target)', () => {
    mockListExtensionContextMenuItems.mockReturnValue([{ id: 'ctx' }])
    registerExtensionHandlers(makeExtensionHost())

    expect(
      handleHandlers.get('extension:get-context-menu-items')!({}, { target: 'workspace' })
    ).toEqual({ items: [{ id: 'ctx' }] })
  })

  it('extension:context-menu-click dispatches the click', () => {
    registerExtensionHandlers(makeExtensionHost())

    onHandlers.get('extension:context-menu-click')!(
      {},
      { target: 'workspace', itemId: 'ctx', targetId: 'w1' }
    )

    expect(mockDispatchContextMenuClick).toHaveBeenCalledWith('workspace', 'ctx', 'w1')
  })
})
