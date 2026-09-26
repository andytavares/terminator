import { describe, it, expect } from 'vitest'
import { formatDuration, ordinal } from '../../src/factory/format.js'

describe('factory/format formatDuration', () => {
  it('renders sub-minute durations in seconds', () => {
    expect(formatDuration(45_000)).toBe('45 s')
  })

  it('rounds to the nearest second', () => {
    expect(formatDuration(1_400)).toBe('1 s')
  })

  it('renders sub-hour durations in minutes', () => {
    expect(formatDuration(5 * 60_000)).toBe('5 min')
  })

  it('renders hours and minutes together', () => {
    expect(formatDuration(80 * 60_000)).toBe('1 h 20 min')
  })

  it('drops the minutes when the duration lands on the hour', () => {
    expect(formatDuration(2 * 60 * 60_000)).toBe('2 h')
  })

  it('treats zero as zero seconds', () => {
    expect(formatDuration(0)).toBe('0 s')
  })
})

describe('factory/format ordinal', () => {
  it.each([
    [1, '1st'],
    [2, '2nd'],
    [3, '3rd'],
    [4, '4th'],
    [11, '11th'],
    [12, '12th'],
    [13, '13th'],
    [21, '21st'],
    [22, '22nd'],
    [23, '23rd'],
    [101, '101st'],
    [111, '111th'],
  ])('renders %i as %s', (n, word) => {
    expect(ordinal(n)).toBe(word)
  })
})
