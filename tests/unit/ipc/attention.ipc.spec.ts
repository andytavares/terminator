import { describe, it, expect, vi } from 'vitest'

type Handler = (event: unknown, payload?: unknown) => unknown
const handlers = vi.hoisted(() => new Map<string, Handler>())
const stored = vi.hoisted(() => [] as unknown[])

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
}))
vi.mock('../../../src/main/logger', () => ({ logger: { error: vi.fn() } }))
vi.mock('../../../src/main/home/attention-log', () => ({
  listIntervals: () => stored,
  recordState: vi.fn(),
}))

const attentionIntervalAt = (sessionId: string, start: string, end: string | null) => ({
  sessionId,
  projectId: null,
  branch: null,
  workKey: 'TAV-20',
  state: 'working',
  start,
  end,
  next: end === null ? null : 'idle',
})

describe('attention:intervals', () => {
  it('answers the stored intervals that overlap the range, with their work key', async () => {
    const inside = attentionIntervalAt('a', '2026-10-12T09:00:00.000Z', '2026-10-12T10:00:00.000Z')
    stored.push(
      inside,
      attentionIntervalAt('b', '2026-09-01T09:00:00.000Z', '2026-09-01T10:00:00.000Z')
    )
    const { registerAttentionHandlers } = await import('../../../src/main/ipc/attention.ipc')
    registerAttentionHandlers()
    const window = {
      from: Date.parse('2026-10-10T00:00:00Z'),
      to: Date.parse('2026-10-18T00:00:00Z'),
    }
    const answer = await handlers.get('attention:intervals')!({}, { window })
    expect(answer).toEqual({ data: [inside] })
  })
})
