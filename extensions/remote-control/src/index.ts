import { networkInterfaces } from 'os'
import { randomBytes } from 'crypto'
import { z } from 'zod'
import { defineChannel, noPayload, type ExtensionAPI } from '@terminator/extension-sdk'
import {
  createRemoteServer,
  PortInUseError,
  type RemoteServerHandle,
} from './server/remote-server.js'
import { NgrokManager, generateCaddyfile } from './server/ngrok-manager.js'
import { CredentialStore } from './server/credential-store.js'

const EXT = 'terminator.remote-control'
const KEY = {
  enabled: `${EXT}.enabled`,
  port: `${EXT}.port`,
  // Held the password in plain text before ADR-100; only ever read to migrate it, then emptied.
  legacyPassword: `${EXT}.password`,
  passwordHash: `${EXT}.passwordHash`,
  maxSubscribers: `${EXT}.maxSubscribers`,
  ngrokAuthToken: `${EXT}.ngrokAuthToken`,
}

const PASSWORD_RESET_MESSAGE =
  'The saved password used an old format that cannot be kept. Set a new password in Settings.'

function getLanUrl(port: number): string {
  const ifaces = networkInterfaces()
  for (const iface of Object.values(ifaces)) {
    for (const addr of iface ?? []) {
      if ((addr.family === 'IPv4' || (addr.family as unknown) === 4) && !addr.internal)
        return `http://${addr.address}:${port}`
    }
  }
  return `http://localhost:${port}`
}

let remoteServer: RemoteServerHandle | null = null
const ngrokManager = new NgrokManager()
let queue: Promise<void> = Promise.resolve()
let currentPublicUrl: string | null = null

