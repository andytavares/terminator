import { describe, it, expect } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { isAllowedHost, registerAuthMiddleware } from '../../src/server/auth.middleware'

const VALID_COOKIE = 'remote-session=valid-token'

async function buildApp(extraRoutes?: (app: FastifyInstance) => void): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await registerAuthMiddleware(app, {
    hasValidSession: (cookie) => cookie.includes(VALID_COOKIE),
  })
  // API route requires a session; non-API routes (static, health) do not
  app.get('/api/protected', async () => ({ ok: true }))
  app.get('/health', async () => ({ ok: true }))
  app.get('/', async () => ({ ok: true }))
  extraRoutes?.(app)
  await app.ready()
  return app
}

describe('isAllowedHost', () => {
  it('returns false for empty string (missing Host header should be blocked)', () =>
    expect(isAllowedHost('')).toBe(false))
  it('allows localhost', () => expect(isAllowedHost('localhost')).toBe(true))
  it('allows localhost with port', () => expect(isAllowedHost('localhost:7681')).toBe(true))
  it('allows 127.0.0.1', () => expect(isAllowedHost('127.0.0.1')).toBe(true))
  it('allows 127.0.0.1 with port', () => expect(isAllowedHost('127.0.0.1:7681')).toBe(true))
  it('allows ::1', () => expect(isAllowedHost('::1')).toBe(true))
  it('allows ngrok-free.app subdomain', () =>
    expect(isAllowedHost('abc.ngrok-free.app')).toBe(true))
  it('allows ngrok.io subdomain', () => expect(isAllowedHost('abc.ngrok.io')).toBe(true))
  it('allows ngrok-free.dev subdomain', () =>
    expect(isAllowedHost('abc.ngrok-free.dev')).toBe(true))
  it('allows RFC-1918 10.x address', () => expect(isAllowedHost('10.0.0.5')).toBe(true))
  it('allows RFC-1918 172.16.x address', () => expect(isAllowedHost('172.16.0.1')).toBe(true))
  it('allows RFC-1918 192.168.x address', () => expect(isAllowedHost('192.168.1.50')).toBe(true))
  it('allows RFC-1918 192.168.x address with port', () =>
    expect(isAllowedHost('192.168.1.50:7681')).toBe(true))
  it('blocks public domain', () => expect(isAllowedHost('evil.attacker.com')).toBe(false))
  it('blocks public IP', () => expect(isAllowedHost('8.8.8.8')).toBe(false))
})

describe('auth.middleware', () => {
  describe('session cookie', () => {
    it('returns 401 when there is no session cookie on an API route', async () => {
      const app = await buildApp()
      const res = await app.inject({ method: 'GET', url: '/api/protected' })
      await app.close()
      expect(res.statusCode).toBe(401)
      expect(JSON.parse(res.body)).toMatchObject({ error: 'UNAUTHORIZED' })
    })

    it('returns 401 for a session cookie the server did not issue', async () => {
      const app = await buildApp()
      const res = await app.inject({
        method: 'GET',
        url: '/api/protected',
        headers: { cookie: 'remote-session=other' },
      })
      await app.close()
      expect(res.statusCode).toBe(401)
    })

    it('does not accept an Authorization header in place of a session', async () => {
      const app = await buildApp()
      const res = await app.inject({
        method: 'GET',
        url: '/api/protected',
        headers: { Authorization: 'Bearer correct-password' },
      })
      await app.close()
      expect(res.statusCode).toBe(401)
    })

    it.each([
      ['IP host', '127.0.0.1'],
      ['ngrok domain', 'abc.ngrok-free.app'],
      ['RFC-1918 LAN host with port', '192.168.1.42:7681'],
    ])('passes through with a valid session (%s)', async (_label, host) => {
      const app = await buildApp()
      const res = await app.inject({
        method: 'GET',
        url: '/api/protected',
        headers: { cookie: VALID_COOKIE, Host: host },
      })
      await app.close()
      expect(res.statusCode).toBe(200)
    })

    it('returns 403 when Host header is an unexpected external domain', async () => {
      const app = await buildApp()
      const res = await app.inject({
        method: 'GET',
        url: '/api/protected',
        headers: { cookie: VALID_COOKIE, Host: 'evil.attacker.com' },
      })
      await app.close()
      expect(res.statusCode).toBe(403)
      expect(JSON.parse(res.body)).toMatchObject({ error: 'FORBIDDEN' })
    })
  })

  describe('Non-API paths bypass auth', () => {
    it('serves / without credentials', async () => {
      const app = await buildApp()
      const res = await app.inject({ method: 'GET', url: '/' })
      await app.close()
      expect(res.statusCode).toBe(200)
    })

    it('serves /health without credentials', async () => {
      const app = await buildApp()
      const res = await app.inject({ method: 'GET', url: '/health' })
      await app.close()
      expect(res.statusCode).toBe(200)
    })
  })

  describe('Self-authenticating routes skip the session check but still get the Host check', () => {
    it.each(['/api/bridge', '/api/login'])('allows %s without a session', async (url) => {
      const app = await buildApp((a) => {
        a.all(url, async () => ({ ok: true }))
      })
      const res = await app.inject({ method: 'POST', url })
      await app.close()
      expect(res.statusCode).toBe(200)
    })

    it('blocks /api/bridge with unexpected Host (DNS rebinding still applies)', async () => {
      const app = await buildApp((a) => {
        a.get('/api/bridge', async () => ({ ok: true }))
      })
      const res = await app.inject({
        method: 'GET',
        url: '/api/bridge',
        headers: { Host: 'evil.attacker.com' },
      })
      await app.close()
      expect(res.statusCode).toBe(403)
    })

    it('/api/bridge-ticket requires a session', async () => {
      const app = await buildApp((a) => {
        a.post('/api/bridge-ticket', async () => ({ ticket: 'tok' }))
      })
      const res = await app.inject({ method: 'POST', url: '/api/bridge-ticket' })
      await app.close()
      expect(res.statusCode).toBe(401)
    })

    it('/api/bridge-ticket is issued to a client with a valid session', async () => {
      const app = await buildApp((a) => {
        a.post('/api/bridge-ticket', async () => ({ ticket: 'tok' }))
      })
      const res = await app.inject({
        method: 'POST',
        url: '/api/bridge-ticket',
        headers: { cookie: VALID_COOKIE },
      })
      await app.close()
      expect(res.statusCode).toBe(200)
    })
  })

  describe('/ws/ routes get DNS rebinding protection', () => {
    it('blocks /ws/terminals with unexpected Host', async () => {
      const app = await buildApp((a) => {
        a.get('/ws/terminals/s1', async () => ({ ok: true }))
      })
      const res = await app.inject({
        method: 'GET',
        url: '/ws/terminals/s1',
        headers: { Host: 'evil.attacker.com' },
      })
      await app.close()
      expect(res.statusCode).toBe(403)
    })

    it('allows /ws/terminals from localhost', async () => {
      const app = await buildApp((a) => {
        a.get('/ws/terminals/s1', async () => ({ ok: true }))
      })
      const res = await app.inject({
        method: 'GET',
        url: '/ws/terminals/s1',
        headers: { Host: 'localhost:7681' },
      })
      await app.close()
      expect(res.statusCode).toBe(200)
    })
  })
})
