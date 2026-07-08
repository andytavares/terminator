import Fastify, { type FastifyInstance } from 'fastify'
import websocketPlugin from '@fastify/websocket'
import staticPlugin from '@fastify/static'
import { join, resolve, dirname } from 'path'
import { readFileSync, existsSync, readdirSync } from 'fs'
import { app as electronApp } from 'electron'
import type { PtyManagerAPI, WorkspaceSnapshot, ProjectSnapshot } from '../types.js'
import { registerHealthRoute } from './routes/health.route.js'
import { registerTerminalRoutes } from './routes/terminal.routes.js'
import { registerWorkspaceRoutes } from './routes/workspace.routes.js'
import { registerAuthMiddleware } from './auth.middleware.js'
import { registerBridgeRoute } from './routes/bridge.route.js'
import { WsTicketStore } from './ws-ticket-store.js'
import { SessionStore } from './session-store.js'
import { WsSubscriberManager } from './ws-subscriber-manager.js'

// CSS injected into every extension iframe so --tm-* variables and layout are defined.
// Mirrors the EXTENSION_BASE_CSS in src/main/extensions/extension-view-host.ts —
// keep in sync if the design tokens change.
const EXTENSION_BASE_CSS = `
:root {
  --tm-bg-base: #0c0c0f;
  --tm-bg-surface: #111116;
  --tm-bg-elevated: #18181f;
  --tm-bg-card: #1c1c25;
  --tm-bg-card-hover: #22222e;
  --tm-bg-input: #16161c;
  --tm-text-primary: #e2e2ee;
  --tm-text-secondary: #9090c4;
  --tm-text-muted: #8585b8;
  --tm-border: rgba(255,255,255,0.06);
  --tm-border-strong: rgba(255,255,255,0.12);
  --tm-accent: #5c6bc0;
  --tm-accent-dim: rgba(92,107,192,0.18);
  --tm-accent-glow: rgba(92,107,192,0.35);
  --tm-danger: #e05c5c;
  --tm-success: #4ade80;
  --tm-warning: #facc15;
  --tm-diff-added-bg: rgba(152,195,121,0.12);
  --tm-diff-removed-bg: rgba(224,108,117,0.12);
  --tm-syntax-comment: #8585b8;
  --tm-syntax-keyword: #cf9ee8;
  --tm-syntax-string: #4ade80;
  --tm-syntax-tag: #e05c5c;
  --tm-syntax-literal: #6cc9d9;
  --tm-syntax-number: #e0a361;
  --tm-syntax-title: #7fb8f0;
  --tm-syntax-attribute: #e2c07e;
  --tm-radius-xs: 4px;
  --tm-radius-sm: 6px;
  --tm-radius-md: 10px;
  --tm-radius-lg: 16px;
  --tm-font-mono: 'IBM Plex Mono','JetBrains Mono','Fira Code','Courier New',monospace;
  --tm-font-ui: 'IBM Plex Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
}
*, *::before, *::after { box-sizing: border-box; }
html, body {
  width: 100%; height: 100%; margin: 0; padding: 0;
  background: var(--tm-bg-base);
  color: var(--tm-text-primary);
  font-family: var(--tm-font-ui);
  -webkit-font-smoothing: antialiased;
}
#app { width: 100%; height: 100%; display: flex; flex-direction: column; }
`

export interface RemoteServerDeps {
  getPasswordHash: () => string
  getMaxSubscribers: () => number
  listWorkspaces: () => WorkspaceSnapshot[]
  listProjects: (workspaceId: string) => ProjectSnapshot[]
  invokeChannel: (channel: string, payload: unknown) => Promise<unknown>
  sendChannel: (channel: string, payload: unknown) => void
  onWindowEvent: (channel: string, handler: (...args: unknown[]) => void) => () => void
  isRemoteAccessible: (channel: string) => boolean
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

function getExtensionRendererDirs(): Array<{ id: string; dir: string; rendererRelPath: string }> {
  const results: Array<{ id: string; dir: string; rendererRelPath: string }> = []
  const candidates = [
    join(electronApp.getAppPath(), 'extensions'),
    resolve(__dirname, '..', '..', '..', '..', 'extensions'),
  ]
  const extensionsRoot = candidates.find(existsSync)
  if (!extensionsRoot) return results

  let entries: string[]
  try {
    entries = readdirSync(extensionsRoot)
  } catch {
    return results
  }

  for (const name of entries) {
    const manifestPath = join(extensionsRoot, name, 'manifest.json')
    if (!existsSync(manifestPath)) continue
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        id?: string
        renderer?: string
      }
      if (!manifest.id || !manifest.renderer) continue
      const rendererDir = join(extensionsRoot, name, dirname(manifest.renderer))
      if (existsSync(rendererDir)) {
        results.push({ id: manifest.id, dir: rendererDir, rendererRelPath: manifest.renderer })
      }
    } catch {
      // skip malformed manifests
    }
  }
  return results
}

