import { describe, it, expect, afterEach } from 'vitest'
import { storedInstant, today, zonedNow } from '../../src/vault/clock'
import { restoreLocalClock, setLocalClock as setClock } from '../support/clock'

afterEach(restoreLocalClock)

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

describe('storedInstant', () => {
  it('writes an instant as created_at and updated_at hold it', () => {
    setClock('Asia/Tokyo', '2026-03-10T02:30:00.000Z')
    expect(storedInstant(zonedNow())).toBe(new Date().toISOString())
  })

  it('keeps three decimals when the milliseconds are not zero', () => {
    setClock('America/New_York', '2026-03-10T02:30:00.120Z')
    expect(storedInstant(zonedNow())).toBe('2026-03-10T02:30:00.120Z')
  })
})
