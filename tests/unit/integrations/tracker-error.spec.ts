import { describe, it, expect } from 'vitest'
import { TrackerError, toErrorKind } from '../../../src/main/integrations/tracker-error'

describe('TrackerError', () => {
  it('carries a kind and a message', () => {
    const err = new TrackerError('auth-failed', 'token revoked')
    expect(err.kind).toBe('auth-failed')
    expect(err.message).toBe('token revoked')
    expect(err).toBeInstanceOf(Error)
  })

  it('carries the tracker-stated retry period for a rate limit', () => {
    const err = new TrackerError('rate-limited', 'slow down', { retryAfterMs: 30_000 })
    expect(err.retryAfterMs).toBe(30_000)
  })

  it('leaves retryAfterMs undefined for every other kind', () => {
    expect(new TrackerError('unavailable', 'offline').retryAfterMs).toBeUndefined()
  })
})

describe('toErrorKind', () => {
  it('passes a TrackerError through unchanged', () => {
    expect(toErrorKind(new TrackerError('not-found', 'gone'))).toBe('not-found')
  })

  it('maps a network failure to unavailable rather than failed', () => {
    const netErr = Object.assign(new TypeError('fetch failed'), { code: 'ENOTFOUND' })
    expect(toErrorKind(netErr)).toBe('unavailable')
  })

  it('falls back to failed for anything unrecognised', () => {
    expect(toErrorKind(new Error('who knows'))).toBe('failed')
    expect(toErrorKind('a string')).toBe('failed')
    expect(toErrorKind(undefined)).toBe('failed')
  })

  it('never lets a raw HTTP status or SDK error escape as a kind', () => {
    // The taxonomy is closed. Anything not in it must land on 'failed'.
    expect(toErrorKind({ status: 429 })).toBe('failed')
    expect(toErrorKind({ type: 'Ratelimited' })).toBe('failed')
    expect(toErrorKind(new Error('429'))).toBe('failed')
  })
})