export async function createRemoteServer(
  options: RemoteServerOptions
): Promise<RemoteServerHandle> {
  const { port, ptyManager, deps } = options

  const ticketStore = new WsTicketStore()
  const subscriberManager = new WsSubscriberManager()
  // One session store per browser surface; 8-hour cookie lifetime.
  const SESSION_TTL_MS = 8 * 60 * 60 * 1000
  const appSessionStore = new SessionStore({
    cookieName: 'app-session',
    cookiePath: '/app',
    ttlMs: SESSION_TTL_MS,
  })
  const mobileSessionStore = new SessionStore({
    cookieName: 'mobile-session',
    cookiePath: '/mobile',
    ttlMs: SESSION_TTL_MS,
  })
  let sessionCleanupTimer: ReturnType<typeof setInterval> | null = null

  // hasValidSession is the union of app + mobile sessions (used by auth middleware)
  function hasValidSession(cookieHeader: string): boolean {
    return (
      appSessionStore.hasValidSession(cookieHeader) ||
      mobileSessionStore.hasValidSession(cookieHeader)
    )
  }

  const fastify = Fastify({ logger: false })

  // Gate /app/* and /mobile/* static assets behind their respective session cookies
  fastify.addHook('onRequest', async (request, reply) => {
    const pathname = request.url.split('?')[0]
    if (pathname.startsWith('/app/') && pathname !== '/app/') {
      if (!appSessionStore.hasValidSession(request.headers.cookie ?? '')) {
        return reply.status(403).send({ error: 'FORBIDDEN' })
      }
    }
    if (pathname.startsWith('/mobile/') && pathname !== '/mobile/') {
      if (!mobileSessionStore.hasValidSession(request.headers.cookie ?? '')) {
        return reply.status(403).send({ error: 'FORBIDDEN' })
      }
    }
    // /ext/* serves extension static assets (JS/HTML/CSS). No cookie gate here —
    // the extension bundle has no user data; auth happens via the bridge WebSocket.
  })

  await fastify.register(websocketPlugin)

  const loginStaticDir = getRemoteRendererDir()
  await fastify.register(staticPlugin, { root: loginStaticDir, prefix: '/', decorateReply: false })

  const rendererDir = getRendererDir()
  await fastify.register(staticPlugin, { root: rendererDir, prefix: '/app', decorateReply: false })

  // Serve each installed extension's renderer under /ext/<extensionId>/
  const extensionDirs = getExtensionRendererDirs()
  for (const { id, dir } of extensionDirs) {
    await fastify.register(staticPlugin, {
      root: dir,
      prefix: `/ext/${id}`,
      decorateReply: false,
    })
    // Serve index.html with the shim + base CSS injected (provides --tm-* variables and #app height)
    fastify.get(`/ext/${id}/`, async (_request, reply) => {
      const shimTag = '<script type="module" src="/remote-shim.js"></script>'
      const styleTag = `<style>${EXTENSION_BASE_CSS}</style>`
      try {
        let html = readFileSync(join(dir, 'index.html'), 'utf8')
        html = html.replace(/<head[^>]*>/i, (m) => `${m}\n    ${shimTag}\n    ${styleTag}`)
        return reply.type('text/html').send(html)
      } catch {
        return reply.status(503).send(`Extension renderer not built for ${id}`)
      }
    })
  }

  // Mobile static assets share the same renderer-remote output directory
  await fastify.register(staticPlugin, {
    root: loginStaticDir,
    prefix: '/mobile',
    decorateReply: false,
  })

  fastify.get<{ Querystring: { t?: string } }>('/app/', async (request, reply) => {
    // Accept an existing valid session cookie (allows page refresh without re-auth)
    const hasSession = appSessionStore.hasValidSession(request.headers.cookie ?? '')

    if (!hasSession) {
      const t = request.query.t ?? ''
      if (!t || !ticketStore.consumeTicket(t, 'app')) {
        return reply.redirect('/')
      }
      reply.header('Set-Cookie', appSessionStore.issueSession().setCookie)
    }

    const shimTag = '<script type="module" src="/remote-shim.js"></script>'
    try {
      let html = readFileSync(join(rendererDir, 'index.html'), 'utf8')
      html = html.replace(/<head[^>]*>/i, (m) => `${m}\n    ${shimTag}`)
      return reply.type('text/html').send(html)
    } catch {
      return reply.status(503).send('Renderer not built. Run: npm run build')
    }
  })

  fastify.get<{ Querystring: { t?: string } }>('/mobile/', async (request, reply) => {
    const hasSession = mobileSessionStore.hasValidSession(request.headers.cookie ?? '')

    if (!hasSession) {
      const t = request.query.t ?? ''
      if (!t || !ticketStore.consumeTicket(t, 'mobile')) {
        return reply.redirect('/')
      }
      reply.header('Set-Cookie', mobileSessionStore.issueSession().setCookie)
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
    isRemoteAccessible: deps.isRemoteAccessible,
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
            appSessionStore.sweep()
            mobileSessionStore.sweep()
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
      appSessionStore.clear()
      mobileSessionStore.clear()
      terminalCleanup.cleanup()
      bridgeCleanup.disconnectAll()
      subscriberManager.destroyAll()
      await fastify.close()
      listening = false
    },

    disconnectAllClients() {
      appSessionStore.clear()
      mobileSessionStore.clear()
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
