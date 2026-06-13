import Fastify, { type FastifyInstance } from 'fastify'
import websocketPlugin from '@fastify/websocket'
import staticPlugin from '@fastify/static'
import { join, resolve } from 'path'
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
  ngrokDomain?: string
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

  const fastify = Fastify({ logger: false })

  await fastify.register(websocketPlugin)

  const loginStaticDir = getRemoteRendererDir()
  await fastify.register(staticPlugin, { root: loginStaticDir, prefix: '/', decorateReply: false })

  const rendererDir = getRendererDir()
  await fastify.register(staticPlugin, { root: rendererDir, prefix: '/app', decorateReply: false })

  fastify.get<{ Querystring: { t?: string } }>('/app/', async (request, reply) => {
    const t = request.query.t ?? ''
    if (!t || !ticketStore.consumeTicket(t, 'app')) {
      return reply.redirect('/')
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

  fastify.post('/api/app-ticket', async (_request, reply) => {
    const ticket = ticketStore.createTicket('__app__', 'app')
    return reply.status(201).send({ ticket })
  })

  await registerAuthMiddleware(fastify, {
    getPasswordHash: deps.getPasswordHash,
    ngrokDomain: options.ngrokDomain,
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
        await fastify.listen({ port, host: '127.0.0.1' })
        ticketStore.startCleanup()
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
      terminalCleanup.cleanup()
      bridgeCleanup.disconnectAll()
      subscriberManager.destroyAll()
      await fastify.close()
      listening = false
    },

    disconnectAllClients() {
      bridgeCleanup.disconnectAll()
      subscriberManager.destroyAll()
    },

    isListening() {
      return listening
    },

    inject: fastify.inject.bind(fastify),
  }
}
