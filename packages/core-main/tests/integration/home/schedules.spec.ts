import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import type { ExtensionDB } from '@terminator/extension-sdk'
import { wrapDb } from '../../../src/db/index'
import { createScheduler } from '../../../src/home/schedules'
import type { ScheduleInput } from '../../../../core-shared/src/schemas/schedules.schema'
import type { HomeAsk } from '../../../../core-shared/src/schemas/home-feed.schema'

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
  kind: 'repeat',
  repeat: { every: 1, unit: 'day', days: [], between: null, overlap: 'skip' },
  branch: 'scheduled/triage',
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
      { ...daily, id: created.id, lastRunAt: null, createdAt: clock.toISOString(), paused: false },
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
      s.create({
        ...daily,
        kind: 'once',
        repeat: null,
        branch: null,
        date: '2026-11-04',
        time: '07:00',
      })
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
    const s = await withSchedule({ ...daily, repeat: { ...daily.repeat!, days: [1, 2, 3, 4, 5] } })
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
    const s = await withSchedule({
      ...daily,
      kind: 'once',
      repeat: null,
      branch: null,
      date: '2026-11-04',
    })
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
    expect(await s.list()).toMatchObject([{ lastRunAt: null }])
    clock = at('2026-11-05T09:00:00')
    await s.tick()
    expect(started).toHaveBeenCalledTimes(1)
  })

  it('drops a skipped one-time schedule', async () => {
    const s = await closedOverNine({
      ...daily,
      kind: 'once',
      repeat: null,
      branch: null,
      date: '2026-11-04',
    })
    await s.act(asks[0].id, 'skip')
    expect(await s.list()).toEqual([])
  })
})

async function oldRow(kind: string) {
  await db.exec(`CREATE TABLE schedules (
    id TEXT PRIMARY KEY, repo_root TEXT NOT NULL, prompt TEXT NOT NULL, run_as TEXT NOT NULL,
    kind TEXT NOT NULL, time TEXT NOT NULL, date TEXT, last_run_at TEXT, created_at TEXT NOT NULL,
    new_worktree INTEGER NOT NULL, agent_id TEXT)`)
  await db.run(
    `INSERT INTO schedules (id, repo_root, prompt, run_as, kind, time, date, last_run_at, created_at, new_worktree, agent_id)
     VALUES ('old', '/repo', 'Triage', 'agent', ?, '09:00', NULL, NULL, ?, 1, NULL)`,
    [kind, clock.toISOString()]
  )
  const s = scheduler()
  await s.init()
  return s
}

describe('rows saved before repeat rules', () => {
  it('reads daily as a repeat every day', async () => {
    const s = await oldRow('daily')
    expect(await s.list()).toMatchObject([
      { kind: 'repeat', repeat: { every: 1, unit: 'day', days: [], overlap: 'skip' } },
    ])
  })

  it('reads weekdays as a repeat Monday to Friday', async () => {
    const s = await oldRow('weekdays')
    expect(await s.list()).toMatchObject([
      { kind: 'repeat', repeat: { unit: 'day', days: [1, 2, 3, 4, 5] } },
    ])
  })

  it('adds the new columns to a table that already exists', async () => {
    const s = await oldRow('daily')
    await s.init()
    expect((await s.list())[0].branch).toBeNull()
  })
})

const everyHalfHour: ScheduleInput = {
  ...daily,
  time: '09:00',
  repeat: {
    every: 30,
    unit: 'minute',
    days: [],
    between: { from: '09:00', to: '18:00' },
    overlap: 'skip',
  },
}

describe('a repeat on an interval', () => {
  it('comes due on each interval and not between', async () => {
    const s = await withSchedule(everyHalfHour)
    for (const time of ['09:00', '09:10', '09:30', '09:31']) {
      clock = at(`2026-11-04T${time}:00`)
      await s.tick()
    }
    expect(started).toHaveBeenCalledTimes(2)
  })
})

describe('a repeat missed while the app was closed', () => {
  it('settles a missed hour repeat without an ask', async () => {
    const s = await closedOverNine({
      ...everyHalfHour,
      repeat: { ...everyHalfHour.repeat!, every: 1, unit: 'hour' },
    })
    await s.tick()
    expect(started).not.toHaveBeenCalled()
    expect(asks).toEqual([])
  })

  it('asks once about a missed day repeat, in words', async () => {
    const s = await closedOverNine()
    await s.tick()
    expect(asks).toHaveLength(1)
    expect(asks[0].where).toBe('repo · every day at 09:00')
  })
})

const tomorrowAtNine: ScheduleInput = {
  ...daily,
  kind: 'once',
  repeat: null,
  branch: null,
  date: '2026-11-05',
}

describe('pausing a scheduled run', () => {
  it('does not start a paused repeat at its time', async () => {
    const s = await withSchedule(daily)
    const [{ id }] = await s.list()
    await s.pauseRun(id, true)
    expect(await s.list()).toMatchObject([{ paused: true }])
    clock = at('2026-11-04T09:00:00')
    await s.tick()
    expect(started).not.toHaveBeenCalled()
  })

  it('raises no missed ask for a time that passed while paused', async () => {
    const s = await withSchedule(daily)
    const [{ id }] = await s.list()
    await s.pauseRun(id, true)
    clock = at('2026-11-04T13:00:00')
    await s.pauseRun(id, false)
    await s.checkMissed()
    expect(asks).toEqual([])
    expect(await s.list()).toMatchObject([{ paused: false }])
    clock = at('2026-11-05T09:00:00')
    await s.tick()
    expect(started).toHaveBeenCalledTimes(1)
  })
})

