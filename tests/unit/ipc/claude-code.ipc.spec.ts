import { describe, it, expect, beforeEach, vi } from 'vitest'

type Handler = (event: unknown, payload?: unknown) => unknown
const handlers = vi.hoisted(() => new Map<string, Handler>())
const registration = vi.hoisted(() => ({
  registrationStatus: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
}))
vi.mock('../../../src/main/logger', () => ({ logger: { error: vi.fn() } }))
vi.mock('../../../src/main/mcp/registration', () => registration)

import { registerClaudeCodeHandlers } from '../../../src/main/ipc/claude-code.ipc'

const options = {
  relayPath: '/data/mcp/mcp-relay.cjs',
  socketPath: '/data/mcp.sock',
  directory: '/data/mcp',
}
const connected = { state: 'connected', name: 'terminator-dev', command: 'claude mcp add-json …' }
const call = (channel: string) => handlers.get(channel)!({}, undefined)

beforeEach(() => {
  vi.clearAllMocks()
  handlers.clear()
  registerClaudeCodeHandlers(Promise.resolve(options))
})

describe('claude-code channels', () => {
  it('claude-code:status answers the registration status for the server options', async () => {
    registration.registrationStatus.mockResolvedValue(connected)
    expect(await call('claude-code:status')).toEqual({ data: connected })
    expect(registration.registrationStatus).toHaveBeenCalledWith(options)
  })

  it('claude-code:connect registers with the server options', async () => {
    registration.connect.mockResolvedValue(undefined)
    expect(await call('claude-code:connect')).toEqual({ data: true })
    expect(registration.connect).toHaveBeenCalledWith(options)
  })

  it('claude-code:disconnect removes the registration', async () => {
    registration.disconnect.mockResolvedValue(undefined)
    expect(await call('claude-code:disconnect')).toEqual({ data: true })
    expect(registration.disconnect).toHaveBeenCalledWith(options)
  })

  it('answers a failure envelope when the action throws', async () => {
    registration.disconnect.mockRejectedValue(new Error('disk full'))
    expect(await call('claude-code:disconnect')).toEqual({ error: 'failed', message: 'disk full' })
  })
})
