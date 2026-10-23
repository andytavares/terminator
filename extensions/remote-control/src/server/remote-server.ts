import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import websocketPlugin from '@fastify/websocket'
import staticPlugin from '@fastify/static'
import { join, resolve, dirname } from 'path'
import { readFileSync, existsSync, readdirSync } from 'fs'
import type { PtyManagerAPI, WorkspaceSnapshot, ProjectSnapshot } from '@terminator/extension-sdk'
import { registerHealthRoute } from './routes/health.route.js'
import { registerTerminalRoutes } from './routes/terminal.routes.js'
import { registerWorkspaceRoutes } from './routes/workspace.routes.js'
import { registerAuthMiddleware } from './auth.middleware.js'
import { registerLoginRoute } from './routes/login.route.js'
import { AuthRateLimiter } from './auth-rate-limiter.js'
import { registerBridgeRoute } from './routes/bridge.route.js'
import { WsTicketStore } from './ws-ticket-store.js'
import { SessionStore } from './session-store.js'
import { WsSubscriberManager } from './ws-subscriber-manager.js'
import { ConnectedDeviceRegistry } from './connected-devices.js'
import { EXTENSION_BASE_CSS } from '@terminator/extension-ui/extension-base-css'
import { PortInUseError } from './port-in-use-error.js'

interface RemoteServerDeps {
  getPasswordHash: () => string
  getMaxSubscribers: () => number
  listWorkspaces: () => WorkspaceSnapshot[]
  listProjects: (workspaceId: string) => ProjectSnapshot[]
  invokeChannel: (channel: string, payload: unknown) => Promise<unknown>
  sendChannel: (channel: string, payload: unknown) => void
  onWindowEvent: (channel: string, handler: (...args: unknown[]) => void) => () => void
  isRemoteAccessible: (channel: string) => Promise<boolean>
  onPortInUse: (port: number) => void
}

interface RemoteServerOptions {
  port: number
  /** `api.paths.app`: where the built renderers and extensions are found. */
  appPath: string
  ptyManager: PtyManagerAPI
  deps: RemoteServerDeps
}

export interface RemoteServerHandle {
  start(): Promise<void>
  stop(): Promise<void>
  isListening(): boolean
  /** Settles once the remote terminals are killed. */
  disconnectAllClients(): Promise<void>
  /** Who is connected, and a subscription to changes, for the view. */
  devices: ConnectedDeviceRegistry
  inject: FastifyInstance['inject']
}

interface ExtensionRendererDir {
  id: string
  dir: string
  rendererRelPath: string
}

/** The session store of each browser surface. */
interface SurfaceSessions {
  app: SessionStore
  mobile: SessionStore
  /** Issued by POST /api/login; it authorises every /api request after the password check. */
  login: SessionStore
}

/** What the server is built from, shared by the steps that build it. */
interface RemoteServerParts {
  fastify: FastifyInstance
  options: RemoteServerOptions
  sessions: SurfaceSessions
  ticketStore: WsTicketStore
  subscriberManager: WsSubscriberManager
  deviceRegistry: ConnectedDeviceRegistry
}

/** What `stop` and `disconnectAllClients` tear down besides the session stores. */
interface ServerConnections {
  terminalCleanup: { cleanup: () => Promise<void> }
  bridgeCleanup: { disconnectAll: () => void }
}

// One session store per browser surface; 8-hour cookie lifetime.
const SESSION_TTL_MS = 8 * 60 * 60 * 1000
const SHIM_TAG = '<script type="module" src="/remote-shim.js"></script>'

function getRemoteRendererDir(appPath: string): string {
  const candidates = [
    join(appPath, 'out', 'renderer-remote'),
    resolve(__dirname, '..', '..', '..', '..', 'out', 'renderer-remote'),
  ]
  return candidates.find(existsSync) ?? candidates[0]
}

function getRendererDir(appPath: string): string {
  const candidates = [
    join(appPath, 'out', 'renderer'),
    resolve(__dirname, '..', '..', '..', '..', 'out', 'renderer'),
  ]
  return candidates.find(existsSync) ?? candidates[0]
}