describe('pausing and resuming a scheduled run', () => {
  it('keeps Last run at never after a pause and a resume', async () => {
    const s = await withSchedule(daily)
    const [{ id }] = await s.list()
    await s.pauseRun(id, true)
    await s.pauseRun(id, false)
    expect(await s.list()).toMatchObject([{ lastRunAt: null }])
  })

  it('drops the missed ask of a run it pauses', async () => {
    const s = await closedOverNine()
    const [{ id }] = await s.list()
    await s.pauseRun(id, true)
    expect(asks).toEqual([])
  })
})

describe('running a scheduled run now', () => {
  it('starts a repeat and keeps its next time', async () => {
    const s = await withSchedule(daily)
    const [{ id }] = await s.list()
    clock = at('2026-11-04T08:30:00')
    await s.runNow(id)
    expect(started).toHaveBeenCalledTimes(1)
    expect((await s.list())[0].lastRunAt).toBe(clock.toISOString())
    clock = at('2026-11-04T09:00:00')
    await s.tick()
    expect(started).toHaveBeenCalledTimes(2)
  })

  it('starts a one-time run and removes it', async () => {
    const s = await withSchedule(tomorrowAtNine)
    const [{ id }] = await s.list()
    await s.runNow(id)
    expect(started).toHaveBeenCalledWith(expect.objectContaining({ id }))
    expect(await s.list()).toEqual([])
  })

  it('clears the missed ask of the run it starts', async () => {
    const s = await closedOverNine()
    await s.runNow((await s.list())[0].id)
    expect(asks).toEqual([])
  })
})

describe('running a scheduled run now, then the tick', () => {
  it('does not raise the missed ask again on the next tick', async () => {
    const s = await closedOverNine()
    await s.runNow((await s.list())[0].id)
    clock = at('2026-11-04T13:01:00')
    await s.tick()
    expect(asks).toEqual([])
    expect(started).toHaveBeenCalledTimes(1)
  })

  it('does not start the same occurrence again when run just after its time', async () => {
    const s = await withSchedule(daily)
    clock = at('2026-11-04T09:00:20')
    await s.runNow((await s.list())[0].id)
    clock = at('2026-11-04T09:01:00')
    await s.tick()
    expect(started).toHaveBeenCalledTimes(1)
  })
})

describe('a scheduled run that was deleted', () => {
  it('refuses to run, pause or edit it', async () => {
    const s = await withSchedule(daily)
    await expect(s.runNow('gone')).rejects.toThrow('That scheduled run no longer exists.')
    await expect(s.pauseRun('gone', true)).rejects.toThrow('That scheduled run no longer exists.')
    await expect(s.update('gone', daily)).rejects.toThrow('That scheduled run no longer exists.')
  })
})

describe('editing a scheduled run', () => {
  it('moves the time, keeps the id, and raises no ask for the old time', async () => {
    const s = await withSchedule(daily)
    const [before] = await s.list()
    clock = at('2026-11-04T09:30:00')
    const edited = await s.update(before.id, { ...daily, time: '10:00' })
    expect(edited).toMatchObject({ id: before.id, createdAt: before.createdAt, time: '10:00' })
    await s.checkMissed()
    expect(asks).toEqual([])
    clock = at('2026-11-04T10:00:00')
    await s.tick()
    expect(started).toHaveBeenCalledTimes(1)
    expect(await s.list()).toMatchObject([{ id: before.id, time: '10:00' }])
  })
})

describe('editing a scheduled run, its marks', () => {
  it('keeps Last run at never after an edit', async () => {
    const s = await withSchedule(daily)
    const [{ id }] = await s.list()
    await s.update(id, { ...daily, time: '10:00' })
    expect(await s.list()).toMatchObject([{ lastRunAt: null }])
  })

  it('drops the missed ask of the run it edits', async () => {
    const s = await closedOverNine()
    await s.update((await s.list())[0].id, { ...daily, time: '18:00' })
    expect(asks).toEqual([])
  })

  it('refuses a one-time run whose time has passed', async () => {
    const s = await withSchedule(tomorrowAtNine)
    const [{ id }] = await s.list()
    await expect(
      s.update(id, { ...tomorrowAtNine, date: '2026-11-04', time: '07:00' })
    ).rejects.toThrow('That time has passed')
    expect(await s.list()).toMatchObject([{ date: '2026-11-05' }])
  })
})

const globalRun: ScheduleInput = { ...daily, repoRoot: null, branch: null, newWorktree: false }

describe('a global scheduled run', () => {
  it('reads back with no repo root, beside a run that has one', async () => {
    await withSchedule(globalRun)
    const s = await withSchedule(daily)
    expect((await s.list()).map((r) => r.repoRoot)).toEqual([null, '/repo'])
  })

  it('says Global in its missed ask', async () => {
    await closedOverNine(globalRun)
    expect(asks[0].where).toBe('Global · every day at 09:00')
  })
})
