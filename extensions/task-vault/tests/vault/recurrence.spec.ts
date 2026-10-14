import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  computeNextDueDate,
  parseRecurrenceRule,
  InvalidRecurrenceRuleError,
} from '../../src/vault/recurrence'

describe('parseRecurrenceRule', parseRecurrenceRuleTests)

describe('computeNextDueDate', () => {
  describe('intervals', computeNextDueDateIntervalTests)
  describe('weekdays', computeNextDueDateWeekdayTests)
})

function computeNextDueDateIntervalTests() {
  afterEach(() => vi.unstubAllEnvs())

  it('adds one day for daily', () => {
    expect(computeNextDueDate('2024-03-10', { kind: 'daily' })).toBe('2024-03-11')
  })

  it('adds 14 days for biweekly', () => {
    expect(computeNextDueDate('2024-03-10', { kind: 'biweekly' })).toBe('2024-03-24')
  })

  it('adds one month for monthly', () => {
    expect(computeNextDueDate('2024-03-10', { kind: 'monthly' })).toBe('2024-04-10')
    expect(computeNextDueDate('2025-12-15', { kind: 'monthly' })).toBe('2026-01-15')
  })

  it('falls on the last day of a month too short for the day, and skips no month', () => {
    expect(computeNextDueDate('2026-01-31', { kind: 'monthly' })).toBe('2026-02-28')
    expect(computeNextDueDate('2024-01-31', { kind: 'monthly' })).toBe('2024-02-29')
    expect(computeNextDueDate('2026-03-31', { kind: 'monthly' })).toBe('2026-04-30')
  })

  it('has no next date after a due date that is not a calendar date', () => {
    expect(computeNextDueDate('friday', { kind: 'daily' })).toBeNull()
    expect(computeNextDueDate('2026-02-31', { kind: 'monthly' })).toBeNull()
  })

  it('counts days, not hours, across a clock change', () => {
    vi.stubEnv('TZ', 'America/New_York')
    expect(computeNextDueDate('2026-03-07', { kind: 'daily' })).toBe('2026-03-08')
    expect(computeNextDueDate('2026-03-08', { kind: 'daily' })).toBe('2026-03-09')
    expect(computeNextDueDate('2026-10-31', { kind: 'weekly', days: [0] })).toBe('2026-11-01')
  })
}

function computeNextDueDateWeekdayTests() {
  it('goes from Sunday to the next named day, and from Saturday round to Sunday', () => {
    // 2024-03-10 is a Sunday, 2024-03-16 a Saturday.
    expect(computeNextDueDate('2024-03-10', { kind: 'weekly', days: [0, 6] })).toBe('2024-03-16')
    expect(computeNextDueDate('2024-03-16', { kind: 'weekly', days: [0, 6] })).toBe('2024-03-17')
    expect(computeNextDueDate('2024-03-10', { kind: 'weekly', days: [0] })).toBe('2024-03-17')
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
}

function parseRecurrenceRuleTests() {
  describe('intervals', parseRecurrenceRuleIntervalsTests)
  describe('weekdays', parseRecurrenceRuleWeekdaysTests)
  describe('invalid rules', parseRecurrenceRuleInvalidRulesTests)
}

function parseRecurrenceRuleIntervalsTests() {
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
}

function parseRecurrenceRuleWeekdaysTests() {
  it('parses weekly:1,3 with days', () => {
    expect(parseRecurrenceRule('weekly:1,3')).toEqual({ kind: 'weekly', days: [1, 3] })
  })

  it('parses weekly with a single day', () => {
    expect(parseRecurrenceRule('weekly:5')).toEqual({ kind: 'weekly', days: [5] })
  })
}

function parseRecurrenceRuleInvalidRulesTests() {
  it('throws InvalidRecurrenceRuleError on unknown input', () => {
    expect(() => parseRecurrenceRule('unknown')).toThrow(InvalidRecurrenceRuleError)
  })

  it('throws on empty string', () => {
    expect(() => parseRecurrenceRule('')).toThrow(InvalidRecurrenceRuleError)
  })
}
