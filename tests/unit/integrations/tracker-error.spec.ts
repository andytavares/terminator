import { describe, it, expect } from 'vitest'
import {
  TrackerError,
  fromHttpStatus,
  toErrorKind,
} from '../../../src/main/integrations/tracker-error'

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

describe('fromHttpStatus', () => {
  it.each([
    [401, 'auth-failed'],
    [403, 'auth-failed'],
    [404, 'not-found'],
    [429, 'rate-limited'],
    [500, 'unavailable'],
    [502, 'unavailable'],
    [503, 'unavailable'],
    [418, 'failed'],
  ])('maps %i to %s', (status, kind) => {
    expect(fromHttpStatus(status, 'x').kind).toBe(kind)
  })

  it('reads Retry-After seconds into retryAfterMs', () => {
    const err = fromHttpStatus(429, 'rate limited', { retryAfterSeconds: 45 })
    expect(err.retryAfterMs).toBe(45_000)
  })

  it('keeps the tracker message verbatim — the operator sees what the tracker said', () => {
    expect(fromHttpStatus(400, "jql is invalid: unknown field 'foo'").message).toBe(
      "jql is invalid: unknown field 'foo'"
    )
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
    const kinds = [
      toErrorKind({ status: 429 }),
      toErrorKind({ type: 'Ratelimited' }),
      toErrorKind(new Error('429')),
    ]
    const allowed = [
      'not-connected',
      'auth-failed',
      'rate-limited',
      'unavailable',
      'not-found',
      'failed',
    ]
    for (const k of kinds) expect(allowed).toContain(k)
  })
})
