import { z } from 'zod'
import { defineChannel } from '@terminator/extension-sdk'
import type { Disposable, ExtensionAPI } from '@terminator/extension-sdk'
import type { RpcEndpoint } from './rpc-endpoint.js'
import type { ApiCall, ChannelRegistration, CommandRegistration, CommandRun } from './messages.js'
import { reviveCallbacks } from './callbacks.js'

/** Every API member the extension host may call by path. The host answers the rest (`db`,
 * `extensions`, `paths`, the `settings.get` and `workspace.list` snapshots); others register below,
 * since a schema cannot cross (`ipc.registerHandler`, `commands.register`). */
const CROSSING_MEMBERS: ReadonlySet<string> = new Set([
  'log.debug',
  'log.info',
  'log.warn',
  'log.error',
  'settings.register',
  'settings.set',
  'settings.isBranchExcluded',
  'globalShortcut.register',
  'workspace.addProject',
  'workspace.deleteProject',
  'shell.exec',
  'github.api',
  'github.pullRequests.view',
  'github.pullRequests.list',
  'github.pullRequests.create',
  'github.pullRequests.markReady',
  'github.pullRequests.updateBranch',
  'github.repositories.view',
  'github.repositories.clone',
  'issues.connections',
  'issues.listMine',
  'issues.search',
  'issues.get',
  'issues.comment',
  'issues.states',
  'issues.transition',
  'issues.teams',
  'issues.create',
  'notifications.showToast',
  'notifications.createNotification',
  'home.publish',
  'home.onAction',
  'nativeMenu.addViewMenuItem',
  'ipc.invokeChannel',
  'ipc.sendChannel',
  'ipc.onWindowEvent',
  'ipc.isRemoteAccessible',
  'terminal.onSessionCreate',
  'terminal.onSessionClose',
  'pty.spawnSession',
  'pty.openTerminal',
  'pty.runInTerminal',
  'pty.closeTerminalTab',
  'pty.onData',
  'pty.onExit',
  'pty.getSession',
  'pty.setWorkspace',
  'pty.write',
  'pty.resize',
  'pty.kill',
  'pty.listSessions',
  'agents.list',
  'agents.start',
  'agents.prompt',
  'agents.cancel',
  'agents.setConfig',
  'agents.close',
  'agents.onUpdate',
  'agents.onPermission',
  'agents.answer',
  'agents.onEnd',
  'agents.runOnce',
  'agents.models',
  'window.openAuxiliary',
  'window.broadcast',
  'window.focusSelf',
  'window.showSelf',
  'window.raise',
  'dialog.showOpenDialog',
  'dialog.showSaveDialog',
])

type Member = (...params: unknown[]) => unknown
type Handle = Disposable | (() => void)

/** The member at `path` and the object it is called on. */
function memberAt(api: ExtensionAPI, path: string): { owner: object; member: Member } {
  const names = path.split('.')
  let owner: object = api
  for (const name of names.slice(0, -1)) owner = Reflect.get(owner, name)
  return { owner, member: Reflect.get(owner, names[names.length - 1]) }
}

function disposeHandle(handle: Handle | undefined): void {
  if (typeof handle === 'function') handle()
  else handle?.dispose()
}

/** Main's side of the extension host's port: a call runs on the named extension's API object, so
 * `api.ts` stays the one implementation. A registration's disposable is kept under the id the host
 * chose, so the host returns a Disposable without waiting for the answer. */
export class ExtensionApiServer {
  private readonly handles = new Map<string, Map<number, Handle>>()

  constructor(
    private readonly endpoint: RpcEndpoint,
    private readonly apiFor: (extensionId: string) => ExtensionAPI | undefined
  ) {
    endpoint.handle('api', (call: ApiCall) => this.call(call))
    endpoint.handle('release', (id: string, handleId: number) => this.release(id, handleId))
    endpoint.handle('channel.register', (registration: ChannelRegistration) =>
      this.registerChannel(registration)
    )
    endpoint.handle('command.register', (registration: CommandRegistration) =>
      this.registerCommand(registration)
    )
  }

  /** Ends everything an extension still holds: its listeners and registrations. */
  releaseAll(extensionId: string): void {
    for (const handle of this.handles.get(extensionId)?.values() ?? []) disposeHandle(handle)
    this.handles.delete(extensionId)
  }

  private async call({ extensionId, path, params, handleId }: ApiCall) {
    if (!CROSSING_MEMBERS.has(path)) throw new Error(`"${path}" is not part of the Extension API`)
    const { owner, member } = memberAt(this.requireApi(extensionId), path)
    const revived = reviveCallbacks(params, (callbackId) => (...args: unknown[]) => {
      this.endpoint.notify('callback', extensionId, callbackId, args)
    }) as unknown[]
    const result = await member.apply(owner, revived)
    if (handleId === undefined) return result
    this.keep(extensionId, handleId, result as Handle)
    return undefined
  }

  private registerChannel({ extensionId, handleId, params }: ChannelRegistration) {
    const [channel, remote] = params
    const spec = defineChannel({
      channel,
      // The extension's own schema runs in the extension host, before its `run`.
      schema: z.unknown(),
      invalid: undefined,
      run: (payload) => this.endpoint.request('channel.dispatch', extensionId, channel, payload),
    })
    const registration = this.requireApi(extensionId).ipc.registerHandler(spec, {
      remoteAccessible: remote,
    })
    this.keep(extensionId, handleId, registration)
  }

  private registerCommand({ extensionId, handleId, params }: CommandRegistration) {
    const [command, takesArgs] = params
    const contribution = { ...command, args: takesArgs ? z.unknown() : undefined }
    const registration = this.requireApi(extensionId).commands.register(
      contribution,
      async (context, args) => {
        const run: CommandRun = { extensionId, commandId: command.id, context, args }
        await this.endpoint.request('command.run', run)
      }
    )
    this.keep(extensionId, handleId, registration)
  }

  private keep(extensionId: string, handleId: number, handle: Handle): void {
    const held = this.handles.get(extensionId) ?? new Map<number, Handle>()
    held.set(handleId, handle)
    this.handles.set(extensionId, held)
  }

  private release(extensionId: string, handleId: number): void {
    const held = this.handles.get(extensionId)
    disposeHandle(held?.get(handleId))
    held?.delete(handleId)
  }

  private requireApi(extensionId: string): ExtensionAPI {
    const api = this.apiFor(extensionId)
    if (!api) throw new Error(`Extension "${extensionId}" is not active`)
    return api
  }
}
