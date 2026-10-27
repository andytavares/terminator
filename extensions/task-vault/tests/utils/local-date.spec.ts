import { describe, it, expect } from 'vitest'
import { localDate, monthName, weekdayName } from '../../src/utils/local-date'

describe('localDate', () => {
  it('formats a date as YYYY-MM-DD', () => {
    expect(localDate(new Date(2024, 0, 5))).toBe('2024-01-05')
  })

  it('pads single-digit month and day', () => {
    expect(localDate(new Date(2024, 2, 9))).toBe('2024-03-09')
  })
})

describe('monthName', () => {
  it('names months from 0 for January to 11 for December', () => {
    expect([0, 5, 11].map(monthName)).toEqual(['January', 'June', 'December'])
  })
})

describe('weekdayName', () => {
  it('names weekdays from 0 for Sunday, in full or in three letters', () => {
    expect([0, 3, 6].map((day) => weekdayName(day))).toEqual(['Sunday', 'Wednesday', 'Saturday'])
    expect([0, 1, 6].map((day) => weekdayName(day, 'short'))).toEqual(['Sun', 'Mon', 'Sat'])
  })
})
