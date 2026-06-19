import Fastify, { type FastifyInstance } from 'fastify'
import websocketPlugin from '@fastify/websocket'
import staticPlugin from '@fastify/static'
import { join, resolve } from 'path'
import { randomBytes } from 'crypto'
import { readFileSync, existsSync } from 'fs'
import { app as electronApp } from 'electron'
import type { PtyManagerAPI, WorkspaceSnapshot, ProjectSnapshot } from '../types.js'
import { registerHealthRoute } from './routes/health.route.js'
import { registerTerminalRoutes } from './routes/terminal.routes.js'
import { registerWorkspaceRoutes } from './routes/workspace.routes.js'
import { registerAuthMiddleware } from './auth.middleware.js'
import { registerBridgeRoute } from './routes/bridge.route.js'
import { WsTicketStore } from './ws-ticket-store.js'
import { WsSubscriberManager } from './ws-subscriber-manager.js'

export interface RemoteServerDeps {
  getPasswordHash: () => string
  getMaxSubscribers: () => number
  listWorkspaces: () => WorkspaceSnapshot[]
  listProjects: (workspaceId: string) => ProjectSnapshot[]
  invokeChannel: (channel: string, payload: unknown) => Promise<unknown>
  sendChannel: (channel: string, payload: unknown) => void
  onWindowEvent: (channel: string, handler: (...args: unknown[]) => void) => () => void
  onPortInUse: (port: number) => void
}

export interface RemoteServerOptions {
  port: number
  ptyManager: PtyManagerAPI
  deps: RemoteServerDeps
}

export interface RemoteServerHandle {
  start(): Promise<void>
  stop(): Promise<void>
  isListening(): boolean
  disconnectAllClients(): void
  inject: FastifyInstance['inject']
}

export class PortInUseError extends Error {
  constructor(port: number) {
    super(`Port ${port} is already in use. Change the port in Settings.`)
    this.name = 'PortInUseError'
  }
}

function getRemoteRendererDir(): string {
  const candidates = [
    join(electronApp.getAppPath(), 'out', 'renderer-remote'),
    resolve(__dirname, '..', '..', '..', '..', 'out', 'renderer-remote'),
  ]
  return candidates.find(existsSync) ?? candidates[0]
}

function getRendererDir(): string {
  const candidates = [
    join(electronApp.getAppPath(), 'out', 'renderer'),
    resolve(__dirname, '..', '..', '..', '..', 'out', 'renderer'),
  ]
  return candidates.find(existsSync) ?? candidates[0]
}

