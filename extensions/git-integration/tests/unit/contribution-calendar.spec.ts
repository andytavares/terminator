import { describe, it, expect } from 'vitest'
import {
  buildContributionCalendar,
  calendarStart,
  countBetween,
  previousRange,
  type CalendarDay,
  type Contribution,
} from '../../src/review/contribution-calendar'

const ZONE = 'America/New_York'
// A Friday, so a streak into this week can run over a weekend.
const TODAY = '2026-10-16'

function openedPr(at: string, repo = 'klaviyo/terminator'): Contribution {
  return { kind: 'opened', at, repo }
}

function merged(at: string): Contribution {
  return { kind: 'merged', at, repo: 'klaviyo/terminator' }
}

function reviewed(at: string): Contribution {
  return { kind: 'reviewed', at, repo: 'klaviyo/terminator' }
}

/** One of each kind at local noon on `date`, so a day lands wherever the zone puts noon. */
function dayOfWork(date: string): Contribution[] {
  return [openedPr(`${date}T12:00:00-04:00`), merged(`${date}T12:00:00-04:00`)]
}

function daysOf(calendar: ReturnType<typeof buildContributionCalendar>): CalendarDay[] {
  return calendar.weeks.flat()
}

function on(calendar: ReturnType<typeof buildContributionCalendar>, date: string): CalendarDay {
  const day = daysOf(calendar).find((d) => d.date === date)
  if (!day) throw new Error(`no day ${date}`)
  return day
}

describe('calendarStart', () => {
  it('is the Monday of this week, 52 weeks back', () => {
    expect(calendarStart(TODAY)).toBe('2025-10-13')
  })

  it('is 52 weeks back even from a Monday', () => {
    expect(calendarStart('2026-10-12')).toBe('2025-10-13')
  })
})

describe('buildContributionCalendar — the grid', () => {
  it('holds 53 Monday-first weeks from calendarStart, the last holding today', () => {
    const calendar = buildContributionCalendar([], TODAY, ZONE)
    expect(calendar.weeks).toHaveLength(53)
    expect(daysOf(calendar)[0].date).toBe('2025-10-13')
    expect(calendar.weeks[52].map((d) => d.date)).toEqual([
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
      '2026-10-17',
      '2026-10-18',
    ])
  })

  it('marks days after today future and counts nothing on them', () => {
    // Saturday's instant would count on Saturday if future days were counted.
    const calendar = buildContributionCalendar([openedPr('2026-10-17T12:00:00-04:00')], TODAY, ZONE)
    expect(on(calendar, '2026-10-17').future).toBe(true)
    expect(on(calendar, '2026-10-17').total).toBe(0)
    expect(on(calendar, TODAY).future).toBe(false)
    expect(calendar.total).toBe(0)
  })
})

describe('buildContributionCalendar — empty and local days', () => {
  it('gives an empty year zeros and nulls', () => {
    const calendar = buildContributionCalendar([], TODAY, ZONE)
    expect(calendar.total).toBe(0)
    expect(calendar.currentStreak).toBe(0)
    expect(calendar.longestStreak).toBe(0)
    expect(calendar.mostActiveMonth).toBeNull()
    expect(calendar.mostActiveWeekday).toBeNull()
    expect(daysOf(calendar).every((d) => d.total === 0 && d.level === 0)).toBe(true)
  })

  it('counts a contribution on its local day, not its UTC day', () => {
    // 23:30 UTC is 19:30 in New York: the contribution belongs to the 14th there.
    const calendar = buildContributionCalendar([openedPr('2026-10-14T23:30:00Z')], TODAY, ZONE)
    expect(on(calendar, '2026-10-14').opened).toBe(1)
    expect(on(calendar, '2026-10-15').opened).toBe(0)
    expect(calendar.total).toBe(1)
  })

  it('sums the kinds into the day and the year total', () => {
    const contributions = [...dayOfWork('2026-10-14'), reviewed('2026-10-15T12:00:00-04:00')]
    const calendar = buildContributionCalendar(contributions, TODAY, ZONE)
    expect(on(calendar, '2026-10-14')).toMatchObject({
      opened: 1,
      merged: 1,
      reviewed: 0,
      total: 2,
    })
    expect(calendar.total).toBe(3)
  })
})

describe('buildContributionCalendar — levels', () => {
  it('buckets a day by the quartiles of the non-zero day totals', () => {
    // Nine days with totals 1..9: q1=3, median=5, q3=7.
    const contributions = Array.from({ length: 9 }, (_, i) =>
      Array.from({ length: i + 1 }, () => openedPr(`2026-10-0${i + 1}T12:00:00-04:00`))
    ).flat()
    const calendar = buildContributionCalendar(contributions, TODAY, ZONE)
    const levels = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(
      (total, i) => [total, on(calendar, `2026-10-0${i + 1}`).level] as const
    )
    expect(levels).toEqual([
      [1, 1],
      [2, 1],
      [3, 1],
      [4, 2],
      [5, 2],
      [6, 3],
      [7, 3],
      [8, 4],
      [9, 4],
    ])
  })

  it('gives every worked day level 1 when all totals are equal', () => {
    const calendar = buildContributionCalendar(dayOfWork('2026-10-14'), TODAY, ZONE)
    expect(on(calendar, '2026-10-14').level).toBe(1)
  })
})

