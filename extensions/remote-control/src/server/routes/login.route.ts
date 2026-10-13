import type { FastifyInstance } from 'fastify'
import type { AuthRateLimiter } from '../auth-rate-limiter.js'
import { verifyPassword } from '../password-hash.js'
import type { SessionStore } from '../session-store.js'

interface LoginRouteOptions {
  getPasswordHash: () => string
  sessionStore: SessionStore
  rateLimiter: AuthRateLimiter
}

/** The one place the password is checked. It is exchanged for a session cookie that authorises
 *  every later request, so the browser neither stores nor resends the password. */
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
