import { networkInterfaces } from 'os'
import { randomBytes } from 'crypto'
import { z } from 'zod'
import {
  defineChannel,
  noPayload,
  type ChannelSpec,
  type ExtensionAPI,
} from '@terminator/extension-sdk'
import type { RemoteServerHandle } from './server/remote-server.js'
import { PortInUseError } from './server/port-in-use-error.js'
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

// Every remote:* channel is server self-management (enable/disable, ports,
// credentials, tunnel). A remote browser client must not control the server
// it is connected through, so all of them are declared local-only.
const LOCAL_ONLY = { remoteAccessible: false }
const VALIDATION_ERROR = { error: 'VALIDATION_ERROR' }

/** The extension API and the password store every handler works through. */
interface RemoteControlContext {
  api: ExtensionAPI
  credentials: CredentialStore
}

/** What a `remote:status` broadcast says about a listening server, beyond its address. */
interface ListeningFields {
  publicUrl: string | null
  ngrokInstalled?: boolean
  ngrokError?: string | null
}

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
  registerRemoteSettings(api)
  const context: RemoteControlContext = { api, credentials: new CredentialStore(api.settings, KEY) }
  const channels = [
    ...lifecycleChannels(context),
    passwordChannel(context),
    ...preferenceChannels(api),
    ...settingsChannels(context),
    ...connectionChannels(api),
  ]
  for (const channel of channels) api.ipc.registerHandler(channel, LOCAL_ONLY)

  // Convert what earlier versions stored, then auto-start if previously enabled.
  enqueue(async () => {
    const outcome = await context.credentials.migrateLegacy()
    if (outcome === 'invalidated') refuseWithoutPassword(api, PASSWORD_RESET_MESSAGE)
    else if (api.settings.get<boolean>(KEY.enabled)) await startServer(context)
  })
}

// Only register keys that are safe to update via the generic settings panel.
// enabled/port/password are managed by dedicated IPC handlers that run lifecycle
// code; exposing them here would let extension:update-setting bypass it.
function registerRemoteSettings(api: ExtensionAPI): void {
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
}

function getPort(api: ExtensionAPI): number {
  return api.settings.get<number>(KEY.port) ?? 7681
}

function getMaxSubscribers(api: ExtensionAPI): number {
  return api.settings.get<number>(KEY.maxSubscribers) ?? 5
}

function getNgrokAuthToken(api: ExtensionAPI): string | undefined {
  return api.settings.get<string>(KEY.ngrokAuthToken) || undefined
}

function refuseWithoutPassword(api: ExtensionAPI, message?: string): void {
  api.settings.set(KEY.enabled, false)
  api.window.broadcast('remote:status', { enabled: false, error: 'PASSWORD_REQUIRED', message })
}

function broadcastListening(api: ExtensionAPI, port: number, fields: ListeningFields): void {
  api.window.broadcast('remote:status', { enabled: true, port, lanUrl: getLanUrl(port), ...fields })
}

function enqueue(fn: () => Promise<void>): void {
  queue = queue.then(fn).catch(() => {})
}

async function startServer(context: RemoteControlContext): Promise<void> {
  const { api } = context
  if (remoteServer) await stopServer(api)
  if (!context.credentials.hasPassword()) return refuseWithoutPassword(api)
  const port = getPort(api)
  try {
    // fastify and the routes cost the extension host 25 MB: loaded when the server starts.
    const { createRemoteServer } = await import('./server/remote-server.js')
    remoteServer = await createRemoteServer({
      port,
      appPath: api.paths.app,
      ptyManager: api.pty,
      deps: serverDeps(context),
    })
    await remoteServer.start()
    publishDevices(api, remoteServer)
    broadcastListening(api, port, { publicUrl: null })
    await openTunnel(api, port)
  } catch (err) {
    remoteServer = null
    if (err instanceof PortInUseError) return
    api.settings.set(KEY.enabled, false)
    api.window.broadcast('remote:status', { enabled: false, error: 'START_FAILED' })
  }
}

