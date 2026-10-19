import { describe, it, expect, vi } from 'vitest'

type Handler = (event: unknown, payload?: unknown) => unknown
const handlers = vi.hoisted(() => new Map<string, Handler>())
const sent = vi.hoisted(() => [] as Array<[string, unknown]>)
const watcher = vi.hoisted(() => ({
  asks: { s1: { message: 'Overwrite the file?', since: '2026-10-18T10:00:00.000Z' } },
  listener: null as null | ((sessionId: string, ask: unknown) => void),
}))

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
}))
vi.mock('../../../src/main/logger', () => ({ logger: { error: vi.fn() } }))
vi.mock('../../../src/main/safe-send', () => ({
  sendToWindow: (_win: unknown, channel: string, data: unknown) => sent.push([channel, data]),
}))
vi.mock('../../../src/main/agents/ask-watcher', () => ({
  currentAsks: () => watcher.asks,
  onAskChange: (listener: (sessionId: string, ask: unknown) => void) => {
    watcher.listener = listener
  },
}))

describe('agent ask channels', () => {
  it('agent-ask:list answers the asks waiting now, and each change is pushed to the window', async () => {
    const { registerAgentAskHandlers } = await import('../../../src/main/ipc/agent-ask.ipc')
    registerAgentAskHandlers(() => ({}) as never)
    expect(await handlers.get('agent-ask:list')!({})).toEqual({ data: watcher.asks })
    watcher.listener!('s1', null)
    expect(sent).toEqual([['agent-ask:changed', { sessionId: 's1', ask: null }]])
  })
})
