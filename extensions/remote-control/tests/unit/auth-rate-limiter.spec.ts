import { describe, it, expect } from 'vitest'
import { AuthRateLimiter } from '../../src/server/auth-rate-limiter'

describe('AuthRateLimiter', () => {
  it('does not lock out before maxAttempts failures', () => {
    const now = 0
    const limiter = new AuthRateLimiter({ maxAttempts: 3, windowMs: 1000, now: () => now })
    limiter.recordFailure('1.2.3.4')
    limiter.recordFailure('1.2.3.4')
    expect(limiter.isLockedOut('1.2.3.4')).toBe(false)
  })

  it('locks out once maxAttempts failures occur within the window', () => {
    const now = 0
    const limiter = new AuthRateLimiter({ maxAttempts: 3, windowMs: 1000, now: () => now })
    limiter.recordFailure('1.2.3.4')
    limiter.recordFailure('1.2.3.4')
    limiter.recordFailure('1.2.3.4')
    expect(limiter.isLockedOut('1.2.3.4')).toBe(true)
  })

  it('tracks each client key independently', () => {
    const now = 0
    const limiter = new AuthRateLimiter({ maxAttempts: 2, windowMs: 1000, now: () => now })
    limiter.recordFailure('a')
    limiter.recordFailure('a')
    expect(limiter.isLockedOut('a')).toBe(true)
    expect(limiter.isLockedOut('b')).toBe(false)
  })

  it('unlocks after the window elapses with no new failures', () => {
    let now = 0
    const limiter = new AuthRateLimiter({ maxAttempts: 2, windowMs: 1000, now: () => now })
    limiter.recordFailure('x')
    limiter.recordFailure('x')
    expect(limiter.isLockedOut('x')).toBe(true)
    now = 1001
    expect(limiter.isLockedOut('x')).toBe(false)
  })

  it('clears all failures on success', () => {
    const now = 0
    const limiter = new AuthRateLimiter({ maxAttempts: 2, windowMs: 1000, now: () => now })
    limiter.recordFailure('x')
    limiter.recordSuccess('x')
    limiter.recordFailure('x')
    expect(limiter.isLockedOut('x')).toBe(false)
  })
})
