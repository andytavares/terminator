import { describe, it, expect, beforeEach, vi } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import bcryptjs from 'bcryptjs'

async function buildApp(
  passwordHash: string,
  extraRoutes?: (app: FastifyInstance) => void
): Promise<FastifyInstance> {
  const { registerAuthMiddleware } = await import('../auth.middleware')
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

  describe('Self-authed routes bypass middleware', () => {
    it('allows /api/bridge without Authorization header (WebSocket self-auth)', async () => {
      const app = await buildApp(hash, (a) => {
        a.get('/api/bridge', async () => ({ ok: true }))
      })
      const res = await app.inject({ method: 'GET', url: '/api/bridge' })
      await app.close()
      expect(res.statusCode).toBe(200)
    })
  })
})
