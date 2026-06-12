import bcryptjs from 'bcryptjs'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'

// Only API routes require authentication; static assets and health are public
const API_PREFIX = '/api'

// Routes that handle their own auth (e.g. WebSocket routes where browsers can't send headers)
// They still get DNS rebinding checks applied via checkHost()
const SELF_AUTHED = new Set(['/api/bridge', '/ws/terminals'])

// Allowed hosts: loopback, private RFC-1918 ranges (LAN), and ngrok tunnel domains
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
const NGROK_PATTERN = /\.ngrok(-free)?\.app$|\.ngrok\.io$/
// RFC 1918 private ranges: 10.x, 172.16-31.x, 192.168.x
const PRIVATE_IP_PATTERN =
  /^(10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+)$/

export function isAllowedHost(rawHost: string): boolean {
  // Strip port safely: IPv4/hostname have one colon max; IPv6 uses [addr]:port bracket notation
  const stripped = rawHost.startsWith('[')
    ? rawHost.replace(/\]:\d+$/, ']') // [::1]:7681 → [::1]
    : rawHost.replace(/^([^:]+):\d+$/, '$1') // host:7681 → host, leaves ::1 untouched
  const host = stripped.toLowerCase()
  return LOOPBACK_HOSTS.has(host) || NGROK_PATTERN.test(host) || PRIVATE_IP_PATTERN.test(host)
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

    // DNS rebinding protection: reject requests from unexpected origins.
    // Applied to ALL /api routes including self-authed WebSocket routes.
    const rawHost = request.headers.host ?? ''
    if (rawHost && !isAllowedHost(rawHost)) {
      return reply.status(403).send({ error: 'FORBIDDEN' })
    }

    // WebSocket routes handle their own Bearer/token auth — browsers can't set Authorization headers
    if ([...SELF_AUTHED].some((p) => request.url.startsWith(p))) return

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
