import { describe, it, expect } from 'vitest'
import {
  groupRuns,
  nextRunOf,
  soonestRun,
  whenOf,
} from '../../../../src/renderer/components/home/scheduled-runs'
import type { Schedule } from '../../../../src/shared/schemas/schedules.schema'
import type { Workspace } from '../../../../src/shared/types/index'

const daily: Schedule = {
  id: 's1',
  repoRoot: '/work/payments-api',
  prompt: 'Triage the inbox',
  runAs: 'agent',
  kind: 'repeat',
  repeat: { every: 1, unit: 'day', days: [], between: null, overlap: 'skip' },
  branch: null,
  time: '09:00',
  date: null,
  newWorktree: true,
  agentId: null,
  lastRunAt: null,
  paused: false,
  createdAt: new Date(2026, 10, 1, 8, 0).toISOString(),
}

const once: Schedule = {
  ...daily,
  id: 's2',
  kind: 'once',
  repeat: null,
  date: '2026-12-01',
  time: '16:00',
}

const workspace = (name: string, folderPath: string): Workspace => ({
  id: name,
  name,
  folderPath,
  color: '',
  tags: [],
  createdAt: '',
  updatedAt: '',
})

describe('whenOf', () => {
  it('says a repeat the way the rule reads', () => {
    expect(whenOf(daily)).toBe('every day at 09:00')
  })

  it('says a one-time run with its day and time', () => {
    expect(whenOf(once)).toBe('once on Tue 1 Dec at 16:00')
  })
})

describe('nextRunOf', () => {
  const now = new Date(2026, 10, 6, 10, 0)

  it('gives the next repeat after now, counted from when it was created', () => {
    expect(nextRunOf(daily, now)).toEqual(new Date(2026, 10, 7, 9, 0))
  })

  it('gives a one-time run its own date and time', () => {
    expect(nextRunOf(once, now)).toEqual(new Date(2026, 11, 1, 16, 0))
  })

  it('gives a one-time run whose time has passed no next run', () => {
    expect(nextRunOf({ ...once, date: '2026-11-01' }, now)).toBeNull()
  })

  it('gives a paused run no next run', () => {
    expect(nextRunOf({ ...daily, paused: true }, now)).toBeNull()
    expect(nextRunOf({ ...once, paused: true }, now)).toBeNull()
  })
})

describe('soonestRun', () => {
  const now = new Date(2026, 10, 6, 10, 0)

  it('picks the run that comes next, leaving paused runs out', () => {
    const soon = { ...once, id: 's3', date: '2026-11-06', time: '12:00', paused: true }
    expect(soonestRun([once, soon, daily], now)).toEqual({
      schedule: daily,
      at: new Date(2026, 10, 7, 9, 0),
    })
  })

  it('is null when nothing will run', () => {
    expect(soonestRun([{ ...daily, paused: true }], now)).toBeNull()
  })
})

describe('groupRuns', () => {
  it('puts Global first, then each workspace by name', () => {
    const global = { ...daily, id: 'g', repoRoot: null }
    const web = { ...daily, id: 'w', repoRoot: '/work/web-console' }
    const groups = groupRuns(
      [daily, web, global, once],
      [workspace('payments-api', '/work/payments-api'), workspace('atlas', '/work/web-console')]
    )
    expect(groups.map((g) => [g.name, g.runs.map((r) => r.id)])).toEqual([
      ['Global', ['g']],
      ['atlas', ['w']],
      ['payments-api', ['s1', 's2']],
    ])
    expect(groups.map((g) => g.global)).toEqual([true, false, false])
  })

  it('names a folder that is no workspace by its folder name', () => {
    const groups = groupRuns([{ ...daily, repoRoot: '/work/old-repo' }], [])
    expect(groups.map((g) => g.name)).toEqual(['old-repo'])
  })
})