describe('buildContributionCalendar — streaks', () => {
  it('runs the current streak over an empty weekend', () => {
    // Wednesday, Thursday, Friday worked; today (Friday) has work.
    const contributions = [
      ...dayOfWork('2026-10-14'),
      ...dayOfWork('2026-10-15'),
      ...dayOfWork('2026-10-16'),
    ]
    const calendar = buildContributionCalendar(contributions, TODAY, ZONE)
    expect(calendar.currentStreak).toBe(3)
    expect(calendar.longestStreak).toBe(3)
  })

  it('does not end the current streak when today has nothing yet', () => {
    const contributions = [...dayOfWork('2026-10-14'), ...dayOfWork('2026-10-15')]
    const calendar = buildContributionCalendar(contributions, TODAY, ZONE)
    expect(calendar.currentStreak).toBe(2) // the skip leaves the run standing, it adds nothing
  })
})

describe('buildContributionCalendar — streak breaks', () => {
  it('breaks on an empty weekday, leaving the older run the longest', () => {
    // Worked Mon–Wed two weeks ago; gap Tuesday this week; worked Wed–Thu this week.
    const contributions = [
      ...dayOfWork('2026-10-05'),
      ...dayOfWork('2026-10-06'),
      ...dayOfWork('2026-10-07'),
      ...dayOfWork('2026-10-14'),
      ...dayOfWork('2026-10-15'),
    ]
    const calendar = buildContributionCalendar(contributions, TODAY, ZONE)
    expect(calendar.currentStreak).toBe(2) // Wed, Thu; today's skip ends nothing
    expect(calendar.longestStreak).toBe(3) // Mon–Wed two weeks ago, before the gap
  })

  it('counts a lone Monday after an empty weekend as a streak of one', () => {
    const calendar = buildContributionCalendar(dayOfWork('2026-10-12'), '2026-10-14', ZONE)
    expect(calendar.currentStreak).toBe(0) // empty Tuesday broke it
    expect(calendar.longestStreak).toBe(1)
  })
})

describe('buildContributionCalendar — most active groups', () => {
  it('names the month with the largest total', () => {
    const contributions = [
      ...dayOfWork('2026-09-30'),
      ...dayOfWork('2026-10-14'),
      ...dayOfWork('2026-10-15'),
    ]
    const calendar = buildContributionCalendar(contributions, TODAY, ZONE)
    expect(calendar.mostActiveMonth).toEqual({ month: '2026-10', total: 4 })
  })

  it('breaks a month tie towards the latest month', () => {
    const contributions = [...dayOfWork('2026-09-30'), ...dayOfWork('2026-10-14')]
    expect(buildContributionCalendar(contributions, TODAY, ZONE).mostActiveMonth?.month).toBe(
      '2026-10'
    )
  })

  it('names the weekday with the largest total, 1 = Monday', () => {
    const contributions = [
      ...dayOfWork('2026-10-14'), // Wednesday
      ...dayOfWork('2026-10-14'),
      ...dayOfWork('2026-10-15'), // Thursday
    ]
    const calendar = buildContributionCalendar(contributions, TODAY, ZONE)
    expect(calendar.mostActiveWeekday).toEqual({ weekday: 3, total: 4 })
  })

  it('breaks a weekday tie towards the lowest weekday number', () => {
    const contributions = [...dayOfWork('2026-10-13'), ...dayOfWork('2026-10-15')]
    expect(buildContributionCalendar(contributions, TODAY, ZONE).mostActiveWeekday?.weekday).toBe(2)
  })
})

describe('countBetween', () => {
  const contributions = [
    openedPr('2026-10-13T12:00:00-04:00'),
    merged('2026-10-14T12:00:00-04:00'),
    reviewed('2026-10-15T12:00:00-04:00'),
    openedPr('2026-10-16T12:00:00-04:00'),
  ]

  it('counts both bounds and everything between, in the zone', () => {
    expect(countBetween(contributions, { from: '2026-10-14', to: '2026-10-15' }, ZONE)).toEqual({
      opened: 0,
      merged: 1,
      reviewed: 1,
      total: 2,
    })
  })

  it('counts an instant near midnight on its local day', () => {
    const late = [openedPr('2026-10-15T02:30:00Z')] // 22:30 on the 14th in New York
    expect(countBetween(late, { from: '2026-10-14', to: '2026-10-14' }, ZONE).total).toBe(1)
  })
})

describe('previousRange', () => {
  it('moves a 7-day range back 7 days', () => {
    expect(previousRange({ from: '2026-10-06', to: '2026-10-12' })).toEqual({
      from: '2026-09-29',
      to: '2026-10-05',
    })
  })

  it('moves a year-long range back by its own length, across a leap day', () => {
    // 2025-10-13..2026-10-16 is 369 days (2024 is a leap year), so the previous
    // 369 days run 2024-10-09..2025-10-12.
    expect(previousRange({ from: '2025-10-13', to: '2026-10-16' })).toEqual({
      from: '2024-10-09',
      to: '2025-10-12',
    })
  })
})
