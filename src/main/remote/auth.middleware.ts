import bcryptjs from 'bcryptjs'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'

// Routes that require DNS rebinding protection (auth-gated or self-auth WebSocket routes)
const PROTECTED_PREFIXES = ['/api', '/ws']

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
    const isProtected = PROTECTED_PREFIXES.some((p) => request.url.startsWith(p))
    if (!isProtected) return

    // DNS rebinding protection: applies to all /api and /ws routes
    const rawHost = request.headers.host ?? ''
    if (rawHost && !isAllowedHost(rawHost)) {
      return reply.status(403).send({ error: 'FORBIDDEN' })
    }

    // WebSocket upgrade routes handle their own auth via ticket — browsers can't send Authorization on WS
    const pathname = request.url.split('?')[0]
    if (pathname === '/api/bridge' || pathname.startsWith('/ws/terminals/')) return

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
