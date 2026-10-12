import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { registerAuthMiddleware } from '../../src/server/auth.middleware'
import { registerLoginRoute } from '../../src/server/routes/login.route'
import { SessionStore } from '../../src/server/session-store'
import { AuthRateLimiter } from '../../src/server/auth-rate-limiter'
import { hashPassword } from '../../src/server/password-hash'

const PASSWORD = 'correct-password'
let storedHash = ''
let app: FastifyInstance

beforeAll(async () => {
  storedHash = await hashPassword(PASSWORD)
})

beforeEach(async () => {
  const sessionStore = new SessionStore({
    cookieName: 'remote-session',
    cookiePath: '/',
    ttlMs: 60_000,
  })
  app = Fastify({ logger: false })
  await registerAuthMiddleware(app, {
    hasValidSession: (cookie) => sessionStore.hasValidSession(cookie),
  })
  await registerLoginRoute(app, {
    getPasswordHash: () => storedHash,
    sessionStore,
    rateLimiter: new AuthRateLimiter(),
  })
  app.get('/api/protected', async () => ({ ok: true }))
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

function login(password: unknown) {
  return app.inject({ method: 'POST', url: '/api/login', payload: { password } })
}

function cookieOf(response: { headers: Record<string, unknown> }): string {
  return String(response.headers['set-cookie']).split(';')[0]
}

describe('POST /api/login', loginRouteTests)

describe('requests after login', () => {
  it('are refused without the session cookie', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/protected' })).statusCode).toBe(401)
  })

  it('are refused when the password is sent as a Bearer header instead', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/protected',
      headers: { authorization: `Bearer ${PASSWORD}` },
    })
    expect(res.statusCode).toBe(401)
  })

  it('are refused with a forged session cookie', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/protected',
      headers: { cookie: 'remote-session=forged' },
    })
    expect(res.statusCode).toBe(401)
  })
})

function loginRouteTests() {
  describe('accepting the password', loginAcceptTests)
  describe('rejecting a login', loginRejectTests)
  describe('lockout and Host checks', loginLockoutTests)
}

function loginAcceptTests() {
  it('answers a correct password with a session cookie that authorises later requests', async () => {
    const res = await login(PASSWORD)
    expect(res.statusCode).toBe(200)
    const protectedRes = await app.inject({
      method: 'GET',
      url: '/api/protected',
      headers: { cookie: cookieOf(res) },
    })
    expect(protectedRes.statusCode).toBe(200)
  })

  it('issues an HttpOnly, SameSite=Strict cookie that is not the password', async () => {
    const res = await login(PASSWORD)
    const setCookie = String(res.headers['set-cookie'])
    expect(setCookie).toMatch(/HttpOnly/)
    expect(setCookie).toMatch(/SameSite=Strict/)
    expect(setCookie).not.toContain(PASSWORD)
    expect(res.body).not.toContain(PASSWORD)
  })
}

function loginRejectTests() {
  it('rejects a wrong password without issuing a cookie', async () => {
    const res = await login('wrong-password')
    expect(res.statusCode).toBe(401)
    expect(res.headers['set-cookie']).toBeUndefined()
  })

  it('rejects a missing, non-string or empty password', async () => {
    for (const password of [undefined, 42, '']) {
      expect((await login(password)).statusCode).toBe(401)
    }
  })

  it('rejects every login while no password is set', async () => {
    storedHash = ''
    const res = await login('')
    storedHash = await hashPassword(PASSWORD)
    expect(res.statusCode).toBe(401)
  })
}

function loginLockoutTests() {
  it('locks a client out after repeated wrong passwords, even for the right one', async () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      expect((await login('wrong-password')).statusCode).toBe(401)
    }
    expect((await login(PASSWORD)).statusCode).toBe(429)
  })

  it('refuses a request whose Host is not local, LAN or tunnel', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/login',
      headers: { host: 'evil.attacker.com' },
      payload: { password: PASSWORD },
    })
    expect(res.statusCode).toBe(403)
  })
}
