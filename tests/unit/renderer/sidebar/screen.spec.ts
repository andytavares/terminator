import { describe, it, expect } from 'vitest'
import { latestLineOf } from '../../../../src/renderer/sidebar/screen'

describe('latestLineOf', () => {
  it('is the last row with anything on it, trimmed', () => {
    expect(latestLineOf(['$ ls', '  a.txt  b.txt  ', '', '   '])).toBe('a.txt  b.txt')
  })

  it('is empty for a blank screen', () => {
    expect(latestLineOf(['', '  '])).toBe('')
    expect(latestLineOf([])).toBe('')
  })
})
