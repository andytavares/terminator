import Fastify, { type FastifyInstance } from 'fastify'
import websocketPlugin from '@fastify/websocket'
import staticPlugin from '@fastify/static'
import { join } from 'path'
import { readFileSync } from 'fs'
import type { BrowserWindow } from 'electron'
import type { PtyManager } from '../terminal/pty-manager'
import { registerHealthRoute } from './routes/health.route'
import { registerTerminalRoutes } from './routes/terminal.routes'
import { registerWorkspaceRoutes } from './routes/workspace.routes'
import { registerAuthMiddleware } from './auth.middleware'
import { registerBridgeRoute } from './routes/bridge.route'
import { WsTicketStore } from './ws-ticket-store'
import { WsSubscriberManager } from './ws-subscriber-manager'

export interface RemoteServerDeps {
  getGlobalSettings: () => { remoteControl: { passwordHash: string } }
  updateGlobalSettings: (patch: unknown) => void
}

export interface RemoteServerOptions {
  port: number
  ptyManager: PtyManager
  deps: RemoteServerDeps
  getWindow: () => BrowserWindow | null
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

export async function createRemoteServer(
  options: RemoteServerOptions
): Promise<RemoteServerHandle> {
  const { port, ptyManager, deps, getWindow } = options

  const ticketStore = new WsTicketStore()
  const subscriberManager = new WsSubscriberManager()

  const app = Fastify({ logger: false })

  await app.register(websocketPlugin)

  // Login page + shim assets served at /
  const loginStaticDir = join(__dirname, '../renderer-remote')
  await app.register(staticPlugin, { root: loginStaticDir, prefix: '/', decorateReply: false })

  // Full renderer served at /app/ — this is the actual Terminator UI
  const rendererDir = join(__dirname, '../renderer')
  await app.register(staticPlugin, { root: rendererDir, prefix: '/app', decorateReply: false })

  // Intercept /app/ and /app/index.html to inject the shim before the renderer bundle
  app.get('/app/', async (_request, reply) => {
    const shimTag = '<script type="module" src="/remote-shim.js"></script>'
    try {
      let html = readFileSync(join(rendererDir, 'index.html'), 'utf8')
      html = html.replace('<head>', `<head>\n    ${shimTag}`)
      return reply.type('text/html').send(html)
    } catch {
      return reply.status(503).send('Renderer not built. Run: npm run build')
    }
  })

  await registerAuthMiddleware(app, {
    getPasswordHash: () => deps.getGlobalSettings().remoteControl.passwordHash,
    ngrokDomain: options.ngrokDomain,
  })

  await registerHealthRoute(app)
  await registerWorkspaceRoutes(app)
  await registerTerminalRoutes(app, { ptyManager, ticketStore, subscriberManager })
  await registerBridgeRoute(app, {
    getPasswordHash: () => deps.getGlobalSettings().remoteControl.passwordHash,
  })

  let listening = false

  return {
    async start() {
      try {
        await app.listen({ port, host: '127.0.0.1' })
        ticketStore.startCleanup()
        listening = true
      } catch (err) {
        // Clean up the allocated Fastify instance so retries don't stack orphaned servers
        await app.close().catch(() => {})
        const code = (err as NodeJS.ErrnoException).code
        if (code === 'EADDRINUSE') {
          const portErr = new PortInUseError(port)
          getWindow()?.webContents.send('remote:status', {
            error: 'PORT_IN_USE',
            message: portErr.message,
          })
          throw portErr
        }
        throw err
      }
    },

    async stop() {
      if (!listening) return
      ticketStore.stopCleanup()
      subscriberManager.destroyAll()
      await app.close()
      listening = false
    },

    disconnectAllClients() {
      subscriberManager.destroyAll()
    },

    isListening() {
      return listening
    },

    inject: app.inject.bind(app),
  }
}