function serverDeps({ api, credentials }: RemoteControlContext) {
  return {
    getPasswordHash: () => credentials.storedPasswordHash(),
    getMaxSubscribers: () => getMaxSubscribers(api),
    listWorkspaces: () => api.workspace.list(),
    listProjects: (id: string) => api.workspace.listProjects(id),
    invokeChannel: (ch: string, payload: unknown) => api.ipc.invokeChannel(ch, payload),
    sendChannel: (ch: string, payload: unknown) => api.ipc.sendChannel(ch, payload),
    onWindowEvent: (ch: string, handler: (...args: unknown[]) => void) =>
      api.ipc.onWindowEvent(ch, handler),
    isRemoteAccessible: (ch: string) => api.ipc.isRemoteAccessible(ch),
    onPortInUse: (p: number) =>
      api.window.broadcast('remote:status', {
        error: 'PORT_IN_USE',
        message: `Port ${p} already in use.`,
      }),
  }
}

// Push the connected-device list whenever it changes. The server owns the
// sockets, so it is the authority; polling would add latency and a second
// source of truth for state it already holds.
function publishDevices(api: ExtensionAPI, server: RemoteServerHandle): void {
  server.devices.onChange((devices) => {
    api.window.broadcast('remote:devices', { devices })
  })
  api.window.broadcast('remote:devices', { devices: server.devices.list() })
}

/** Start the public tunnel when ngrok is installed, and say what came of it. */
async function openTunnel(api: ExtensionAPI, port: number): Promise<void> {
  if (!NgrokManager.isInstalled()) {
    currentPublicUrl = null
    broadcastListening(api, port, { publicUrl: null, ngrokInstalled: false })
    return
  }
  await connectTunnel(api, port)
}

/** Broadcasts the public address, or why there is none. A tunnel that later drops broadcasts
 *  the local address alone. */
async function connectTunnel(api: ExtensionAPI, port: number): Promise<void> {
  const authToken = getNgrokAuthToken(api)
  try {
    const publicUrl = await startTunnel(api, port, authToken)
    broadcastListening(api, port, { publicUrl, ngrokInstalled: true, ngrokError: null })
  } catch (err) {
    currentPublicUrl = null
    const ngrokError = authToken
      ? String(err)
      : 'ngrok requires an auth token — add yours in Settings'
    broadcastListening(api, port, { publicUrl: null, ngrokInstalled: true, ngrokError })
  }
}

/** Start ngrok, and report the address gone if the tunnel later crashes. */
async function startTunnel(
  api: ExtensionAPI,
  port: number,
  authToken: string | undefined
): Promise<string> {
  const publicUrl = await ngrokManager.start(port, authToken)
  currentPublicUrl = publicUrl
  ngrokManager.setOnCrash(() => {
    currentPublicUrl = null
    api.window.broadcast('remote:tunnel-disconnected', {})
    broadcastListening(api, port, { publicUrl: null, ngrokInstalled: true })
  })
  return publicUrl
}

async function reconnectTunnel(api: ExtensionAPI): Promise<void> {
  await ngrokManager.stop()
  await connectTunnel(api, getPort(api))
}

async function stopServer(api: ExtensionAPI): Promise<void> {
  currentPublicUrl = null
  await ngrokManager.stop()
  if (remoteServer) {
    await remoteServer.stop()
    remoteServer = null
  }
  api.window.broadcast('remote:status', { enabled: false })
}

function lifecycleChannels(context: RemoteControlContext): ChannelSpec[] {
  const { api, credentials } = context
  const toggle = defineChannel({
    channel: 'remote:toggle',
    schema: z.object({ enabled: z.boolean() }),
    invalid: VALIDATION_ERROR,
    run: async ({ enabled }) => {
      if (enabled && !credentials.hasPassword()) {
        refuseWithoutPassword(api)
        return { error: 'PASSWORD_REQUIRED' }
      }
      api.settings.set(KEY.enabled, enabled)
      enqueue(enabled ? () => startServer(context) : () => stopServer(api))
      return { ok: true }
    },
  })
  const portChange = defineChannel({
    channel: 'remote:port-change',
    schema: z.object({ port: z.number().int().min(1024).max(65535) }),
    invalid: { error: 'INVALID_PORT' },
    run: async ({ port }) => {
      api.settings.set(KEY.port, port)
      if (api.settings.get<boolean>(KEY.enabled)) enqueue(() => startServer(context))
      return { ok: true }
    },
  })
  return [toggle, portChange]
}