function getExtensionRendererDirs(appPath: string): ExtensionRendererDir[] {
  const candidates = [
    join(appPath, 'extensions'),
    resolve(__dirname, '..', '..', '..', '..', 'extensions'),
  ]
  const extensionsRoot = candidates.find(existsSync)
  if (!extensionsRoot) return []

  let entries: string[]
  try {
    entries = readdirSync(extensionsRoot)
  } catch {
    return []
  }
  return entries.flatMap((name) => readExtensionRendererDir(join(extensionsRoot, name)))
}

/** The renderer an installed extension declares, or none when it declares none. */
function readExtensionRendererDir(extensionDir: string): ExtensionRendererDir[] {
  const manifestPath = join(extensionDir, 'manifest.json')
  if (!existsSync(manifestPath)) return []
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      id?: string
      renderer?: string
    }
    if (!manifest.id || !manifest.renderer) return []
    const rendererDir = join(extensionDir, dirname(manifest.renderer))
    if (!existsSync(rendererDir)) return []
    return [{ id: manifest.id, dir: rendererDir, rendererRelPath: manifest.renderer }]
  } catch {
    // skip malformed manifests
    return []
  }
}

function createSurfaceSessions(): SurfaceSessions {
  const surfaceStore = (cookieName: string, cookiePath: string) =>
    new SessionStore({ cookieName, cookiePath, ttlMs: SESSION_TTL_MS })
  return {
    app: surfaceStore('app-session', '/app'),
    mobile: surfaceStore('mobile-session', '/mobile'),
    login: surfaceStore('remote-session', '/'),
  }
}

function forEachSessionStore(sessions: SurfaceSessions, act: (store: SessionStore) => void) {
  act(sessions.app)
  act(sessions.mobile)
  act(sessions.login)
}

/** True when a gated surface's asset is requested without that surface's session. */
function lacksSurfaceSession(request: FastifyRequest, surface: string, store: SessionStore) {
  const pathname = request.url.split('?')[0]
  const prefix = `/${surface}/`
  if (!pathname.startsWith(prefix) || pathname === prefix) return false
  return !store.hasLiveSession(request.headers.cookie ?? '')
}

// Gate /app/* and /mobile/* static assets behind their respective session cookies.
// /ext/* serves extension static assets (JS/HTML/CSS) without a cookie gate: the
// extension bundle has no user data; auth happens via the bridge WebSocket.
function gateSurfaceAssets(fastify: FastifyInstance, sessions: SurfaceSessions): void {
  fastify.addHook('onRequest', async (request, reply) => {
    if (
      lacksSurfaceSession(request, 'app', sessions.app) ||
      lacksSurfaceSession(request, 'mobile', sessions.mobile)
    ) {
      return reply.status(403).send({ error: 'FORBIDDEN' })
    }
  })
}

// Serve each installed extension's renderer under /ext/<extensionId>/
async function registerExtensionRenderers(fastify: FastifyInstance, appPath: string) {
  for (const { id, dir } of getExtensionRendererDirs(appPath)) {
    await fastify.register(staticPlugin, { root: dir, prefix: `/ext/${id}`, decorateReply: false })
    // Serve index.html with the shim + base CSS injected (provides --tm-* variables and #app height)
    fastify.get(`/ext/${id}/`, async (_request, reply) => {
      const styleTag = `<style>${EXTENSION_BASE_CSS}</style>`
      try {
        let html = readFileSync(join(dir, 'index.html'), 'utf8')
        html = html.replace(/<head[^>]*>/i, (m) => `${m}\n    ${SHIM_TAG}\n    ${styleTag}`)
        return reply.type('text/html').send(html)
      } catch {
        return reply.status(503).send(`Extension renderer not built for ${id}`)
      }
    })
  }
}

/** A request for a surface's entry page, and its reply. */
interface SurfaceExchange {
  request: FastifyRequest<{ Querystring: { t?: string } }>
  reply: FastifyReply
}

