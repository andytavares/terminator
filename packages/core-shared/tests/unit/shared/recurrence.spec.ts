process.env.TZ = 'America/New_York'
import { describe, it, expect } from 'vitest'
import { describeRepeat, latestRun, nextRuns, type RepeatRule } from '../../../src/recurrence'

const rule = (over: Partial<RepeatRule>): RepeatRule => ({
  every: 1,
  unit: 'day',
  days: [],
  between: null,
  overlap: 'skip',
  ...over,
})
const plan = (repeat: RepeatRule, time: string, anchor: Date) => ({ rule: repeat, time, anchor })
const local = (day: string, time = '00:00'): Date => new Date(`${day}T${time}`)
const hhmm = (d: Date): string => d.toTimeString().slice(0, 5)
const stamp = (d: Date): string => `${d.getMonth() + 1}/${d.getDate()} ${hhmm(d)}`

describe('the test clock', () => {
  it('runs in New York time', () => {
    expect(local('2026-07-01', '12:00').toISOString()).toBe('2026-07-01T16:00:00.000Z')
  })
})

describe('minute and hour repeats', () => {
  const workHours = rule({
    every: 30,
    unit: 'minute',
    days: [1, 2, 3, 4, 5],
    between: { from: '09:00', to: '18:00' },
  })

  it('runs 09:00 to 18:00 inclusive on weekdays and skips the weekend', () => {
    const friday = local('2026-11-06', '17:00') // Friday
    const runs = nextRuns(plan(workHours, '09:00', local('2026-11-01', '00:00')), friday, 4)
    expect(runs.map(stamp)).toEqual(['11/6 17:30', '11/6 18:00', '11/9 09:00', '11/9 09:30'])
  })

  it('restarts at the time each day, 90 minutes apart, without a between window', () => {
    const everyNinety = rule({ every: 90, unit: 'minute' })
    const runs = nextRuns(
      plan(everyNinety, '22:00', local('2026-11-02', '00:00')),
      local('2026-11-02', '21:00'),
      4
    )
    expect(runs.map(stamp)).toEqual(['11/2 22:00', '11/2 23:30', '11/3 22:00', '11/3 23:30'])
  })
})

describe('minute and hour repeats over a clock change', () => {
  it('keeps hourly runs on the hour across the spring-forward day', () => {
    const hourly = rule({ every: 1, unit: 'hour' })
    const runs = nextRuns(
      plan(hourly, '00:00', local('2026-03-08', '00:00')),
      local('2026-03-08', '00:30'),
      24
    )
    expect(runs.every((r) => r.getMinutes() === 0)).toBe(true)
    expect(new Set(runs.map((r) => r.getTime())).size).toBe(runs.length)
  })

  it('keeps :30 runs on the :30 the day after fall-back', () => {
    const half = rule({ every: 30, unit: 'minute', between: { from: '09:00', to: '10:00' } })
    const runs = nextRuns(
      plan(half, '09:00', local('2026-11-01', '00:00')),
      local('2026-11-01', '12:00'),
      3
    )
    expect(runs.map(stamp)).toEqual(['11/2 09:00', '11/2 09:30', '11/2 10:00'])
  })
})

describe('day, week and month repeats', () => {
  it('runs every 3 days from the anchor', () => {
    const runs = nextRuns(
      plan(rule({ every: 3 }), '08:00', local('2026-11-01', '00:00')),
      local('2026-11-01', '09:00'),
      3
    )
    expect(runs.map(stamp)).toEqual(['11/4 08:00', '11/7 08:00', '11/10 08:00'])
  })

  it('runs every 2 weeks on Monday', () => {
    const biweekly = rule({ every: 2, unit: 'week', days: [1] })
    const runs = nextRuns(
      plan(biweekly, '09:00', local('2026-11-02', '00:00')),
      local('2026-11-02', '10:00'),
      2
    )
    expect(runs.map(stamp)).toEqual(['11/16 09:00', '11/30 09:00'])
  })

  it('runs monthly on the 31st, and on the last day of shorter months', () => {
    const monthly = rule({ unit: 'month' })
    const runs = nextRuns(
      plan(monthly, '09:00', local('2026-01-31', '00:00')),
      local('2026-01-31', '10:00'),
      3
    )
    expect(runs.map(stamp)).toEqual(['2/28 09:00', '3/31 09:00', '4/30 09:00'])
  })
})

describe('a daily repeat over a clock change', () => {
  it('keeps a daily 09:00 run at 09:00 over the spring-forward day', () => {
    const runs = nextRuns(
      plan(rule({}), '09:00', local('2026-03-07', '00:00')),
      local('2026-03-07', '10:00'),
      2
    )
    expect(runs.map(stamp)).toEqual(['3/8 09:00', '3/9 09:00'])
  })
})

describe('latestRun', () => {
  it('returns the latest run at or before the moment', () => {
    const half = rule({ every: 30, unit: 'minute', between: { from: '09:00', to: '18:00' } })
    const latest = latestRun(
      plan(half, '09:00', local('2026-11-01', '00:00')),
      local('2026-11-04', '10:45')
    )
    expect(latest && stamp(latest)).toBe('11/4 10:30')
  })

  it('counts a run exactly at the moment', () => {
    const latest = latestRun(
      plan(rule({}), '09:00', local('2026-11-01', '00:00')),
      local('2026-11-04', '09:00')
    )
    expect(latest && stamp(latest)).toBe('11/4 09:00')
  })

  it('returns null before the first run', () => {
    expect(
      latestRun(plan(rule({}), '09:00', local('2026-11-04', '00:00')), local('2026-11-04', '08:00'))
    ).toBeNull()
  })

  it('finds Friday for a weekday rule on Sunday', () => {
    const weekdays = rule({ days: [1, 2, 3, 4, 5] })
    const latest = latestRun(
      plan(weekdays, '09:00', local('2026-11-01', '00:00')),
      local('2026-11-08', '12:00')
    )
    expect(latest && stamp(latest)).toBe('11/6 09:00')
  })
})

describe('describeRepeat', () => {
  it.each([
    [rule({}), '09:00', 'every day at 09:00'],
    [rule({ days: [1, 2, 3, 4, 5] }), '09:00', 'every weekday at 09:00'],
    [rule({ every: 2, unit: 'week', days: [1] }), '09:00', 'every 2 weeks on Mon at 09:00'],
    [rule({ every: 1, unit: 'month' }), '09:00', 'every month at 09:00'],
    [rule({ every: 30, unit: 'minute' }), '09:00', 'every 30 minutes from 09:00'],
    [
      rule({ every: 1, unit: 'hour', between: { from: '09:00', to: '18:00' } }),
      '09:00',
      'every hour from 09:00 to 18:00',
    ],
  ])('%j at %s reads %s', (repeat, time, words) => {
    expect(describeRepeat(repeat, time)).toBe(words)
  })
})
