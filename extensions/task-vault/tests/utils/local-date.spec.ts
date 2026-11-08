import { describe, it, expect } from 'vitest'
import { localDate, monthNameOf, weekdayName } from '../../src/utils/local-date'

describe('localDate', () => {
  it('formats a date as YYYY-MM-DD, padding a single-digit month and day', () => {
    expect(localDate(new Date(2024, 0, 5))).toBe('2024-01-05')
  })
})

describe('monthNameOf', () => {
  it('names months from 0 for January to 11 for December', () => {
    expect([0, 5, 11].map(monthNameOf)).toEqual(['January', 'June', 'December'])
  })
})

describe('weekdayName', () => {
  it('names weekdays from 0 for Sunday, in full or in three letters', () => {
    expect([0, 3, 6].map((day) => weekdayName(day))).toEqual(['Sunday', 'Wednesday', 'Saturday'])
    expect([0, 1, 6].map((day) => weekdayName(day, 'short'))).toEqual(['Sun', 'Mon', 'Sat'])
  })
})
