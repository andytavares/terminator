import { dispatchChannel } from '@terminator/extension-sdk'
import type { ChannelSpec, CommandContext, ExtensionDB } from '@terminator/extension-sdk'
import type { RpcEndpoint } from './rpc-endpoint.js'
import { CallbackRegistry } from './callbacks.js'
import { createHostExtensionAPI, type HostCommand } from './host-api.js'
import type { HostSnapshot, WorkspacesSnapshot } from './snapshot.js'
import type { BackendFiles, BackendLoader, BackendModule } from './backend-loader.js'

/** What main sends to activate one backend in the extension host. */
export interface BackendRecord extends BackendFiles {
  id: string
  dependencies: string[]
}

interface Active {
  record: BackendRecord
  module: BackendModule
  exports: unknown
  callbacks: CallbackRegistry
}

/**
 * The extension host's side (ADR 094): loads each backend with an API whose
 * members cross to main, and answers main's calls into the backends: a
 * channel's payload, a command, a callback, a changed snapshot.
 */
export class HostRuntime {
  private readonly active = new Map<string, Active>()
  private readonly channels = new Map<string, ChannelSpec>()
  private readonly commands = new Map<string, HostCommand>()

  constructor(
    private readonly endpoint: RpcEndpoint,
    private readonly snapshot: HostSnapshot,
    private readonly db: ExtensionDB,
    private readonly loader: BackendLoader
  ) {
    endpoint.handle('activate', (record: BackendRecord) => this.activate(record))
    endpoint.handle('deactivate', (id: string) => this.deactivate(id))
    endpoint.handle('channel.dispatch', (_id: string, channel: string, payload: unknown) =>
      this.dispatch(channel, payload)
    )
    endpoint.handle('command.run', (id: string, command: string, context: CommandContext, args) =>
      this.runCommand(`${id}.command.${command}`, context, args)
    )
    endpoint.handle('callback', (id: string, callbackId: number, args: unknown[]) =>
      this.active.get(id)?.callbacks.invoke(callbackId, args)
    )
    endpoint.handle('settings.changed', (settings: Record<string, unknown>) => {
      snapshot.settings = settings
    })
    endpoint.handle('workspaces.changed', (workspaces: WorkspacesSnapshot) => {
      snapshot.workspaces = workspaces
    })
  }

  /**
   * Requires the backend and runs its activate. A backend that fails, like one
   * deactivated, leaves the require cache, so its next activation (a reload)
   * runs the code on disk then.
   */
  private async activate(record: BackendRecord): Promise<void> {
    try {
      const module = this.loader.load(record.entryPoint)
      const active: Active = {
        record,
        module,
        exports: undefined,
        callbacks: new CallbackRegistry(),
      }
      this.active.set(record.id, active)
      active.exports = await module.activate?.(this.apiFor(record, active.callbacks))
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
      exportsOf: (dependencyId) => this.exportsFor(record, dependencyId),
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

  private exportsFor(record: BackendRecord, dependencyId: string): unknown {
    if (!record.dependencies.includes(dependencyId)) {
      throw new Error(
        `Extension "${record.id}" did not declare "${dependencyId}" in extensionDependencies`
      )
    }
    return this.active.get(dependencyId)?.exports
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
