import { describe, it, expect, beforeEach, vi } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import bcryptjs from 'bcryptjs'
import { isAllowedHost } from '../../src/server/auth.middleware'

async function buildApp(
  passwordHash: string,
  extraRoutes?: (app: FastifyInstance) => void
): Promise<FastifyInstance> {
  const { registerAuthMiddleware } = await import('../../src/server/auth.middleware')
  const app = Fastify({ logger: false })
  await registerAuthMiddleware(app, { getPasswordHash: () => passwordHash })
  // API route requires auth; non-API routes (static, health) do not
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
  let hash: string

  beforeEach(async () => {
    vi.resetModules()
    hash = await bcryptjs.hash('correct-password', 10)
  })

  describe('Authorization header', () => {
    it('returns 401 when Authorization header is missing on API route', async () => {
      const app = await buildApp(hash)
      const res = await app.inject({ method: 'GET', url: '/api/protected' })
      await app.close()
      expect(res.statusCode).toBe(401)
      expect(JSON.parse(res.body)).toMatchObject({ error: 'UNAUTHORIZED' })
    })

    it('returns 401 when password is wrong', async () => {
      const app = await buildApp(hash)
      const res = await app.inject({
        method: 'GET',
        url: '/api/protected',
        headers: { Authorization: 'Bearer wrong-password' },
      })
      await app.close()
      expect(res.statusCode).toBe(401)
    })

    it('passes through when password is correct (IP host)', async () => {
      const app = await buildApp(hash)
      const res = await app.inject({
        method: 'GET',
        url: '/api/protected',
        headers: { Authorization: 'Bearer correct-password', Host: '127.0.0.1' },
      })
      await app.close()
      expect(res.statusCode).toBe(200)
    })

    it('passes through when password is correct (ngrok domain)', async () => {
      const app = await buildApp(hash)
      const res = await app.inject({
        method: 'GET',
        url: '/api/protected',
        headers: { Authorization: 'Bearer correct-password', Host: 'abc.ngrok-free.app' },
      })
      await app.close()
      expect(res.statusCode).toBe(200)
    })

    it('returns 403 when Host header is an unexpected external domain', async () => {
      const app = await buildApp(hash)
      const res = await app.inject({
        method: 'GET',
        url: '/api/protected',
        headers: { Authorization: 'Bearer correct-password', Host: 'evil.attacker.com' },
      })
      await app.close()
      expect(res.statusCode).toBe(403)
      expect(JSON.parse(res.body)).toMatchObject({ error: 'FORBIDDEN' })
    })

    it('returns 401 when hash is empty (no password set)', async () => {
      const app = await buildApp('')
      const res = await app.inject({
        method: 'GET',
        url: '/api/protected',
        headers: { Authorization: 'Bearer anything' },
      })
      await app.close()
      expect(res.statusCode).toBe(401)
    })
  })

  describe('Non-API paths bypass auth', () => {
    it('serves / without credentials', async () => {
      const app = await buildApp(hash)
      const res = await app.inject({ method: 'GET', url: '/' })
      await app.close()
      expect(res.statusCode).toBe(200)
    })

    it('serves /health without credentials', async () => {
      const app = await buildApp(hash)
      const res = await app.inject({ method: 'GET', url: '/health' })
      await app.close()
      expect(res.statusCode).toBe(200)
    })
  })

  describe('Self-authed routes bypass Bearer check but still get Host check', () => {
    it('allows /api/bridge without Authorization header (WebSocket self-auth)', async () => {
      const app = await buildApp(hash, (a) => {
        a.get('/api/bridge', async () => ({ ok: true }))
      })
      const res = await app.inject({ method: 'GET', url: '/api/bridge' })
      await app.close()
      expect(res.statusCode).toBe(200)
    })

    it('blocks /api/bridge with unexpected Host (DNS rebinding still applies)', async () => {
      const app = await buildApp(hash, (a) => {
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

    it('/api/bridge-ticket requires Bearer auth (not bypassed by self-authed check)', async () => {
      const app = await buildApp(hash, (a) => {
        a.post('/api/bridge-ticket', async () => ({ ticket: 'tok' }))
      })
      // No Authorization header → should get 401, not 200
      const res = await app.inject({ method: 'POST', url: '/api/bridge-ticket' })
      await app.close()
      expect(res.statusCode).toBe(401)
    })

    it('/api/bridge-ticket allows through when hasValidSession returns true (new-tab cookie auth)', async () => {
      const { registerAuthMiddleware } = await import('../../src/server/auth.middleware')
      const app = Fastify({ logger: false })
      await registerAuthMiddleware(app, {
        getPasswordHash: () => hash,
        hasValidSession: (cookie) => cookie.includes('app-session=valid-tok'),
      })
      app.post('/api/bridge-ticket', async () => ({ ticket: 'tok' }))
      await app.ready()

      const res = await app.inject({
        method: 'POST',
        url: '/api/bridge-ticket',
        headers: { cookie: 'app-session=valid-tok' },
      })
      await app.close()
      expect(res.statusCode).toBe(200)
    })

    it('/api/bridge-ticket still requires Bearer when hasValidSession returns false', async () => {
      const { registerAuthMiddleware } = await import('../../src/server/auth.middleware')
      const app = Fastify({ logger: false })
      await registerAuthMiddleware(app, {
        getPasswordHash: () => hash,
        hasValidSession: () => false,
      })
      app.post('/api/bridge-ticket', async () => ({ ticket: 'tok' }))
      await app.ready()

      const res = await app.inject({ method: 'POST', url: '/api/bridge-ticket' })
      await app.close()
      expect(res.statusCode).toBe(401)
    })
  })

  describe('LAN access', () => {
    it('allows request from RFC-1918 LAN IP host', async () => {
      const app = await buildApp(hash)
      const res = await app.inject({
        method: 'GET',
        url: '/api/protected',
        headers: { Authorization: 'Bearer correct-password', Host: '192.168.1.42:7681' },
      })
      await app.close()
      expect(res.statusCode).toBe(200)
    })
  })

  describe('/ws/ routes get DNS rebinding protection', () => {
    it('blocks /ws/terminals with unexpected Host', async () => {
      const app = await buildApp(hash, (a) => {
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
      const app = await buildApp(hash, (a) => {
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
