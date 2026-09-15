import { describe, it, expect } from 'vitest'
import { latestLineOf } from '../../../../src/renderer/sidebar/screen'

describe('latestLineOf', () => {
  it('is the last row with anything on it, trimmed', () => {
    expect(latestLineOf(['$ ls', '  a.txt  b.txt  ', '', '   '])).toBe('a.txt  b.txt')
  })

  it('reads above the cursor, so a shell prompt is not the summary', () => {
    expect(latestLineOf(['$ pnpm test', '14 passed, 2 failed', 'me@host ~/api $ ', ''], 2)).toBe(
      '14 passed, 2 failed'
    )
  })

  it('falls back to the last row when nothing is above the cursor', () => {
    expect(latestLineOf(['me@host ~ $ ', '', ''], 0)).toBe('me@host ~ $')
  })

  it('is empty for a blank screen', () => {
    expect(latestLineOf(['', '  '])).toBe('')
    expect(latestLineOf([])).toBe('')
  })
})
