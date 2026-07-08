import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SessionStore } from '../../src/server/session-store'

describe('SessionStore', () => {
  let store: SessionStore

  beforeEach(() => {
    vi.useFakeTimers()
    store = new SessionStore({ cookieName: 'app-session', cookiePath: '/app', ttlMs: 60_000 })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('issues a token with an HttpOnly, path-scoped, Max-Age cookie', () => {
    const { token, setCookie } = store.issueSession()
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(setCookie).toBe(`app-session=${token}; Path=/app; HttpOnly; SameSite=Strict; Max-Age=60`)
  })

  it('validates the cookie header for an issued token', () => {
    const { token } = store.issueSession()
    expect(store.hasValidSession(`app-session=${token}`)).toBe(true)
    expect(store.hasValidSession(`other=1; app-session=${token}; x=2`)).toBe(true)
  })

  it('rejects missing, unknown, and differently-named cookies', () => {
    store.issueSession()
    expect(store.hasValidSession('')).toBe(false)
    expect(store.hasValidSession('app-session=deadbeef')).toBe(false)
    expect(store.hasValidSession('mobile-session=deadbeef')).toBe(false)
  })

  it('expires tokens after the TTL and forgets them on the failed check', () => {
    const { token } = store.issueSession()
    vi.advanceTimersByTime(60_001)
    expect(store.hasValidSession(`app-session=${token}`)).toBe(false)
    // Token is gone even if time were rolled back
    vi.setSystemTime(Date.now() - 120_000)
    expect(store.hasValidSession(`app-session=${token}`)).toBe(false)
  })

  it('sweep purges expired tokens and keeps live ones', () => {
    const { token: old } = store.issueSession()
    vi.advanceTimersByTime(30_000)
    const { token: fresh } = store.issueSession()
    vi.advanceTimersByTime(30_001) // old expired (60s), fresh at 30s
    store.sweep()
    expect(store.size).toBe(1)
    expect(store.hasValidSession(`app-session=${fresh}`)).toBe(true)
    expect(store.hasValidSession(`app-session=${old}`)).toBe(false)
  })

  it('clear drops every session', () => {
    store.issueSession()
    store.issueSession()
    store.clear()
    expect(store.size).toBe(0)
  })
})
