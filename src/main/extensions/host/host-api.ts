import type {
  ChannelSpec,
  CommandContext,
  CommandContribution,
  Disposable,
  ExtensionAPI,
  ExtensionDB,
  ExtensionSettingsSchema,
  SettingScope,
} from '@terminator/extension-sdk'
import type { RpcEndpoint } from './rpc-endpoint.js'
import type { ApiCall, HeldRegistration } from './messages.js'
import { CallbackRegistry } from './callbacks.js'
import type { HostSnapshot } from './snapshot.js'
import { extensionPaths } from '../extension-paths.js'
import { storedSettingValue } from '../setting-scope.js'

/** A command as the extension host keeps it: main sees neither its handler nor its schema. */
export interface HostCommand {
  contribution: CommandContribution
  handler: (context: CommandContext, args?: never) => void | Promise<void>
}

/** What one extension's API in the extension host is built from. */
export interface HostContext {
  extensionId: string
  endpoint: RpcEndpoint
  snapshot: HostSnapshot
  db: ExtensionDB
  callbacks: CallbackRegistry
  channels: Map<string, ChannelSpec>
  commands: Map<string, HostCommand>
  report: (error: unknown) => void
}

interface Registration {
  disposable: Disposable
  ready: Promise<unknown>
}

/** Calls into main for one extension: answered, fire-and-forget, or held as a registration. */
class MainCalls {
  private nextHandle = 1

  constructor(private readonly context: HostContext) {}

  async ask(path: string, ...params: unknown[]): Promise<never> {
    const { endpoint, callbacks, extensionId } = this.context
    const marshalled = callbacks.marshal(params)
    try {
      const call: ApiCall = { extensionId, path, params: marshalled.params }
      return (await endpoint.request('api', call)) as never
    } finally {
      callbacks.release(marshalled.ids)
    }
  }

  tell(path: string, ...params: unknown[]): void {
    const call: ApiCall = { extensionId: this.context.extensionId, path, params }
    this.context.endpoint.notify('api', call)
  }

  registerAcross(method: string, ...params: unknown[]): Registration {
    const { endpoint, callbacks, extensionId, report } = this.context
    const handleId = this.nextHandle++
    const marshalled = callbacks.marshal(params)
    const ready =
      method === 'api'
        ? endpoint.request('api', {
            extensionId,
            path: params[0] as string,
            params: marshalled.params.slice(1),
            handleId,
          } satisfies ApiCall)
        : endpoint.request(method, {
            extensionId,
            handleId,
            params: marshalled.params,
          } satisfies HeldRegistration<unknown[]>)
    ready.catch(() => callbacks.release(marshalled.ids))
    let disposed = false
    const release = () => {
      if (disposed) return
      disposed = true
      callbacks.release(marshalled.ids)
      ready.then(() => endpoint.request('release', extensionId, handleId)).catch(report)
    }
    return { disposable: { dispose: release }, ready }
  }

  /** A registration whose failure only the log hears of, as an in-process one would throw. */
  hold(path: string, ...params: unknown[]): Disposable {
    const { disposable, ready } = this.registerAcross('api', path, ...params)
    ready.catch(this.context.report)
    return disposable
  }
}

function settingsFor(context: HostContext, main: MainCalls): ExtensionAPI['settings'] {
  let schema: ExtensionSettingsSchema | undefined
  return {
    register(registered) {
      schema = registered
      return main.hold('settings.register', registered)
    },
    get<T>(key: string, scope?: SettingScope): T | undefined {
      const { settings, workspaces } = context.snapshot
      const read = { extensionId: context.extensionId, key, repoPath: scope?.repoPath }
      const stored = storedSettingValue(settings, workspaces, read)
      if (stored !== undefined) return stored as T
      return schema?.properties[key]?.default as T | undefined
    },
    set(key, value) {
      const { settings } = context.snapshot
      context.snapshot.settings = { ...settings, global: { ...settings.global, [key]: value } }
      main.tell('settings.set', key, value)
    },
    isBranchExcluded: (branch, repoPath) => main.ask('settings.isBranchExcluded', branch, repoPath),
  }
}

function hostWorkspaceApi(context: HostContext, main: MainCalls): ExtensionAPI['workspace'] {
  return {
    list: () => context.snapshot.workspaces.workspaces,
    listProjects: (workspaceId) => context.snapshot.workspaces.projects[workspaceId] ?? [],
    addProject: (input) => main.ask('workspace.addProject', input),
    deleteProject: (projectId) => main.tell('workspace.deleteProject', projectId),
  }
}

/** Registers a per-session listener in main; the disposer ends it. */
function listenAcrossFrom(main: MainCalls) {
  return (path: string, sessionId: string, callback: unknown) => {
    const { disposable } = main.registerAcross('api', path, sessionId, callback)
    return () => disposable.dispose()
  }
}

