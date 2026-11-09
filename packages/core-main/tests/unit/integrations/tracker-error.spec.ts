import { describe, it, expect } from 'vitest'
import { TrackerError, toErrorKind } from '../../../src/integrations/tracker-error'

describe('TrackerError', () => {
  it.each([
    ['rate-limited', 2000],
    ['unavailable', undefined],
  ] as const)('given retryAfterMs, a %s error carries %s', (kind, expected) => {
    expect(new TrackerError(kind, 'slow down', { retryAfterMs: 2000 }).retryAfterMs).toBe(expected)
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
