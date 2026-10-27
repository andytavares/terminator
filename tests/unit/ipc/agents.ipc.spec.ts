import { describe, it, expect, vi, beforeEach } from 'vitest'

type Handler = (event: unknown, payload?: unknown) => Promise<unknown>
const handlers = vi.hoisted(() => new Map<string, Handler>())
const service = vi.hoisted(() => ({
  list: vi.fn(),
  start: vi.fn(),
  prompt: vi.fn(),
  cancel: vi.fn(),
  answer: vi.fn(),
  setConfig: vi.fn(),
  close: vi.fn(),
  readHistory: vi.fn(),
  openAsks: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
}))
vi.mock('../../../src/main/logger', () => ({ logger: { error: vi.fn() } }))
vi.mock('../../../src/main/agents/acp/agent-service-instance', () => ({
  agentService: () => service,
}))

import { registerAgentsHandlers } from '../../../src/main/ipc/agents.ipc'

const invoke = (channel: string, payload?: unknown) => handlers.get(channel)!({}, payload)

beforeEach(() => {
  vi.clearAllMocks()
  handlers.clear()
  registerAgentsHandlers()
})

describe('agents channels', () => {
  it('registers every channel of the manifest', () => {
    expect([...handlers.keys()].sort()).toEqual(
      [
        'agents:answer',
        'agents:cancel',
        'agents:close',
        'agents:history',
        'agents:list',
        'agents:open-asks',
        'agents:prompt',
        'agents:set-config',
        'agents:start',
      ].sort()
    )
  })
})

describe('agents start and prompt', () => {
  it('starts an agent with the validated input', async () => {
    service.start.mockResolvedValue({ sessionId: 's1', agentId: 'claude', configOptions: [] })
    const answer = await invoke('agents:start', { cwd: '/work', mode: 'default' })
    expect(service.start).toHaveBeenCalledWith({ cwd: '/work', mode: 'default' })
    expect(answer).toEqual({ data: { sessionId: 's1', agentId: 'claude', configOptions: [] } })
  })

  it('refuses a payload that does not match, without calling the service', async () => {
    expect(await invoke('agents:start', { cwd: '' })).toMatchObject({ error: 'VALIDATION_ERROR' })
    expect(await invoke('agents:prompt', { sessionId: 's1' })).toMatchObject({
      error: 'VALIDATION_ERROR',
    })
    expect(service.start).not.toHaveBeenCalled()
    expect(service.prompt).not.toHaveBeenCalled()
  })
})

describe('agents answers and history', () => {
  it('answers an ask, with null cancelling it', async () => {
    service.answer.mockResolvedValue(true)
    expect(
      await invoke('agents:answer', { sessionId: 's1', requestId: 'r1', optionId: null })
    ).toEqual({
      data: true,
    })
    expect(service.answer).toHaveBeenCalledWith('s1', 'r1', null)
  })

  it('returns the history and the open asks', async () => {
    service.readHistory.mockReturnValue([{ sessionUpdate: 'plan' }])
    service.openAsks.mockReturnValue([])
    expect(await invoke('agents:history', { sessionId: 's1' })).toEqual({
      data: [{ sessionUpdate: 'plan' }],
    })
    expect(await invoke('agents:open-asks')).toEqual({ data: [] })
  })

  it('cancels and closes a session', async () => {
    await invoke('agents:cancel', { sessionId: 's1' })
    await invoke('agents:close', { sessionId: 's1' })
    expect(service.cancel).toHaveBeenCalledWith('s1')
    expect(service.close).toHaveBeenCalledWith('s1')
  })
})