function ptyFor(main: MainCalls): ExtensionAPI['pty'] {
  const listenAcross = listenAcrossFrom(main)
  return {
    spawnSession: (options) => main.ask('pty.spawnSession', options),
    openTerminal: (input) => main.ask('pty.openTerminal', input),
    runInTerminal: (input) => main.ask('pty.runInTerminal', input),
    closeTerminalTab: (sessionId) => main.tell('pty.closeTerminalTab', sessionId),
    onData: (sessionId, callback) => listenAcross('pty.onData', sessionId, callback),
    onExit: (sessionId, callback) => listenAcross('pty.onExit', sessionId, callback),
    getSession: (sessionId) => main.ask('pty.getSession', sessionId),
    setWorkspace: (sessionId, workspaceId) => main.ask('pty.setWorkspace', sessionId, workspaceId),
    write: (sessionId, data) => main.tell('pty.write', sessionId, data),
    resize: (sessionId, cols, rows) => main.tell('pty.resize', sessionId, cols, rows),
    kill: (sessionId) => main.tell('pty.kill', sessionId),
    listSessions: () => main.ask('pty.listSessions'),
  }
}

function agentsFor(main: MainCalls): ExtensionAPI['agents'] {
  const listenAcross = listenAcrossFrom(main)
  return {
    list: () => main.ask('agents.list'),
    start: (input) => main.ask('agents.start', input),
    prompt: (sessionId, text) => main.ask('agents.prompt', sessionId, text),
    cancel: (sessionId) => main.tell('agents.cancel', sessionId),
    setConfig: (sessionId, configId, value) =>
      main.ask('agents.setConfig', sessionId, configId, value),
    close: (sessionId) => main.ask('agents.close', sessionId),
    onUpdate: (sessionId, callback) => listenAcross('agents.onUpdate', sessionId, callback),
    onPermission: (sessionId, callback) => listenAcross('agents.onPermission', sessionId, callback),
    onPermissionSettled: (sessionId, callback) =>
      listenAcross('agents.onPermissionSettled', sessionId, callback),
    answer: (sessionId, requestId, optionId) =>
      main.ask('agents.answer', sessionId, requestId, optionId),
    onEnd: (sessionId, callback) => listenAcross('agents.onEnd', sessionId, callback),
    runOnce: (input) => main.ask('agents.runOnce', input),
    models: (agentId) => main.ask('agents.models', agentId),
  }
}

function ipcFor(context: HostContext, main: MainCalls): ExtensionAPI['ipc'] {
  return {
    registerHandler(spec, options) {
      if (typeof spec?.channel !== 'string' || spec.schema === undefined) {
        throw new TypeError('registerHandler needs a ChannelSpec with a schema (ADR 096)')
      }
      context.channels.set(spec.channel, spec)
      const remote = options?.remoteAccessible ?? false
      const { disposable } = main.registerAcross('channel.register', spec.channel, remote)
      return {
        dispose() {
          context.channels.delete(spec.channel)
          disposable.dispose()
        },
      }
    },
    invokeChannel: (channel, payload) => main.ask('ipc.invokeChannel', channel, payload),
    sendChannel: (channel, payload) => main.tell('ipc.sendChannel', channel, payload),
    onWindowEvent(channel, handler) {
      const { disposable } = main.registerAcross('api', 'ipc.onWindowEvent', channel, handler)
      return () => disposable.dispose()
    },
    isRemoteAccessible: (channel) => main.ask('ipc.isRemoteAccessible', channel),
  }
}

function commandsFor(context: HostContext, main: MainCalls): ExtensionAPI['commands'] {
  return {
    register(command, handler) {
      const key = `${context.extensionId}.command.${command.id}`
      context.commands.set(key, { contribution: command, handler })
      const { args, ...crossing } = command
      const { disposable } = main.registerAcross('command.register', crossing, args !== undefined)
      return {
        dispose() {
          context.commands.delete(key)
          disposable.dispose()
        },
      }
    },
  }
}

function issuesFor(context: HostContext, main: MainCalls): ExtensionAPI['issues'] {
  return {
    connections: () => main.ask('issues.connections'),
    listMine: (options) => main.ask('issues.listMine', options),
    search: (term, options) => main.ask('issues.search', term, options),
    get: (tracker, key, options) => main.ask('issues.get', tracker, key, options),
    comment: (tracker, key, body) => main.ask('issues.comment', tracker, key, body),
    states: (tracker, key) => main.ask('issues.states', tracker, key),
    // Forwarded as the SDK declares it: tracker, key, intent and the operator's option.
    transition: (...move) => main.ask('issues.transition', ...move),
    supportsTransitions: (tracker) => context.snapshot.trackers[tracker]?.transitions ?? false,
    teams: (tracker) => main.ask('issues.teams', tracker),
    create: (tracker, input) => main.ask('issues.create', tracker, input),
    supportsCreate: (tracker) => context.snapshot.trackers[tracker]?.create ?? false,
  }
}

