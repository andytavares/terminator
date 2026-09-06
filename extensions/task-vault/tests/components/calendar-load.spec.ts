import { describe, it, expect } from 'vitest'
import { dayLoadLabel, isOverdue, shortDay, weekOf } from '../../src/state/calendar-load'

// The cell said only its own date, which the grid already shows — so a month of
// dots could not be read without clicking into every day.

describe('dayLoadLabel', () => {
  it('says a day is empty', () => {
    expect(dayLoadLabel('2026-09-05', [])).toBe('2026-09-05 · nothing')
  })

  it('says how much is still open', () => {
    expect(
      dayLoadLabel('2026-09-05', [{ status: 'open' }, { status: 'done' }, { status: 'blocked' }])
    ).toBe('2026-09-05 · 2 of 3 still open')
  })

  it('says a finished day is finished rather than counting zero', () => {
    expect(dayLoadLabel('2026-09-05', [{ status: 'done' }, { status: 'done' }])).toBe(
      '2026-09-05 · 2 done'
    )
  })

  it.each(['migrated', 'cancelled'])('does not count %s as still open', (status) => {
    expect(dayLoadLabel('2026-09-05', [{ status }])).toBe('2026-09-05 · 1 done')
  })
})

describe('isOverdue', () => {
  const today = '2026-09-05'

  it('marks a past day still holding open work', () => {
    expect(isOverdue('2026-09-01', [{ status: 'open' }], today)).toBe(true)
  })

  it('leaves a past day that finished everything alone', () => {
    expect(isOverdue('2026-09-01', [{ status: 'done' }], today)).toBe(false)
  })

  it('leaves an empty past day alone', () => {
    expect(isOverdue('2026-09-01', [], today)).toBe(false)
  })

  // Today's open work is not late.
  it('does not mark today', () => {
    expect(isOverdue(today, [{ status: 'open' }], today)).toBe(false)
  })

  it('does not mark the future', () => {
    expect(isOverdue('2026-09-09', [{ status: 'open' }], today)).toBe(false)
  })
})

describe('weekOf', () => {
  it('returns seven days', () => {
    expect(weekOf('2026-09-05')).toHaveLength(7)
  })

  it('starts on the Sunday containing the date', () => {
    // 2026-09-05 is a Saturday, so its week starts 2026-08-30.
    expect(weekOf('2026-09-05')[0]).toBe('2026-08-30')
    expect(weekOf('2026-09-05')[6]).toBe('2026-09-05')
  })

  it('handles a date that is already Sunday', () => {
    expect(weekOf('2026-08-30')[0]).toBe('2026-08-30')
  })

  it('crosses a month boundary without losing a day', () => {
    const week = weekOf('2026-09-01')
    expect(week).toHaveLength(7)
    expect(new Set(week).size).toBe(7)
  })
})

describe('shortDay', () => {
  it('names the day and its number, without the year', () => {
    expect(shortDay('2026-09-05')).toMatch(/^Sat\b/)
    expect(shortDay('2026-09-05')).not.toContain('2026')
  })
})
