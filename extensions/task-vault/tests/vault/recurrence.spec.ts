import { describe, it, expect } from 'vitest'
import {
  localDate,
  computeNextDueDate,
  parseRecurrenceRule,
  serializeRecurrenceRule,
  InvalidRecurrenceRuleError,
} from '../../src/vault/recurrence'

describe('localDate', () => {
  it('formats a date as YYYY-MM-DD', () => {
    expect(localDate(new Date(2024, 0, 5))).toBe('2024-01-05')
  })

  it('pads single-digit month and day', () => {
    expect(localDate(new Date(2024, 2, 9))).toBe('2024-03-09')
  })
})

describe('parseRecurrenceRule', () => {
  it('parses daily', () => {
    expect(parseRecurrenceRule('daily')).toEqual({ kind: 'daily' })
  })

  it('parses biweekly', () => {
    expect(parseRecurrenceRule('biweekly')).toEqual({ kind: 'biweekly' })
  })

  it('parses monthly', () => {
    expect(parseRecurrenceRule('monthly')).toEqual({ kind: 'monthly' })
  })

  it('parses plain weekly', () => {
    expect(parseRecurrenceRule('weekly')).toEqual({ kind: 'weekly', days: [] })
  })

  it('parses weekly:1,3 with days', () => {
    expect(parseRecurrenceRule('weekly:1,3')).toEqual({ kind: 'weekly', days: [1, 3] })
  })

  it('parses weekly with a single day', () => {
    expect(parseRecurrenceRule('weekly:5')).toEqual({ kind: 'weekly', days: [5] })
  })

  it('throws InvalidRecurrenceRuleError on unknown input', () => {
    expect(() => parseRecurrenceRule('unknown')).toThrow(InvalidRecurrenceRuleError)
  })

  it('throws on empty string', () => {
    expect(() => parseRecurrenceRule('')).toThrow(InvalidRecurrenceRuleError)
  })
})

describe('serializeRecurrenceRule', () => {
  it('serialises daily', () => {
    expect(serializeRecurrenceRule({ kind: 'daily' })).toBe('daily')
  })

  it('serialises weekly:1,3 (sorts days)', () => {
    expect(serializeRecurrenceRule({ kind: 'weekly', days: [3, 1] })).toBe('weekly:1,3')
  })

  it('serialises plain weekly (no days)', () => {
    expect(serializeRecurrenceRule({ kind: 'weekly', days: [] })).toBe('weekly')
  })
})

describe('computeNextDueDate', () => {
  it('adds one day for daily', () => {
    expect(computeNextDueDate('2024-03-10', { kind: 'daily' })).toBe('2024-03-11')
  })

  it('adds 14 days for biweekly', () => {
    expect(computeNextDueDate('2024-03-10', { kind: 'biweekly' })).toBe('2024-03-24')
  })

  it('adds one month for monthly (overflow preserved)', () => {
    expect(computeNextDueDate('2024-01-31', { kind: 'monthly' })).toBe('2024-03-02')
  })

  it('adds 7 days for weekly with no days', () => {
    expect(computeNextDueDate('2024-03-10', { kind: 'weekly', days: [] })).toBe('2024-03-17')
  })

  it('advances to the next specified weekday within the same week', () => {
    // 2024-03-11 is Monday (dow=1); next specified day is Wednesday (dow=3)
    expect(computeNextDueDate('2024-03-11', { kind: 'weekly', days: [3, 5] })).toBe('2024-03-13')
  })

  it('wraps to the following week when no specified day remains this week', () => {
    // 2024-03-15 is Friday (dow=5); days=[1,3] — wraps to next Monday
    expect(computeNextDueDate('2024-03-15', { kind: 'weekly', days: [1, 3] })).toBe('2024-03-18')
  })
})
