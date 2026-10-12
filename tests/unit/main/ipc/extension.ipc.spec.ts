import { describe, it, expect, vi, beforeEach } from 'vitest'

type Handler = (event: unknown, payload: unknown) => unknown

const handleHandlers = new Map<string, Handler>()
const onHandlers = new Map<string, Handler>()

vi.mock('../../../../src/main/ipc/channel-registrar.js', () => ({
  handleChannel: (channel: string, handler: Handler) => handleHandlers.set(channel, handler),
  onChannel: (channel: string, handler: Handler) => onHandlers.set(channel, handler),
}))

const { mockExecuteExtensionCommand } = vi.hoisted(() => ({
  mockExecuteExtensionCommand: vi.fn(),
}))

vi.mock('../../../../src/main/extensions/api.js', () => ({
  listExtensionSettingsSections: vi.fn(() => []),
  listExtensionCommands: vi.fn(() => []),
  executeExtensionCommand: mockExecuteExtensionCommand,
  isExtensionCommandRegistered: vi.fn(() => false),
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
const noViewHost = () => null

beforeEach(() => {
  vi.clearAllMocks()
  handleHandlers.clear()
  onHandlers.clear()
  broadcast = vi.fn()
})

describe('extension:execute-command', () => {
  it('forwards the key and ctx to executeExtensionCommand', async () => {
    registerExtensionHandlers(makeExtensionHost(), broadcast, noViewHost)
    const listener = onHandlers.get('extension:execute-command')!
    const ctx = { projectId: 'p1', sessionId: null, repoRoot: '/repo' }

    listener({}, { key: 'ext.command.push', ctx })

    expect(mockExecuteExtensionCommand).toHaveBeenCalledWith('ext.command.push', ctx)
  })
})

describe('extension:run-command', () => {
  it('runs the command with args and a null ctx, returning its result', async () => {
    mockExecuteExtensionCommand.mockResolvedValue({ ok: false, reason: 'not-registered' })
    registerExtensionHandlers(makeExtensionHost(), broadcast, noViewHost)
    const handler = handleHandlers.get('extension:run-command')!

    const result = await handler({}, { key: 'ext.command.open', args: { n: 1 } })

    expect(mockExecuteExtensionCommand).toHaveBeenCalledWith(
      'ext.command.open',
      { projectId: null, sessionId: null, repoRoot: null },
      { n: 1 }
    )
    expect(result).toEqual({ ok: false, reason: 'not-registered' })
  })
})