export function activate(api: ExtensionAPI): void {
  // Only register keys that are safe to update via the generic settings panel.
  // enabled/port/password/passwordHash are managed exclusively through dedicated IPC handlers
  // (remote:toggle, remote:port-change, remote:update-password) which run lifecycle code.
  // Exposing them here would let extension:update-setting bypass the server lifecycle.
  api.settings.register({
    label: 'Remote Control',
    properties: {
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
  const credentials = new CredentialStore(api.settings, KEY)
  function getMaxSubscribers(): number {
    return api.settings.get<number>(KEY.maxSubscribers) ?? 5
  }

  function refuseWithoutPassword(message?: string): void {
    api.settings.set(KEY.enabled, false)
    api.window.broadcast('remote:status', { enabled: false, error: 'PASSWORD_REQUIRED', message })
  }

  async function startServer(): Promise<void> {
    if (remoteServer) await stopServer()
    if (!credentials.hasPassword()) return refuseWithoutPassword()
    const port = getPort()
    try {
      remoteServer = await createRemoteServer({
        port,
        appPath: api.paths.app,
        ptyManager: api.pty,
        deps: {
          getPasswordHash: () => credentials.getPasswordHash(),
          getMaxSubscribers,
          listWorkspaces: () => api.workspace.list(),
          listProjects: (id) => api.workspace.listProjects(id),
          invokeChannel: (ch, payload) => api.ipc.invokeChannel(ch, payload),
          sendChannel: (ch, payload) => api.ipc.sendChannel(ch, payload),
          onWindowEvent: (ch, handler) => api.ipc.onWindowEvent(ch, handler),
          isRemoteAccessible: (ch) => api.ipc.isRemoteAccessible(ch),
          onPortInUse: (p) =>
            api.window.broadcast('remote:status', {
              error: 'PORT_IN_USE',
              message: `Port ${p} already in use.`,
            }),
        },
      })
      await remoteServer.start()

      // Push the connected-device list whenever it changes. The server owns the
      // sockets, so it is the authority; polling would add latency and a second
      // source of truth for state it already holds.
      remoteServer.devices.onChange((devices) => {
        api.window.broadcast('remote:devices', { devices })
      })
      api.window.broadcast('remote:devices', { devices: remoteServer.devices.list() })
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
          currentPublicUrl = publicUrl
          ngrokManager.setOnCrash(() => {
            currentPublicUrl = null
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
          currentPublicUrl = null
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
        currentPublicUrl = null
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
    currentPublicUrl = null
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

  // Register IPC handlers.
  // Every remote:* channel is server self-management (enable/disable, ports,
  // credentials, tunnel). A remote browser client must not control the server
  // it is connected through, so all of them are declared local-only.
  const LOCAL_ONLY = { remoteAccessible: false }
  const VALIDATION_ERROR = { error: 'VALIDATION_ERROR' }
  api.ipc.registerHandler(
    defineChannel({
      channel: 'remote:toggle',
      schema: z.object({ enabled: z.boolean() }),
      invalid: VALIDATION_ERROR,
      run: async ({ enabled }) => {
        if (enabled && !credentials.hasPassword()) {
          refuseWithoutPassword()
          return { error: 'PASSWORD_REQUIRED' }
        }
        api.settings.set(KEY.enabled, enabled)
        enqueue(enabled ? startServer : stopServer)
        return { ok: true }
      },
    }),
    LOCAL_ONLY
  )

  api.ipc.registerHandler(
    defineChannel({
      channel: 'remote:port-change',
      schema: z.object({ port: z.number().int().min(1024).max(65535) }),
      invalid: { error: 'INVALID_PORT' },
      run: async ({ port }) => {
        api.settings.set(KEY.port, port)
        if (api.settings.get<boolean>(KEY.enabled)) enqueue(startServer)
        return { ok: true }
      },
    }),
    LOCAL_ONLY
  )

  api.ipc.registerHandler(
    defineChannel({
      channel: 'remote:update-password',
      schema: z.object({ password: z.string() }),
      invalid: VALIDATION_ERROR,
      run: async ({ password }) => {
        const generated = !password
        const actual = password || randomBytes(16).toString('base64url')
        await credentials.setPassword(actual)
        remoteServer?.disconnectAllClients()
        const listening = !!remoteServer?.isListening()
        const port = api.settings.get<number>(KEY.port) ?? 7681
        api.window.broadcast('remote:status', {
          enabled: listening,
          ...(listening && { port, lanUrl: getLanUrl(port), publicUrl: currentPublicUrl }),
        })
        // A generated password is the one value the owner has no other way to learn.
        return generated ? { password: actual } : { ok: true }
      },
    }),
    LOCAL_ONLY
  )

  api.ipc.registerHandler(
    defineChannel({
      channel: 'remote:update-max-subscribers',
      schema: z.object({ maxSubscribers: z.number().int().min(1).max(20) }),
      invalid: { error: 'INVALID_VALUE' },
      run: async ({ maxSubscribers }) => {
        api.settings.set(KEY.maxSubscribers, maxSubscribers)
        return { ok: true }
      },
    }),
    LOCAL_ONLY
  )

  api.ipc.registerHandler(
    defineChannel({
      channel: 'remote:update-ngrok-token',
      schema: z.object({ ngrokAuthToken: z.string() }),
      invalid: VALIDATION_ERROR,
      run: async ({ ngrokAuthToken }) => {
        api.settings.set(KEY.ngrokAuthToken, ngrokAuthToken)
        return { ok: true }
      },
    }),
    LOCAL_ONLY
  )

  api.ipc.registerHandler(
    defineChannel({
      channel: 'remote:caddyfile',
      schema: noPayload,
      invalid: VALIDATION_ERROR,
      run: () => {
        return generateCaddyfile(getPort())
      },
    }),
    LOCAL_ONLY
  )

  // "Disconnect" in the view. The socket closing is what removes the row, so a
  // failure here leaves it visible rather than lying about what happened.
  api.ipc.registerHandler(
    defineChannel({
      channel: 'remote:disconnect-device',
      schema: z.object({ id: z.string().min(1) }),
      invalid: { ok: false },
      run: ({ id }) => {
        if (!remoteServer) return { ok: false }
        return { ok: remoteServer.devices.disconnect(id) }
      },
    }),
    LOCAL_ONLY
  )

  api.ipc.registerHandler(
    defineChannel({
      channel: 'remote:get-settings',
      schema: noPayload,
      invalid: VALIDATION_ERROR,
      run: () => {
        const listening = !!remoteServer?.isListening()
        const port = getPort()
        return {
          enabled: api.settings.get<boolean>(KEY.enabled) ?? false,
          port,
          maxSubscribers: getMaxSubscribers(),
          hasPassword: credentials.hasPassword(),
          ngrokAuthToken: api.settings.get<string>(KEY.ngrokAuthToken) ?? '',
          ...(listening && { lanUrl: getLanUrl(port), publicUrl: currentPublicUrl }),
        }
      },
    }),
    LOCAL_ONLY
  )

  api.ipc.registerHandler(
    defineChannel({
      channel: 'remote:tunnel-reconnect',
      schema: noPayload,
      invalid: { ok: false },
      run: async () => {
        if (!remoteServer?.isListening()) return { ok: false }
        enqueue(async () => {
          ngrokManager.stop()
          const port = getPort()
          const authToken = api.settings.get<string>(KEY.ngrokAuthToken) || undefined
          try {
            const publicUrl = await ngrokManager.start(port, authToken)
            currentPublicUrl = publicUrl
            ngrokManager.setOnCrash(() => {
              currentPublicUrl = null
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
            })
          } catch (err) {
            currentPublicUrl = null
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
      },
    }),
    LOCAL_ONLY
  )

  // Convert what earlier versions stored, then auto-start if previously enabled.
  enqueue(async () => {
    const outcome = await credentials.migrateLegacy()
    if (outcome === 'invalidated') refuseWithoutPassword(PASSWORD_RESET_MESSAGE)
    else if (api.settings.get<boolean>(KEY.enabled)) await startServer()
  })
}

export async function deactivate(): Promise<void> {
  await queue.catch(() => {})
  ngrokManager.stop()
  if (remoteServer) {
    await remoteServer.stop()
    remoteServer = null
  }
}
