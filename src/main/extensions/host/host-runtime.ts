import { dispatchChannel } from '@terminator/extension-sdk'
import type { ChannelSpec, CommandContext, ExtensionDB } from '@terminator/extension-sdk'
import type { RpcEndpoint } from './rpc-endpoint.js'
import type { CommandRun } from './messages.js'
import { CallbackRegistry } from './callbacks.js'
import { createHostExtensionAPI, type HostCommand } from './host-api.js'
import type { HostSnapshot, WorkspacesSnapshot } from './snapshot.js'
import type { BackendFiles, BackendLoader, BackendModule } from './backend-loader.js'
import type { ExtensionSettingsSnapshot } from '../setting-scope.js'

/** What main sends to activate one backend in the extension host. */
export interface BackendRecord extends BackendFiles {
  id: string
}

/** What the runtime reads and loads backends with, besides its port to main. */
export interface HostRuntimeDeps {
  snapshot: HostSnapshot
  db: ExtensionDB
  loader: BackendLoader
}

interface Active {
  record: BackendRecord
  module: BackendModule
  callbacks: CallbackRegistry
}

/** The extension host's side (ADR 094): loads each backend with an API whose members cross to
 * main, and answers main's calls into the backends: a channel's payload, a command, a callback,
 * a changed snapshot. */
export class HostRuntime {
  private readonly active = new Map<string, Active>()
  private readonly channels = new Map<string, ChannelSpec>()
  private readonly commands = new Map<string, HostCommand>()

  private readonly snapshot: HostSnapshot
  private readonly db: ExtensionDB
  private readonly loader: BackendLoader

  constructor(
    private readonly endpoint: RpcEndpoint,
    { snapshot, db, loader }: HostRuntimeDeps
  ) {
    this.snapshot = snapshot
    this.db = db
    this.loader = loader
    endpoint.handle('activate', (record: BackendRecord) => this.loadAndActivate(record))
    endpoint.handle('deactivate', (id: string) => this.deactivate(id))
    endpoint.handle('channel.dispatch', (_id: string, channel: string, payload: unknown) =>
      this.dispatch(channel, payload)
    )
    endpoint.handle('command.run', ({ extensionId, commandId, context, args }: CommandRun) =>
      this.runCommand(`${extensionId}.command.${commandId}`, context, args)
    )
    endpoint.handle('callback', (id: string, callbackId: number, args: unknown[]) =>
      this.active.get(id)?.callbacks.invokeById(callbackId, args)
    )
    endpoint.handle('settings.changed', (settings: ExtensionSettingsSnapshot) => {
      snapshot.settings = settings
    })
    endpoint.handle('workspaces.changed', (workspaces: WorkspacesSnapshot) => {
      snapshot.workspaces = workspaces
    })
  }

  /** Requires the backend and runs its activate. A backend that fails, like one deactivated,
   * leaves the require cache, so its next activation (a reload) runs the code on disk then. */
  private async loadAndActivate(record: BackendRecord): Promise<void> {
    try {
      const module = this.loader.load(record.entryPoint)
      const active: Active = {
        record,
        module,
        callbacks: new CallbackRegistry(),
      }
      this.active.set(record.id, active)
      await module.activate?.(this.apiFor(record, active.callbacks))
    } catch (error) {
      this.active.delete(record.id)
      this.loader.forget(record)
      throw error
    }
  }

  private apiFor(record: BackendRecord, callbacks: CallbackRegistry) {
    return createHostExtensionAPI({
      extensionId: record.id,
      endpoint: this.endpoint,
      snapshot: this.snapshot,
      db: this.db,
      callbacks,
      channels: this.channels,
      commands: this.commands,
      report: (error) => console.error(`[${record.id}]`, error),
    })
  }

  private async deactivate(id: string): Promise<void> {
    const active = this.active.get(id)
    if (!active) return
    this.active.delete(id)
    try {
      await active.module.deactivate?.()
    } finally {
      this.loader.forget(active.record)
    }
  }

  private dispatch(channel: string, payload: unknown): Promise<unknown> {
    const spec = this.channels.get(channel)
    if (!spec) throw new Error(`No extension channel "${channel}"`)
    return dispatchChannel(spec, payload)
  }

  private async runCommand(key: string, context: CommandContext, args: unknown): Promise<void> {
    const command = this.commands.get(key)
    if (!command) throw new Error(`No extension command "${key}"`)
    const schema = command.contribution.args
    if (!schema) return command.handler(context)
    const parsed = schema.safeParse(args)
    if (!parsed.success) throw new Error(`invalid-args: ${parsed.error.message}`)
    return command.handler(context, parsed.data as never)
  }
}
