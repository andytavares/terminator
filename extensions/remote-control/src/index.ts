import { networkInterfaces } from 'os'
import { randomBytes } from 'crypto'
import bcryptjs from 'bcryptjs'
import type { ExtensionAPI } from '../../../src/main/extensions/api.js'
import {
  createRemoteServer,
  PortInUseError,
  type RemoteServerHandle,
} from './server/remote-server.js'
import { NgrokManager, generateCaddyfile } from './server/ngrok-manager.js'

const EXT = 'terminator.remote-control'
const KEY = {
  enabled: `${EXT}.enabled`,
  port: `${EXT}.port`,
  password: `${EXT}.password`,
  passwordHash: `${EXT}.passwordHash`,
  maxSubscribers: `${EXT}.maxSubscribers`,
  ngrokAuthToken: `${EXT}.ngrokAuthToken`,
}

function getLanUrl(port: number): string {
  const ifaces = networkInterfaces()
  for (const iface of Object.values(ifaces)) {
    for (const addr of iface ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) return `http://${addr.address}:${port}`
    }
  }
  return `http://localhost:${port}`
}

let remoteServer: RemoteServerHandle | null = null
const ngrokManager = new NgrokManager()
let queue: Promise<void> = Promise.resolve()

export function activate(api: ExtensionAPI): void {
  api.settings.register({
    label: 'Remote Control',
    properties: {
      [KEY.enabled]: { type: 'boolean', label: 'Enable Remote Control', default: false },
      [KEY.port]: { type: 'number', label: 'Port', default: 7681, min: 1024, max: 65535 },
      [KEY.password]: { type: 'string', label: 'Password', default: '', secret: true },
      [KEY.passwordHash]: {
        type: 'string',
        label: 'Password Hash (internal)',
        default: '',
        secret: true,
      },
      [KEY.maxSubscribers]: {
        type: 'number',
        label: 'Max Concurrent Viewers',
        default: 5,
        min: 1,
        max: 20,
      },
      [KEY.ngrokAuthToken]: {
        type: 'string',
        label: 'ngrok Auth Token',
        default: '',
        secret: true,
      },
    },
  })

  function getPort(): number {
    return api.settings.get<number>(KEY.port) ?? 7681
  }
  function getPasswordHash(): string {
    return api.settings.get<string>(KEY.passwordHash) ?? ''
  }
  function getMaxSubscribers(): number {
    return api.settings.get<number>(KEY.maxSubscribers) ?? 5
  }

  async function ensurePassword(): Promise<void> {
    const existing = api.settings.get<string>(KEY.password) ?? ''
    const existingHash = getPasswordHash()
    if (existingHash) return
    const pw = existing || randomBytes(16).toString('base64url')
    const hash = await bcryptjs.hash(pw, 10)
    api.settings.set(KEY.password, pw)
    api.settings.set(KEY.passwordHash, hash)
  }

  async function startServer(): Promise<void> {
    if (remoteServer) await stopServer()
    await ensurePassword()
    const port = getPort()
    try {
      remoteServer = await createRemoteServer({
        port,
        ptyManager: api.pty,
        deps: {
          getPasswordHash,
          getMaxSubscribers,
          listWorkspaces: () => api.workspace.list(),
          listProjects: (id) => api.workspace.listProjects(id),
          invokeChannel: (ch, payload) => api.ipc.invokeChannel(ch, payload),
          sendChannel: (ch, payload) => api.ipc.sendChannel(ch, payload),
          onWindowEvent: (ch, handler) => api.ipc.onWindowEvent(ch, handler),
          onPortInUse: (p) =>
            api.window.broadcast('remote:status', {
              error: 'PORT_IN_USE',
              message: `Port ${p} already in use.`,
            }),
        },
      })
      await remoteServer.start()
      api.window.broadcast('remote:status', {
        enabled: true,
        port,
        lanUrl: getLanUrl(port),
        publicUrl: null,
      })

      if (NgrokManager.isInstalled()) {
        const authToken = api.settings.get<string>(KEY.ngrokAuthToken) || undefined
        try {
          const publicUrl = await ngrokManager.start(port, authToken)
          ngrokManager.setOnCrash(() => {
            api.window.broadcast('remote:tunnel-disconnected', {})
            api.window.broadcast('remote:status', {
              enabled: true,
              port,
              publicUrl: null,
              lanUrl: getLanUrl(port),
            })
          })
          api.window.broadcast('remote:status', {
            enabled: true,
            port,
            publicUrl,
            lanUrl: getLanUrl(port),
            ngrokInstalled: true,
            ngrokError: null,
          })
        } catch (err) {
          const needsAuth = !authToken
          api.window.broadcast('remote:status', {
            enabled: true,
            port,
            publicUrl: null,
            lanUrl: getLanUrl(port),
            ngrokInstalled: true,
            ngrokError: needsAuth
              ? 'ngrok requires an auth token — add yours in Settings'
              : String(err),
          })
        }
      } else {
        api.window.broadcast('remote:status', {
          enabled: true,
          port,
          publicUrl: null,
          lanUrl: getLanUrl(port),
          ngrokInstalled: false,
        })
      }
    } catch (err) {
      remoteServer = null
      if (err instanceof PortInUseError) return
      api.settings.set(KEY.enabled, false)
      api.window.broadcast('remote:status', { enabled: false, error: 'START_FAILED' })
    }
  }

  async function stopServer(): Promise<void> {
    ngrokManager.stop()
    if (remoteServer) {
      await remoteServer.stop()
      remoteServer = null
    }
    api.window.broadcast('remote:status', { enabled: false })
  }

  function enqueue(fn: () => Promise<void>): void {
    queue = queue.then(fn).catch(() => {})
  }

  // Register IPC handlers
  api.ipc.registerHandler('remote:toggle', async (payload) => {
    const { enabled } = payload as { enabled: boolean }
    api.settings.set(KEY.enabled, enabled)
    enqueue(enabled ? startServer : stopServer)
    return { ok: true }
  })

  api.ipc.registerHandler('remote:port-change', async (payload) => {
    const { port } = payload as { port: number }
    if (port < 1024 || port > 65535) return { error: 'INVALID_PORT' }
    api.settings.set(KEY.port, port)
    if (api.settings.get<boolean>(KEY.enabled)) enqueue(startServer)
    return { ok: true }
  })

  api.ipc.registerHandler('remote:update-password', async (payload) => {
    const { password } = payload as { password: string }
    const actual = password || randomBytes(16).toString('base64url')
    const hash = await bcryptjs.hash(actual, 10)
    api.settings.set(KEY.password, actual)
    api.settings.set(KEY.passwordHash, hash)
    remoteServer?.disconnectAllClients()
    api.window.broadcast('remote:status', { enabled: !!remoteServer?.isListening() })
    return { password: actual }
  })

  api.ipc.registerHandler('remote:update-max-subscribers', async (payload) => {
    const { maxSubscribers } = payload as { maxSubscribers: number }
    if (maxSubscribers < 1 || maxSubscribers > 20) return { error: 'INVALID_VALUE' }
    api.settings.set(KEY.maxSubscribers, maxSubscribers)
    return { ok: true }
  })

  api.ipc.registerHandler('remote:update-ngrok-token', async (payload) => {
    const { ngrokAuthToken } = payload as { ngrokAuthToken: string }
    api.settings.set(KEY.ngrokAuthToken, ngrokAuthToken)
    return { ok: true }
  })

  api.ipc.registerHandler('remote:caddyfile', (_payload) => {
    return generateCaddyfile(getPort())
  })

  api.ipc.registerHandler('remote:get-settings', () => {
    return {
      enabled: api.settings.get<boolean>(KEY.enabled) ?? false,
      port: getPort(),
      maxSubscribers: getMaxSubscribers(),
      password: api.settings.get<string>(KEY.password) ?? '',
      ngrokAuthToken: api.settings.get<string>(KEY.ngrokAuthToken) ?? '',
    }
  })

  api.ipc.registerHandler('remote:tunnel-reconnect', async () => {
    if (!remoteServer?.isListening()) return { ok: false }
    enqueue(async () => {
      ngrokManager.stop()
      const port = getPort()
      const authToken = api.settings.get<string>(KEY.ngrokAuthToken) || undefined
      try {
        const publicUrl = await ngrokManager.start(port, authToken)
        api.window.broadcast('remote:status', {
          enabled: true,
          port,
          publicUrl,
          lanUrl: getLanUrl(port),
        })
      } catch (err) {
        api.window.broadcast('remote:status', {
          enabled: true,
          port,
          publicUrl: null,
          lanUrl: getLanUrl(port),
          ngrokError: String(err),
        })
      }
    })
    return { ok: true }
  })

  // Auto-start if previously enabled
  if (api.settings.get<boolean>(KEY.enabled)) {
    enqueue(startServer)
  }
}

export async function deactivate(): Promise<void> {
  await queue.catch(() => {})
  ngrokManager.stop()
  if (remoteServer) {
    await remoteServer.stop()
    remoteServer = null
  }
}