export async function createRemoteServer(
  options: RemoteServerOptions
): Promise<RemoteServerHandle> {
  const { port, ptyManager, deps } = options

  const ticketStore = new WsTicketStore()
  const subscriberManager = new WsSubscriberManager()
  // token → expiresAt (ms). Mirrors the 8-hour cookie lifetime.
  const SESSION_TTL_MS = 8 * 60 * 60 * 1000
  const appSessions = new Map<string, number>()
  const mobileSessions = new Map<string, number>()
  let sessionCleanupTimer: ReturnType<typeof setInterval> | null = null

  function parseCookieToken(cookieHeader: string, cookieName: string): string | null {
    const match = cookieHeader
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(`${cookieName}=`))
    return match ? match.slice(`${cookieName}=`.length) : null
  }

  function hasValidAppSession(cookieHeader: string): boolean {
    const token = parseCookieToken(cookieHeader, 'app-session')
    if (!token) return false
    const expiresAt = appSessions.get(token)
    if (expiresAt === undefined) return false
    if (Date.now() > expiresAt) {
      appSessions.delete(token)
      return false
    }
    return true
  }

  function hasValidMobileSession(cookieHeader: string): boolean {
    const token = parseCookieToken(cookieHeader, 'mobile-session')
    if (!token) return false
    const expiresAt = mobileSessions.get(token)
    if (expiresAt === undefined) return false
    if (Date.now() > expiresAt) {
      mobileSessions.delete(token)
      return false
    }
    return true
  }

  // hasValidSession is the union of app + mobile sessions (used by auth middleware)
  function hasValidSession(cookieHeader: string): boolean {
    return hasValidAppSession(cookieHeader) || hasValidMobileSession(cookieHeader)
  }

  const fastify = Fastify({ logger: false })

  // Gate /app/* and /mobile/* static assets behind their respective session cookies
  fastify.addHook('onRequest', async (request, reply) => {
    const pathname = request.url.split('?')[0]
    if (pathname.startsWith('/app/') && pathname !== '/app/') {
      if (!hasValidAppSession(request.headers.cookie ?? '')) {
        return reply.status(403).send({ error: 'FORBIDDEN' })
      }
    }
    if (pathname.startsWith('/mobile/') && pathname !== '/mobile/') {
      if (!hasValidMobileSession(request.headers.cookie ?? '')) {
        return reply.status(403).send({ error: 'FORBIDDEN' })
      }
    }
  })

  await fastify.register(websocketPlugin)

  const loginStaticDir = getRemoteRendererDir()
  await fastify.register(staticPlugin, { root: loginStaticDir, prefix: '/', decorateReply: false })

  const rendererDir = getRendererDir()
  await fastify.register(staticPlugin, { root: rendererDir, prefix: '/app', decorateReply: false })
  // Mobile static assets share the same renderer-remote output directory
  await fastify.register(staticPlugin, {
    root: loginStaticDir,
    prefix: '/mobile',
    decorateReply: false,
  })

  fastify.get<{ Querystring: { t?: string } }>('/app/', async (request, reply) => {
    // Accept an existing valid session cookie (allows page refresh without re-auth)
    const hasSession = hasValidAppSession(request.headers.cookie ?? '')

    if (!hasSession) {
      const t = request.query.t ?? ''
      if (!t || !ticketStore.consumeTicket(t, 'app')) {
        return reply.redirect('/')
      }
      const sessionToken = randomBytes(32).toString('hex')
      appSessions.set(sessionToken, Date.now() + SESSION_TTL_MS)
      // 8-hour HttpOnly session cookie scoped to /app
      reply.header(
        'Set-Cookie',
        `app-session=${sessionToken}; Path=/app; HttpOnly; SameSite=Strict; Max-Age=28800`
      )
    }

    const shimTag = '<script type="module" src="/remote-shim.js"></script>'
    try {
      let html = readFileSync(join(rendererDir, 'index.html'), 'utf8')
      html = html.replace('<head>', `<head>\n    ${shimTag}`)
      return reply.type('text/html').send(html)
    } catch {
      return reply.status(503).send('Renderer not built. Run: npm run build')
    }
  })

  fastify.get<{ Querystring: { t?: string } }>('/mobile/', async (request, reply) => {
    const hasSession = hasValidMobileSession(request.headers.cookie ?? '')

    if (!hasSession) {
      const t = request.query.t ?? ''
      if (!t || !ticketStore.consumeTicket(t, 'mobile')) {
        return reply.redirect('/')
      }
      const sessionToken = randomBytes(32).toString('hex')
      mobileSessions.set(sessionToken, Date.now() + SESSION_TTL_MS)
      reply.header(
        'Set-Cookie',
        `mobile-session=${sessionToken}; Path=/mobile; HttpOnly; SameSite=Strict; Max-Age=28800`
      )
    }
    try {
      const html = readFileSync(join(loginStaticDir, 'mobile.html'), 'utf8')
      return reply.type('text/html').send(html)
    } catch {
      return reply.status(503).send('Mobile renderer not built. Run: npm run build:remote')
    }
  })

  fastify.post('/api/app-ticket', async (_request, reply) => {
    const ticket = ticketStore.createTicket('__app__', 'app')
    return reply.status(201).send({ ticket })
  })

  fastify.post('/api/mobile-ticket', async (_request, reply) => {
    const ticket = ticketStore.createTicket('__mobile__', 'mobile')
    return reply.status(201).send({ ticket })
  })

  await registerAuthMiddleware(fastify, {
    getPasswordHash: deps.getPasswordHash,
    hasValidSession,
  })

  await registerHealthRoute(fastify)
  await registerWorkspaceRoutes(fastify, {
    listWorkspaces: deps.listWorkspaces,
    listProjects: deps.listProjects,
  })
  const terminalCleanup = await registerTerminalRoutes(fastify, {
    ptyManager,
    ticketStore,
    subscriberManager,
    getMaxSubscribers: deps.getMaxSubscribers,
  })
  const bridgeCleanup = await registerBridgeRoute(fastify, {
    ticketStore,
    invokeChannel: deps.invokeChannel,
    sendChannel: deps.sendChannel,
    onWindowEvent: deps.onWindowEvent,
  })

  let listening = false

  return {
    async start() {
      try {
        await fastify.listen({ port, host: '0.0.0.0' })
        ticketStore.startCleanup()
        // Purge expired app-session tokens once per hour
        sessionCleanupTimer = setInterval(
          () => {
            const now = Date.now()
            for (const [token, expiresAt] of appSessions) {
              if (now > expiresAt) appSessions.delete(token)
            }
            for (const [token, expiresAt] of mobileSessions) {
              if (now > expiresAt) mobileSessions.delete(token)
            }
          },
          60 * 60 * 1000
        )
        listening = true
      } catch (err) {
        await fastify.close().catch(() => {})
        const code = (err as NodeJS.ErrnoException).code
        if (code === 'EADDRINUSE') {
          deps.onPortInUse(port)
          throw new PortInUseError(port)
        }
        throw err
      }
    },

    async stop() {
      if (!listening) return
      ticketStore.stopCleanup()
      if (sessionCleanupTimer) {
        clearInterval(sessionCleanupTimer)
        sessionCleanupTimer = null
      }
      appSessions.clear()
      mobileSessions.clear()
      terminalCleanup.cleanup()
      bridgeCleanup.disconnectAll()
      subscriberManager.destroyAll()
      await fastify.close()
      listening = false
    },

    disconnectAllClients() {
      appSessions.clear()
      mobileSessions.clear()
      // Kill all remote PTYs — password rotation invalidates existing sessions
      terminalCleanup.cleanup()
      bridgeCleanup.disconnectAll()
      subscriberManager.destroyAll()
    },

    isListening() {
      return listening
    },

    inject: fastify.inject.bind(fastify),
  }
}