/** A valid session cookie is accepted, so a refresh needs no new login; otherwise a one-use
 *  ticket issues one. False when the request has neither. */
function admitToSurface(
  parts: RemoteServerParts,
  surface: 'app' | 'mobile',
  exchange: SurfaceExchange
): boolean {
  const { request, reply } = exchange
  const store = parts.sessions[surface]
  if (store.hasLiveSession(request.headers.cookie ?? '')) return true
  const t = request.query.t ?? ''
  if (!t || !parts.ticketStore.consumeTicket(t, surface)) return false
  reply.header('Set-Cookie', store.issueSession().setCookie)
  return true
}

async function sendAppPage(
  parts: RemoteServerParts,
  rendererDir: string,
  exchange: SurfaceExchange
) {
  const { reply } = exchange
  if (!admitToSurface(parts, 'app', exchange)) return reply.redirect('/')
  try {
    let html = readFileSync(join(rendererDir, 'index.html'), 'utf8')
    html = html.replace(/<head[^>]*>/i, (m) => `${m}\n    ${SHIM_TAG}`)
    return reply.type('text/html').send(html)
  } catch {
    return reply.status(503).send('Renderer not built. Run: npm run build')
  }
}

async function sendMobilePage(
  parts: RemoteServerParts,
  loginStaticDir: string,
  exchange: SurfaceExchange
) {
  const { reply } = exchange
  if (!admitToSurface(parts, 'mobile', exchange)) return reply.redirect('/')
  try {
    const html = readFileSync(join(loginStaticDir, 'mobile.html'), 'utf8')
    return reply.type('text/html').send(html)
  } catch {
    return reply.status(503).send('Mobile renderer not built. Run: npm run build:remote')
  }
}

async function registerSurfaces(parts: RemoteServerParts): Promise<void> {
  const { fastify, options } = parts
  const loginStaticDir = getRemoteRendererDir(options.appPath)
  await fastify.register(staticPlugin, { root: loginStaticDir, prefix: '/', decorateReply: false })

  const rendererDir = getRendererDir(options.appPath)
  await fastify.register(staticPlugin, { root: rendererDir, prefix: '/app', decorateReply: false })

  await registerExtensionRenderers(fastify, options.appPath)

  // Mobile static assets share the same renderer-remote output directory
  const mobileStatic = { root: loginStaticDir, prefix: '/mobile', decorateReply: false }
  await fastify.register(staticPlugin, mobileStatic)

  fastify.get<{ Querystring: { t?: string } }>('/app/', async (request, reply) =>
    sendAppPage(parts, rendererDir, { request, reply })
  )
  fastify.get<{ Querystring: { t?: string } }>('/mobile/', async (request, reply) =>
    sendMobilePage(parts, loginStaticDir, { request, reply })
  )
}

function registerSurfaceTickets(fastify: FastifyInstance, ticketStore: WsTicketStore): void {
  fastify.post('/api/app-ticket', async (_request, reply) => {
    const ticket = ticketStore.createTicket('__app__', 'app')
    return reply.status(201).send({ ticket })
  })

  fastify.post('/api/mobile-ticket', async (_request, reply) => {
    const ticket = ticketStore.createTicket('__mobile__', 'mobile')
    return reply.status(201).send({ ticket })
  })
}

async function registerLogin(parts: RemoteServerParts): Promise<void> {
  const { fastify, sessions } = parts
  await registerAuthMiddleware(fastify, {
    hasValidSession: (cookieHeader) => sessions.login.hasLiveSession(cookieHeader),
  })
  await registerLoginRoute(fastify, {
    getPasswordHash: parts.options.deps.getPasswordHash,
    sessionStore: sessions.login,
    rateLimiter: new AuthRateLimiter(),
  })
}