function passwordChannel({ api, credentials }: RemoteControlContext): ChannelSpec {
  return defineChannel({
    channel: 'remote:update-password',
    schema: z.object({ password: z.string() }),
    invalid: VALIDATION_ERROR,
    run: async ({ password }) => {
      const generated = !password
      const actual = password || randomBytes(16).toString('base64url')
      await credentials.setPassword(actual)
      await remoteServer?.disconnectAllClients()
      const listening = !!remoteServer?.isListening()
      const port = api.settings.get<number>(KEY.port) ?? 7681
      api.window.broadcast('remote:status', {
        enabled: listening,
        ...(listening && { port, lanUrl: getLanUrl(port), publicUrl: currentPublicUrl }),
      })
      // A generated password is the one value the owner has no other way to learn.
      return generated ? { password: actual } : { ok: true }
    },
  })
}

function preferenceChannels(api: ExtensionAPI): ChannelSpec[] {
  const maxSubscribers = defineChannel({
    channel: 'remote:update-max-subscribers',
    schema: z.object({ maxSubscribers: z.number().int().min(1).max(20) }),
    invalid: { error: 'INVALID_VALUE' },
    run: async ({ maxSubscribers }) => {
      api.settings.set(KEY.maxSubscribers, maxSubscribers)
      return { ok: true }
    },
  })
  const ngrokToken = defineChannel({
    channel: 'remote:update-ngrok-token',
    schema: z.object({ ngrokAuthToken: z.string() }),
    invalid: VALIDATION_ERROR,
    run: async ({ ngrokAuthToken }) => {
      api.settings.set(KEY.ngrokAuthToken, ngrokAuthToken)
      return { ok: true }
    },
  })
  return [maxSubscribers, ngrokToken]
}

function settingsChannels({ api, credentials }: RemoteControlContext): ChannelSpec[] {
  const caddyfile = defineChannel({
    channel: 'remote:caddyfile',
    schema: noPayload,
    invalid: VALIDATION_ERROR,
    run: () => generateCaddyfile(getPort(api)),
  })
  const getSettings = defineChannel({
    channel: 'remote:get-settings',
    schema: noPayload,
    invalid: VALIDATION_ERROR,
    run: () => {
      const listening = !!remoteServer?.isListening()
      const port = getPort(api)
      return {
        enabled: api.settings.get<boolean>(KEY.enabled) ?? false,
        port,
        maxSubscribers: getMaxSubscribers(api),
        hasPassword: credentials.hasPassword(),
        ngrokAuthToken: api.settings.get<string>(KEY.ngrokAuthToken) ?? '',
        ...(listening && { lanUrl: getLanUrl(port), publicUrl: currentPublicUrl }),
      }
    },
  })
  return [caddyfile, getSettings]
}

function connectionChannels(api: ExtensionAPI): ChannelSpec[] {
  // "Disconnect" in the view. The socket closing is what removes the row, so a
  // failure here leaves it visible rather than lying about what happened.
  const disconnectDevice = defineChannel({
    channel: 'remote:disconnect-device',
    schema: z.object({ id: z.string().min(1) }),
    invalid: { ok: false },
    run: ({ id }) => {
      if (!remoteServer) return { ok: false }
      return { ok: remoteServer.devices.disconnect(id) }
    },
  })
  const tunnelReconnect = defineChannel({
    channel: 'remote:tunnel-reconnect',
    schema: noPayload,
    invalid: { ok: false },
    run: async () => {
      if (!remoteServer?.isListening()) return { ok: false }
      enqueue(() => reconnectTunnel(api))
      return { ok: true }
    },
  })
  return [disconnectDevice, tunnelReconnect]
}

export async function deactivate(): Promise<void> {
  // Stopped before the queue is awaited: a start still waiting up to 30 s for
  // its tunnel would otherwise hold ngrok open past the extension host's exit.
  const tunnelStopped = ngrokManager.stop()
  await queue.catch(() => {})
  await tunnelStopped
  await ngrokManager.stop()
  if (remoteServer) {
    await remoteServer.stop()
    remoteServer = null
  }
}
