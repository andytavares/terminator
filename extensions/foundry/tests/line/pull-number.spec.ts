import { describe, it, expect } from 'vitest'
import { pullNumber } from '../../src/line/pull-number.js'

describe('pullNumber', () => {
  it('reads the number a pull request address ends in', () => {
    expect(pullNumber('https://github.com/andytavares/terminator/pull/233')).toBe(233)
  })

  it('reads it when the address carries a further path', () => {
    expect(pullNumber('https://github.com/andytavares/terminator/pull/233/files')).toBe(233)
  })

  it('is 0 for an address that is not a pull request', () => {
    expect(pullNumber('https://github.com/andytavares/terminator')).toBe(0)
  })
})
