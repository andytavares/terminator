import type { FastifyInstance } from 'fastify'
import type { AuthRateLimiter } from '../auth-rate-limiter.js'
import { verifyPassword } from '../password-hash.js'
import type { SessionStore } from '../session-store.js'

interface LoginRouteOptions {
  getPasswordHash: () => string
  sessionStore: SessionStore
  rateLimiter: AuthRateLimiter
}

/**
 * The one place the password is checked. A correct password is exchanged for a
 * session cookie; every later request is authorised by that cookie, so the
 * password is neither stored by the browser nor sent again.
 */
export async function registerLoginRoute(
  app: FastifyInstance,
  options: LoginRouteOptions
): Promise<void> {
  const { getPasswordHash, sessionStore, rateLimiter } = options

  app.post<{ Body: { password?: unknown } | null }>('/api/login', async (request, reply) => {
    const clientKey = request.ip
    if (rateLimiter.isLockedOut(clientKey)) {
      return reply.status(429).send({ error: 'TOO_MANY_REQUESTS' })
    }
    const password = request.body?.password
    const accepted =
      typeof password === 'string' &&
      password !== '' &&
      (await verifyPassword(password, getPasswordHash()))
    if (!accepted) {
      rateLimiter.recordFailure(clientKey)
      return reply.status(401).send({ error: 'UNAUTHORIZED' })
    }
    rateLimiter.recordSuccess(clientKey)
    reply.header('Set-Cookie', sessionStore.issueSession().setCookie)
    return { ok: true }
  })
}
