import { describe, it, expect } from 'vitest'
import { localDate, computeNextDueDate } from '../../src/vault/recurrence'

describe('localDate', () => {
  it('formats a date as YYYY-MM-DD', () => {
    expect(localDate(new Date(2024, 0, 5))).toBe('2024-01-05')
  })

  it('pads single-digit month and day', () => {
    expect(localDate(new Date(2024, 2, 9))).toBe('2024-03-09')
  })
})

describe('computeNextDueDate', () => {
  it('adds one day for daily interval', () => {
    expect(computeNextDueDate('2024-03-10', 'daily', [])).toBe('2024-03-11')
  })

  it('adds 14 days for biweekly interval', () => {
    expect(computeNextDueDate('2024-03-10', 'biweekly', [])).toBe('2024-03-24')
  })

  it('adds one month for monthly interval', () => {
    expect(computeNextDueDate('2024-01-31', 'monthly', [])).toBe('2024-03-02')
  })

  it('adds 7 days for weekly interval with no days', () => {
    expect(computeNextDueDate('2024-03-10', 'weekly', [])).toBe('2024-03-17')
  })

  it('advances to the next specified weekday within the same week', () => {
    // 2024-03-11 is a Monday (dow=1); next day with dow=3 (Wednesday)
    expect(computeNextDueDate('2024-03-11', 'weekly', [3, 5])).toBe('2024-03-13')
  })

  it('wraps to the following week when no specified day remains this week', () => {
    // 2024-03-15 is a Friday (dow=5); days=[1,3] — wraps to next Monday
    expect(computeNextDueDate('2024-03-15', 'weekly', [1, 3])).toBe('2024-03-18')
  })

  it('returns the from date unchanged for an unknown interval', () => {
    expect(computeNextDueDate('2024-03-10', 'unknown', [])).toBe('2024-03-10')
  })
})