async function registerApi(parts: RemoteServerParts): Promise<ServerConnections> {
  const { fastify, options, ticketStore } = parts
  const { deps } = options
  await registerHealthRoute(fastify)
  await registerWorkspaceRoutes(fastify, {
    listWorkspaces: deps.listWorkspaces,
    listProjects: deps.listProjects,
  })
  const terminalCleanup = await registerTerminalRoutes(fastify, {
    ptyManager: options.ptyManager,
    ticketStore,
    subscriberManager: parts.subscriberManager,
    deviceRegistry: parts.deviceRegistry,
    getMaxSubscribers: deps.getMaxSubscribers,
  })
  const bridgeCleanup = await registerBridgeRoute(fastify, {
    ticketStore,
    invokeChannel: deps.invokeChannel,
    sendChannel: deps.sendChannel,
    onWindowEvent: deps.onWindowEvent,
    isRemoteAccessible: deps.isRemoteAccessible,
  })
  return { terminalCleanup, bridgeCleanup }
}

export async function createRemoteServer(
  options: RemoteServerOptions
): Promise<RemoteServerHandle> {
  const parts: RemoteServerParts = {
    fastify: Fastify({ logger: false }),
    options,
    sessions: createSurfaceSessions(),
    ticketStore: new WsTicketStore(),
    subscriberManager: new WsSubscriberManager(),
    // Who is watching, so the Remote Control view can say so and disconnect one.
    deviceRegistry: new ConnectedDeviceRegistry(),
  }
  gateSurfaceAssets(parts.fastify, parts.sessions)
  await parts.fastify.register(websocketPlugin)
  await registerSurfaces(parts)
  registerSurfaceTickets(parts.fastify, parts.ticketStore)
  await registerLogin(parts)
  const connections = await registerApi(parts)
  return new RemoteServer(parts, connections).toHandle()
}

/** The running state of a built server: whether it listens, and its sweep timer. */
class RemoteServer {
  private listening = false
  private sessionCleanupTimer: ReturnType<typeof setInterval> | null = null

  constructor(
    private parts: RemoteServerParts,
    private connections: ServerConnections
  ) {}

  toHandle(): RemoteServerHandle {
    const { fastify, deviceRegistry } = this.parts
    return {
      start: () => this.start(),
      stop: () => this.stop(),
      disconnectAllClients: () => this.disconnectAllClients(),
      isListening: () => this.listening,
      /** The live device list, and a subscription to changes. */
      devices: deviceRegistry,
      inject: fastify.inject.bind(fastify),
    }
  }

  private async start(): Promise<void> {
    const { fastify, options, ticketStore, sessions } = this.parts
    try {
      await fastify.listen({ port: options.port, host: '0.0.0.0' })
      ticketStore.startCleanup()
      // Purge expired session tokens once per hour
      this.sessionCleanupTimer = setInterval(
        () => forEachSessionStore(sessions, (store) => store.sweep()),
        60 * 60 * 1000
      )
      this.listening = true
    } catch (err) {
      await fastify.close().catch(() => {})
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'EADDRINUSE') {
        options.deps.onPortInUse(options.port)
        throw new PortInUseError(options.port)
      }
      throw err
    }
  }

  private async stop(): Promise<void> {
    if (!this.listening) return
    this.parts.ticketStore.stopCleanup()
    if (this.sessionCleanupTimer) {
      clearInterval(this.sessionCleanupTimer)
      this.sessionCleanupTimer = null
    }
    forEachSessionStore(this.parts.sessions, (store) => store.revokeAll())
    await this.connections.terminalCleanup.cleanup()
    this.connections.bridgeCleanup.disconnectAll()
    this.parts.subscriberManager.destroyAll()
    await this.parts.fastify.close()
    this.listening = false
  }

  private async disconnectAllClients(): Promise<void> {
    forEachSessionStore(this.parts.sessions, (store) => store.revokeAll())
    // Kill all remote PTYs — password rotation invalidates existing sessions
    const terminalsKilled = this.connections.terminalCleanup.cleanup()
    this.connections.bridgeCleanup.disconnectAll()
    this.parts.subscriberManager.destroyAll()
    await terminalsKilled
  }
}
