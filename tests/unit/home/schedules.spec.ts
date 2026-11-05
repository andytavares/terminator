import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import type { ExtensionDB } from '@terminator/extension-sdk'
import { wrapDb } from '../../../src/main/db/index'
import { createScheduler } from '../../../src/main/home/schedules'
import type { ScheduleInput } from '../../../src/shared/schemas/schedules.schema'
import type { HomeAsk } from '../../../src/shared/schemas/home-feed.schema'

// Tests run in UTC, so local time and the ISO strings below are the same clock.
const at = (iso: string): Date => new Date(`${iso}Z`)

let db: ExtensionDB
let clock: Date
const started = vi.fn()
let asks: HomeAsk[]

const daily: ScheduleInput = {
  repoRoot: '/repo',
  prompt: 'Triage the inbox',
  runAs: 'agent',
  kind: 'daily',
  time: '09:00',
  date: null,
  newWorktree: true,
  agentId: null,
}

function scheduler() {
  return createScheduler({
    db,
    now: () => clock,
    start: started,
    publish: (next) => void (asks = next),
  })
}

async function withSchedule(input: ScheduleInput) {
  const s = scheduler()
  await s.init()
  await s.create(input)
  return s
}

async function closedOverNine(input: ScheduleInput = daily) {
  const before = scheduler()
  await before.init()
  await before.create(input)
  clock = at('2026-11-04T13:00:00')
  const after = scheduler() // a new run of the app
  await after.init()
  await after.checkMissed()
  return after
}

beforeEach(() => {
  db = wrapDb(new DatabaseSync(':memory:'))
  clock = at('2026-11-04T08:00:00') // a Wednesday
  started.mockReset()
  asks = []
})

describe('the schedules table', () => {
  it('keeps what was created, and forgets what was deleted', async () => {
    const s = scheduler()
    await s.init()
    const created = await s.create(daily)
    expect(await s.list()).toEqual([
      { ...daily, id: created.id, lastRunAt: null, createdAt: clock.toISOString() },
    ])
    await s.remove(created.id)
    expect(await s.list()).toEqual([])
  })
})

describe('saving a schedule', () => {
  it('keeps the worktree choice and the agent', async () => {
    const s = scheduler()
    await s.init()
    await s.create({ ...daily, newWorktree: false, agentId: 'codex' })
    expect(await s.list()).toMatchObject([{ newWorktree: false, agentId: 'codex' }])
  })

  it('refuses a one-time run whose time has passed, so it cannot wait for ever', async () => {
    const s = scheduler()
    await s.init()
    await expect(
      s.create({ ...daily, kind: 'once', date: '2026-11-04', time: '07:00' })
    ).rejects.toThrow('That time has passed')
    expect(await s.list()).toEqual([])
  })
})

describe('the tick', () => {
  it('starts a daily 09:00 run once at 09:00 and not again at 09:01', async () => {
    const s = await withSchedule(daily)
    clock = at('2026-11-04T09:00:00')
    await s.tick()
    clock = at('2026-11-04T09:01:00')
    await s.tick()
    expect(started).toHaveBeenCalledTimes(1)
    expect(started).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'Triage the inbox' }))
  })

  it('does not start before the time', async () => {
    const s = await withSchedule(daily)
    clock = at('2026-11-04T08:59:00')
    await s.tick()
    expect(started).not.toHaveBeenCalled()
  })

  it('starts a daily run again the next day', async () => {
    const s = await withSchedule(daily)
    clock = at('2026-11-04T09:00:00')
    await s.tick()
    clock = at('2026-11-05T09:00:00')
    await s.tick()
    expect(started).toHaveBeenCalledTimes(2)
  })
})

describe('the tick, by day', () => {
  it('skips Saturday and Sunday for weekdays', async () => {
    clock = at('2026-11-07T08:00:00') // Saturday
    const s = await withSchedule({ ...daily, kind: 'weekdays' })
    for (const day of ['2026-11-07', '2026-11-08']) {
      clock = at(`${day}T09:00:00`)
      await s.tick()
    }
    expect(started).not.toHaveBeenCalled()
    clock = at('2026-11-09T09:00:00') // Monday
    await s.tick()
    expect(started).toHaveBeenCalledTimes(1)
  })

  it('runs a one-time schedule once, then removes it', async () => {
    const s = await withSchedule({ ...daily, kind: 'once', date: '2026-11-04' })
    clock = at('2026-11-04T09:00:00')
    await s.tick()
    clock = at('2026-11-04T09:01:00')
    await s.tick()
    expect(started).toHaveBeenCalledTimes(1)
    expect(await s.list()).toEqual([])
  })
})

describe('a run missed while the app was closed', () => {
  it('raises one ask and starts nothing', async () => {
    const s = await closedOverNine()
    await s.tick()
    expect(started).not.toHaveBeenCalled()
    expect(asks).toHaveLength(1)
    expect(asks[0].title).toBe('Scheduled run missed')
    expect(asks[0].actions.map((a) => a.label)).toEqual(['Run now', 'Skip'])
  })
})

describe('answering a missed run', () => {
  it('starts the run on Run now and clears the ask', async () => {
    const s = await closedOverNine()
    await s.act(asks[0].id, 'run')
    expect(started).toHaveBeenCalledTimes(1)
    expect(asks).toEqual([])
  })

  it('starts nothing on Skip, clears the ask, and the next day still runs', async () => {
    const s = await closedOverNine()
    await s.act(asks[0].id, 'skip')
    expect(started).not.toHaveBeenCalled()
    expect(asks).toEqual([])
    clock = at('2026-11-05T09:00:00')
    await s.tick()
    expect(started).toHaveBeenCalledTimes(1)
  })

  it('drops a skipped one-time schedule', async () => {
    const s = await closedOverNine({ ...daily, kind: 'once', date: '2026-11-04' })
    await s.act(asks[0].id, 'skip')
    expect(await s.list()).toEqual([])
  })
})
