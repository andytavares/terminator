import { describe, it, expect } from 'vitest'
import {
  PERIOD_PRESETS,
  periodRange,
  periodLabel,
  customRange,
  type PeriodSelection,
} from '../../src/components/contributions/period-presets'

// A Friday (getDay 5), so "this week" can be told from a Sunday-first one.
const FRIDAY = new Date(2026, 9, 16)

describe('periodRange this week', () => {
  it('this week starts on Monday and ends today', () => {
    expect(periodRange('week', FRIDAY)).toEqual({ from: '2026-10-12', to: '2026-10-16' })
  })

  it('this week starts last Monday on a Sunday', () => {
    const sunday = new Date(2026, 9, 18)
    expect(periodRange('week', sunday)).toEqual({ from: '2026-10-12', to: '2026-10-18' })
  })

  it('this week starts today on a Monday', () => {
    const monday = new Date(2026, 9, 12)
    expect(periodRange('week', monday)).toEqual({ from: '2026-10-12', to: '2026-10-12' })
  })
})

describe('periodRange month, year and last 30 days', () => {
  it('this month starts on the first', () => {
    expect(periodRange('month', FRIDAY)).toEqual({ from: '2026-10-01', to: '2026-10-16' })
  })

  it('this month starts in the previous year on 1 January', () => {
    const newYear = new Date(2026, 0, 1)
    expect(periodRange('month', newYear)).toEqual({ from: '2026-01-01', to: '2026-01-01' })
    expect(periodRange('week', newYear)).toEqual({ from: '2025-12-29', to: '2026-01-01' })
  })

  it('this year starts on 1 January', () => {
    expect(periodRange('year', FRIDAY)).toEqual({ from: '2026-01-01', to: '2026-10-16' })
  })

  it('last 30 days ends today and reaches back 29', () => {
    expect(periodRange('last30', FRIDAY)).toEqual({ from: '2026-09-17', to: '2026-10-16' })
  })

  it('last 30 days crosses the year boundary', () => {
    const newYear = new Date(2026, 0, 1)
    expect(periodRange('last30', newYear)).toEqual({ from: '2025-12-03', to: '2026-01-01' })
  })
})

describe('periodLabel', () => {
  it('names a preset', () => {
    expect(periodLabel({ kind: 'preset', preset: 'year' })).toBe('This year')
    expect(periodLabel({ kind: 'preset', preset: 'last30' })).toBe('Last 30 days')
  })

  it('shortens a custom range to "Oct 1 – Oct 16"', () => {
    const custom: PeriodSelection = { kind: 'custom', from: '2026-10-01', to: '2026-10-16' }
    expect(periodLabel(custom)).toBe('Oct 1 – Oct 16')
  })

  it('keeps the year when the range crosses one', () => {
    const custom: PeriodSelection = { kind: 'custom', from: '2025-12-03', to: '2026-01-01' }
    expect(periodLabel(custom)).toBe('Dec 3, 2025 – Jan 1')
  })
})

describe('customRange', () => {
  it('accepts a valid range', () => {
    expect(customRange('2026-10-01', '2026-10-16', FRIDAY)).toEqual({
      from: '2026-10-01',
      to: '2026-10-16',
    })
  })

  it('rejects from after to', () => {
    expect(customRange('2026-10-16', '2026-10-01', FRIDAY)).toBeNull()
  })

  it('rejects a to in the future', () => {
    expect(customRange('2026-10-01', '2026-10-17', FRIDAY)).toBeNull()
  })

  it('rejects an empty or malformed date', () => {
    expect(customRange('', '2026-10-16', FRIDAY)).toBeNull()
    expect(customRange('not-a-date', '2026-10-16', FRIDAY)).toBeNull()
  })
})

describe('PERIOD_PRESETS', () => {
  it('defaults to This year, as the design shows', () => {
    expect(PERIOD_PRESETS[0]).toMatchObject({ preset: 'year', label: 'This year' })
  })
})
