import { describe, it, expect } from 'vitest'
import { formatRelativeTime } from '../../../../src/renderer/sidebar/relative-time'

const NOW = 1_000_000_000

describe('formatRelativeTime', () => {
  it.each([
    ['now', 0],
    ['now', 59_000],
    ['1m', 60_000],
    ['59m', 59 * 60_000],
    ['1h', 3_600_000],
    ['23h', 23 * 3_600_000],
    ['1d', 86_400_000],
    ['30d', 30 * 86_400_000],
  ])('renders %s for an elapsed time of %i ms', (expected, elapsed) => {
    expect(formatRelativeTime(NOW - elapsed, NOW)).toBe(expected)
  })

  it('clamps a future timestamp to now rather than showing negative time', () => {
    expect(formatRelativeTime(NOW + 60_000, NOW)).toBe('now')
  })
})
