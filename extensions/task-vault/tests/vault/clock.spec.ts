import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { daysAgo, today, zonedNow } from '../../src/vault/clock'

/** Sets the machine's time zone and the instant it reads as now. */
function setClock(timeZone: string, instant: string): void {
  vi.stubEnv('TZ', timeZone)
  vi.setSystemTime(new Date(instant))
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('today', () => {
  it('is the date on the wall, not the UTC date', () => {
    setClock('America/New_York', '2026-03-10T02:30:00.000Z')
    expect(today()).toBe('2026-03-09')
  })

  it('is a day ahead of UTC east of it, late in the UTC day', () => {
    setClock('Pacific/Auckland', '2026-06-30T13:00:00.000Z')
    expect(today()).toBe('2026-07-01')
  })
})

describe('daysAgo', () => {
  it('counts back across a month and a year end', () => {
    setClock('Europe/Lisbon', '2026-01-02T12:00:00.000Z')
    expect(daysAgo(3)).toBe('2025-12-30')
  })

  it('is today for zero days', () => {
    setClock('Europe/Lisbon', '2026-01-02T12:00:00.000Z')
    expect(daysAgo(0)).toBe('2026-01-02')
  })

  it('counts calendar days when a day in between had 23 hours', () => {
    // 00:30 on the Monday after New York's clocks went forward: 24 hours earlier was Saturday.
    setClock('America/New_York', '2026-03-09T04:30:00.000Z')
    expect(daysAgo(1)).toBe('2026-03-08')
  })
})

describe('zonedNow', () => {
  it('reads the wall clock of the machine time zone', () => {
    setClock('America/New_York', '2026-03-10T02:30:00.000Z')
    const now = zonedNow()
    expect([now.hour, now.minute, now.dayOfWeek]).toEqual([22, 30, 1])
  })

  it('is the instant the system clock reads', () => {
    setClock('Asia/Tokyo', '2026-03-10T02:30:00.000Z')
    expect(zonedNow().epochMilliseconds).toBe(Date.parse('2026-03-10T02:30:00.000Z'))
  })
})