function githubFor(main: MainCalls): ExtensionAPI['github'] {
  return {
    api: (target, request) => main.ask('github.api', target, request),
    pullRequests: {
      view: (target, pullRequest, fields) =>
        main.ask('github.pullRequests.view', target, pullRequest, fields),
      list: (target, query) => main.ask('github.pullRequests.list', target, query),
      create: (target, input) => main.ask('github.pullRequests.create', target, input),
      markReady: (target, pullRequest) =>
        main.ask('github.pullRequests.markReady', target, pullRequest),
      updateBranch: (target, pullRequest) =>
        main.ask('github.pullRequests.updateBranch', target, pullRequest),
    },
    repositories: {
      view: (target, fields) => main.ask('github.repositories.view', target, fields),
      clone: (target, repository, directory) =>
        main.ask('github.repositories.clone', target, repository, directory),
    },
  }
}

function windowFor(main: MainCalls): ExtensionAPI['window'] {
  return {
    openAuxiliary: (view, params) => main.tell('window.openAuxiliary', view, params),
    broadcast: (channel, data) => main.tell('window.broadcast', channel, data),
    focusSelf: (viewParam) => main.tell('window.focusSelf', viewParam),
    showSelf: (view) => main.tell('window.showSelf', view),
    raise: () => main.tell('window.raise'),
  }
}

/** Log arguments as they can cross: an Error by its stack, a function by its name. */
function loggable(meta: unknown[]): unknown[] {
  return meta.map((value) => {
    if (value instanceof Error) return value.stack ?? value.message
    return typeof value === 'function' ? `[function ${value.name}]` : value
  })
}

function logFor(main: MainCalls): ExtensionAPI['log'] {
  const level =
    (name: string) =>
    (message: string, ...meta: unknown[]) =>
      main.tell(`log.${name}`, message, ...loggable(meta))
  return { debug: level('debug'), info: level('info'), warn: level('warn'), error: level('error') }
}

function globalShortcutFor(main: MainCalls): ExtensionAPI['globalShortcut'] {
  return {
    async register(accelerator, handler) {
      const { disposable, ready } = main.registerAcross(
        'api',
        'globalShortcut.register',
        accelerator,
        handler
      )
      await ready
      return disposable
    },
  }
}

type ForwardedMember = 'dialog' | 'shell' | 'notifications' | 'home' | 'nativeMenu' | 'usage'

/** The members that are each one call or registration in main, with nothing kept here. */
function forwardedMembersFor(main: MainCalls): Pick<ExtensionAPI, ForwardedMember> {
  return {
    dialog: {
      showOpenDialog: (options) => main.ask('dialog.showOpenDialog', options),
      showSaveDialog: (options) => main.ask('dialog.showSaveDialog', options),
    },
    shell: {
      exec: ((options) => main.ask('shell.exec', options)) as ExtensionAPI['shell']['exec'],
    },
    notifications: {
      showToast: (type, message, key) => main.tell('notifications.showToast', type, message, key),
      createNotification: (options) => main.hold('notifications.createNotification', options),
    },
    home: {
      publish: (feed) => main.tell('home.publish', feed),
      onAction: (handler) => main.hold('home.onAction', handler),
    },
    usage: { record: (feature, outcome) => main.tell('usage.record', feature, outcome) },
    nativeMenu: { addViewMenuItem: (item) => main.hold('nativeMenu.addViewMenuItem', item) },
  }
}

/** The ExtensionAPI an extension receives in the extension host (ADR 094): the same declaration
 * as main's `api.ts`, each member a call across the port, a read of the snapshot main pushes,
 * or (`db`, `extensions`) answered here. */
export function createHostExtensionAPI(context: HostContext): ExtensionAPI {
  const main = new MainCalls(context)
  return {
    ...forwardedMembersFor(main),
    db: context.db,
    paths: extensionPaths(context.snapshot.paths, context.extensionId),
    log: logFor(main),
    settings: settingsFor(context, main),
    globalShortcut: globalShortcutFor(main),
    workspace: hostWorkspaceApi(context, main),
    github: githubFor(main),
    issues: issuesFor(context, main),
    commands: commandsFor(context, main),
    ipc: ipcFor(context, main),
    pty: ptyFor(main),
    agents: agentsFor(main),
    window: windowFor(main),
  }
}
