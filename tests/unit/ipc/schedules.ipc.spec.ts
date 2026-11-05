import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { wrapDb } from '../../../src/main/db/index'

type Handler = (event: unknown, payload?: unknown) => unknown
const handlers = vi.hoisted(() => new Map<string, Handler>())
const runOnce = vi.hoisted(() => vi.fn())
const database = vi.hoisted(() => ({ current: null as unknown }))

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
}))
vi.mock('../../../src/main/logger', () => ({ logger: { error: vi.fn() } }))
vi.mock('../../../src/main/safe-send', () => ({ sendToWindow: vi.fn() }))
vi.mock('../../../src/main/db/index', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getAppDb: () => database.current,
}))
vi.mock('../../../src/main/agents/acp/agent-service-instance', () => ({
  agentService: () => ({ runOnce }),
}))
vi.mock('../../../src/main/shell/login-shell-path', () => ({
  loginShellPathReady: async () => {},
}))

const call = (channel: string, payload?: unknown) => handlers.get(channel)!({}, payload)
const daily = {
  repoRoot: '/repo',
  prompt: 'Triage the inbox',
  runAs: 'agent',
  kind: 'daily',
  time: '09:00',
  date: null,
  newWorktree: true,
  agentId: null,
}

beforeEach(async () => {
  vi.resetModules()
  handlers.clear()
  database.current = wrapDb(new DatabaseSync(':memory:'))
  const ipc = await import('../../../src/main/ipc/schedules.ipc')
  ipc.registerScheduleHandlers(() => null)
})

describe('schedule channels', () => {
  it('creates, lists and deletes a schedule', async () => {
    const created = (await call('schedules:create', daily)) as { data: { id: string } }
    const listed = (await call('schedules:list')) as { data: Array<{ id: string }> }
    expect(listed.data.map((s) => s.id)).toEqual([created.data.id])
    expect(await call('schedules:delete', { id: created.data.id })).toEqual({ data: true })
    expect(await call('schedules:list')).toEqual({ data: [] })
  })

  it.each([
    ['a bad time', { ...daily, time: '9am' }],
    ['a one-time schedule with no date', { ...daily, kind: 'once' }],
    ['a daily schedule with a date', { ...daily, date: '2030-01-01' }],
    ['an empty prompt', { ...daily, prompt: '  ' }],
  ])('refuses %s', async (_name, input) => {
    const reply = (await call('schedules:create', input)) as { error?: string }
    expect(reply.error).toBeDefined()
    expect(await call('schedules:list')).toEqual({ data: [] })
  })

  it('home:branch-name answers the agent text, and an error on a bad payload', async () => {
    runOnce.mockResolvedValue({ text: 'feat/x', stopReason: 'end_turn', sessionId: 's' })
    expect(await call('home:branch-name', { prompt: 'do x' })).toEqual({ text: 'feat/x' })
    expect(await call('home:branch-name', { prompt: '' })).toEqual({ error: 'INVALID' })
  })
})
