import { describe, it, expect } from 'vitest'
import { localDate } from '../../src/utils/local-date'

describe('localDate', () => {
  it('formats a date as YYYY-MM-DD', () => {
    expect(localDate(new Date(2024, 0, 5))).toBe('2024-01-05')
  })

  it('pads single-digit month and day', () => {
    expect(localDate(new Date(2024, 2, 9))).toBe('2024-03-09')
  })
})
