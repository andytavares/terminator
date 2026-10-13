import { MessageChannelMain, utilityProcess } from 'electron'
import type { ExtensionAPI } from '@terminator/extension-sdk'
import { RpcEndpoint, type MessageLink, type RpcMessage } from './rpc-endpoint.js'
import { ExtensionApiServer } from './api-server.js'
import type { BackendRecord } from './host-runtime.js'
import type { HostSnapshot, WorkspacesSnapshot } from './snapshot.js'
import type { ExtensionSettingsSnapshot } from '../setting-scope.js'

/** A started extension host, as main drives it. */
export interface SpawnedHost {
  link: MessageLink
  onExit(listener: (code: number) => void): void
  kill(): void
}

export interface HostProcessOptions {
  spawn: (snapshot: HostSnapshot) => SpawnedHost
  snapshot: () => HostSnapshot
  apiFor: (extensionId: string) => ExtensionAPI | undefined
  /** The host stopped and was not restarted (or failed to come back): these backends are gone. */
  onBackendsFailed: (extensionIds: string[], message: string) => void
  log: (message: string) => void
}

/** How many times a host that exits on its own is started again before its extensions fail. */
const HOST_RESTARTS = 1

interface Running {
  host: SpawnedHost
  endpoint: RpcEndpoint
  server: ExtensionApiServer
}

/**
 * Main's handle on the one extension host process (ADR 094). Started on the
 * first backend it is given. When it exits unasked, the app stays up: it is
 * started again once and its backends activated again; a second exit fails
 * them, which the extensions list shows.
 */
export class ExtensionHostProcess {
  private running: Running | null = null
  private readonly records = new Map<string, BackendRecord>()
  private restarts = 0
  private stopping = false

  constructor(private readonly options: HostProcessOptions) {}

  async activate(record: BackendRecord): Promise<void> {
    const { endpoint } = this.ensureRunning()
    this.records.set(record.id, record)
    try {
      await endpoint.request('activate', record)
    } catch (error) {
      this.forget(record.id)
      throw error
    }
  }

  async deactivate(extensionId: string): Promise<void> {
    if (!this.records.has(extensionId)) return
    const endpoint = this.running?.endpoint
    this.forget(extensionId)
    await endpoint?.request('deactivate', extensionId)
  }

  pushSettings(settings: ExtensionSettingsSnapshot): void {
    this.running?.endpoint.notify('settings.changed', settings)
  }

  pushWorkspaces(workspaces: WorkspacesSnapshot): void {
    this.running?.endpoint.notify('workspaces.changed', workspaces)
  }

  stop(): void {
    this.stopping = true
    this.running?.host.kill()
  }

  private forget(extensionId: string): void {
    this.records.delete(extensionId)
    this.running?.server.releaseAll(extensionId)
  }

  private ensureRunning(): Running {
    if (this.running) return this.running
    const host = this.options.spawn(this.options.snapshot())
    const endpoint = new RpcEndpoint(host.link, (method, error) =>
      this.options.log(`extension host event ${method} failed: ${String(error)}`)
    )
    const server = new ExtensionApiServer(endpoint, this.options.apiFor)
    const running = { host, endpoint, server }
    host.onExit((code) => this.exited(running, code))
    this.running = running
    return running
  }

  private exited(running: Running, code: number): void {
    if (this.running !== running) return
    this.running = null
    running.endpoint.failPending(`extension host exited with code ${code}`)
    const records = [...this.records.values()]
    for (const { id } of records) running.server.releaseAll(id)
    this.records.clear()
    if (this.stopping) return
    const message = `Extension host exited with code ${code}`
    this.options.log(message)
    if (this.restarts >= HOST_RESTARTS) {
      this.options.onBackendsFailed(
        records.map(({ id }) => id),
        message
      )
      return
    }
    this.restarts++
    this.options.log('Restarting the extension host')
    this.reactivate(records, message)
  }

  /** Activates `records` again, each after the dependencies it had, as main first did. */
  private reactivate(records: BackendRecord[], message: string): void {
    const byId = new Map(records.map((record) => [record.id, record]))
    const reactivations = new Map<string, Promise<void>>()
    const reactivation = (id: string): Promise<void> => {
      const started = reactivations.get(id)
      if (started) return started
      const record = byId.get(id)!
      const dependencies = record.dependencies.filter((dependency) => byId.has(dependency))
      const activated = Promise.all(dependencies.map(dependencyReady(reactivation))).then(() =>
        this.activate(record)
      )
      reactivations.set(id, activated)
      return activated
    }
    for (const { id } of records) {
      reactivation(id).catch((error) =>
        this.options.onBackendsFailed([id], `${message}; restart failed: ${errorText(error)}`)
      )
    }
  }
}

/** A dependency's reactivation, failing with a message naming it rather than its own error. */
function dependencyReady(reactivation: (id: string) => Promise<void>) {
  return (id: string) =>
    reactivation(id).catch(() => {
      throw new Error(`Extension dependency "${id}" failed to activate`)
    })
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function portLink(port: Electron.MessagePortMain): MessageLink {
  return {
    post: (message) => port.postMessage(message),
    listen: (receive) => port.on('message', (event) => receive(event.data as RpcMessage)),
  }
}

/** Starts `entryPath` as a utilityProcess and hands it one end of a MessageChannelMain. */
export function spawnUtilityHost(entryPath: string): (snapshot: HostSnapshot) => SpawnedHost {
  return (snapshot) => {
    const child = utilityProcess.fork(entryPath, [], { serviceName: 'Extension Host' })
    const { port1, port2 } = new MessageChannelMain()
    child.postMessage(snapshot, [port2])
    port1.start()
    return {
      link: portLink(port1),
      onExit: (listener) => child.on('exit', listener),
      kill: () => child.kill(),
    }
  }
}
