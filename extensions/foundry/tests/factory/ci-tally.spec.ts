import { describe, it, expect } from 'vitest'
import { tallyChecks, waitingOnChecks } from '../../src/factory/ci-tally.js'

describe('factory/ci-tally', () => {
  it('counts passed, pending and failed checks, and what is done', () => {
    const tally = tallyChecks(['pass', 'pass', 'pending', 'fail', 'cancel', 'skipping'])
    expect(tally).toEqual({ passed: 3, pending: 1, failed: 2, total: 6, done: 5 })
  })

  it('counts nothing for no checks', () => {
    expect(tallyChecks([])).toEqual({ passed: 0, pending: 0, failed: 0, total: 0, done: 0 })
  })

  it('says how far the wait has got only while a check is pending', () => {
    const buckets = [...Array(12).fill('pass'), ...Array(7).fill('pending')]
    expect(waitingOnChecks(tallyChecks(buckets))).toBe('Waiting on checks · 12 of 19 done')
    expect(waitingOnChecks(tallyChecks(['pass', 'fail']))).toBeNull()
    expect(waitingOnChecks(tallyChecks([]))).toBeNull()
  })
})
