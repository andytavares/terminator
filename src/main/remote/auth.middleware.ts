import bcryptjs from 'bcryptjs'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'

// Only API routes require authentication; static assets and health are public
const API_PREFIX = '/api'

// Routes that handle their own auth (e.g. WebSocket routes where browsers can't send headers)
const SELF_AUTHED = new Set(['/api/bridge', '/ws/terminals'])

// Allowed hosts: localhost variants and ngrok tunnel domains
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
const NGROK_PATTERN = /\.ngrok(-free)?\.app$|\.ngrok\.io$/

function isAllowedHost(rawHost: string): boolean {
  // Strip port number
  const host = rawHost.replace(/:\d+$/, '').toLowerCase()
  return LOOPBACK_HOSTS.has(host) || NGROK_PATTERN.test(host)
}

interface AuthMiddlewareOptions {
  getPasswordHash: () => string
}

export async function registerAuthMiddleware(
  app: FastifyInstance,
  opts: AuthMiddlewareOptions
): Promise<void> {
  const { getPasswordHash } = opts

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.url.startsWith(API_PREFIX)) return
    // WebSocket routes handle their own auth — browsers can't set Authorization headers on WS
    if ([...SELF_AUTHED].some((p) => request.url.startsWith(p))) return

    // DNS rebinding protection: reject requests from unexpected origins
    const rawHost = request.headers.host ?? ''
    if (rawHost && !isAllowedHost(rawHost)) {
      return reply.status(403).send({ error: 'FORBIDDEN' })
    }

    const authHeader = request.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'UNAUTHORIZED' })
    }

    const password = authHeader.slice(7)
    const hash = getPasswordHash()
    if (!hash) {
      return reply.status(401).send({ error: 'UNAUTHORIZED' })
    }
    const valid = await bcryptjs.compare(password, hash)
    if (!valid) {
      return reply.status(401).send({ error: 'UNAUTHORIZED' })
    }
  })
}
