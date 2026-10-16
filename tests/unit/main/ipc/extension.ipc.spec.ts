import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'

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
import { partialFake } from '../../../support/fakes'

function makeExtensionHost(overrides: Partial<ExtensionHost> = {}): ExtensionHost {
  return partialFake<ExtensionHost>({
    listAll: vi.fn(() => []),
    load: vi.fn(),
    setEnabled: vi.fn(),
    uninstallExtension: vi.fn(),
    reloadExtension: vi.fn(),
    ...overrides,
  })
}

let broadcast: Mock<(channel: string, data: unknown) => void>

beforeEach(() => {
  vi.clearAllMocks()
  handleHandlers.clear()
  onHandlers.clear()
  broadcast = vi.fn()
})

describe('extension:execute-command', () => {
  it('forwards the key and ctx to executeExtensionCommand', async () => {
    registerExtensionHandlers(makeExtensionHost(), broadcast)
    const listener = onHandlers.get('extension:execute-command')!
    const ctx = { projectId: 'p1', sessionId: null, repoRoot: '/repo' }

    listener({}, { key: 'ext.command.push', ctx })

    expect(mockExecuteExtensionCommand).toHaveBeenCalledWith('ext.command.push', ctx)
  })
})

describe('extension:run-command', () => {
  it('runs the command with args and a null ctx, returning its result', async () => {
    mockExecuteExtensionCommand.mockResolvedValue({ ok: false, reason: 'not-registered' })
    registerExtensionHandlers(makeExtensionHost(), broadcast)
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
