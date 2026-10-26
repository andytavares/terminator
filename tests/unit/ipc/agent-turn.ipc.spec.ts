import { describe, it, expect, vi } from 'vitest'

type Handler = (event: unknown, payload?: unknown) => unknown
const handlers = vi.hoisted(() => new Map<string, Handler>())
const sent = vi.hoisted(() => [] as Array<[string, unknown]>)
const watcher = vi.hoisted(() => ({
  turns: [{ sessionId: 's1', inTurn: true }],
  listener: null as null | ((sessionId: string, inTurn: boolean) => void),
}))

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
}))
vi.mock('../../../src/main/logger', () => ({ logger: { error: vi.fn() } }))
vi.mock('../../../src/main/safe-send', () => ({
  sendToWindow: (_win: unknown, channel: string, data: unknown) => sent.push([channel, data]),
}))
vi.mock('../../../src/main/agents/agent-turns', () => ({
  currentTurns: () => watcher.turns,
  onTurnChange: (listener: (sessionId: string, inTurn: boolean) => void) => {
    watcher.listener = listener
  },
}))

describe('agent turn channels', () => {
  it('agent-turn:list answers the turns reported so far, and each change is pushed to the window', async () => {
    const { registerAgentTurnHandlers } = await import('../../../src/main/ipc/agent-turn.ipc')
    registerAgentTurnHandlers(() => ({}) as never)
    expect(await handlers.get('agent-turn:list')!({})).toEqual({ data: watcher.turns })
    watcher.listener!('s1', false)
    expect(sent).toEqual([['agent-turn:changed', { sessionId: 's1', inTurn: false }]])
  })
})
