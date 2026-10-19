import { describe, it, expect, vi } from 'vitest'

type Handler = (event: unknown, payload?: unknown) => unknown
const handlers = vi.hoisted(() => new Map<string, Handler>())
const stored = vi.hoisted(() => [] as unknown[])

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
}))
vi.mock('../../../src/main/logger', () => ({ logger: { error: vi.fn() } }))
const recordState = vi.hoisted(() => vi.fn())
vi.mock('../../../src/main/home/attention-log', () => ({
  listIntervals: () => stored,
  recordState,
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

const report = {
  sessionId: 's1',
  projectId: 'p1',
  branch: 'main',
  workKey: 'TAV-20',
  state: 'awaiting-input',
  at: '2026-10-18T10:00:00.000Z',
}

async function registeredHandlers() {
  const { registerAttentionHandlers } = await import('../../../src/main/ipc/attention.ipc')
  registerAttentionHandlers()
  return (channel: string, payload?: unknown) => handlers.get(channel)!({}, payload)
}

describe('attention:record', () => {
  it('stores a valid state report', async () => {
    const call = await registeredHandlers()
    expect(await call('attention:record', report)).toEqual({ data: true })
    expect(recordState).toHaveBeenCalledWith(report)
  })

  it('refuses a report whose time is not a time, and stores nothing', async () => {
    recordState.mockClear()
    const call = await registeredHandlers()
    const answer = (await call('attention:record', { ...report, at: 'soon' })) as { error: string }
    expect(answer.error).toBe('VALIDATION_ERROR')
    expect(recordState).not.toHaveBeenCalled()
  })

  it('says it failed when the log cannot be written', async () => {
    recordState.mockRejectedValueOnce(new Error('disk full'))
    const call = await registeredHandlers()
    expect(await call('attention:record', report)).toEqual({
      error: 'failed',
      message: 'Error: disk full',
    })
  })
})

describe('attention:measures', () => {
  it('answers the measures over the stored intervals for the window', async () => {
    const call = await registeredHandlers()
    const window = {
      from: Date.parse('2026-10-10T00:00:00Z'),
      to: Date.parse('2026-10-18T00:00:00Z'),
    }
    const answer = (await call('attention:measures', { window })) as {
      data: { agentHours: number; waitsOnYou: { count: number } }
    }
    expect(answer.data.agentHours).toBeGreaterThan(0)
    expect(answer.data.waitsOnYou.count).toBe(0)
  })
})
