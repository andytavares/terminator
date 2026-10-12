import type {
  ChannelSpec,
  CommandContext,
  CommandContribution,
  Disposable,
  ExtensionAPI,
  ExtensionDB,
  ExtensionSettingsSchema,
} from '@terminator/extension-sdk'
import type { RpcEndpoint } from './rpc-endpoint.js'
import { CallbackRegistry } from './callbacks.js'
import type { HostSnapshot } from './snapshot.js'

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
  exportsOf: (dependencyId: string) => unknown
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

  async call(path: string, ...params: unknown[]): Promise<never> {
    const { endpoint, callbacks, extensionId } = this.context
    const marshalled = callbacks.marshal(params)
    try {
      return (await endpoint.request('api', extensionId, path, marshalled.params)) as never
    } finally {
      callbacks.release(marshalled.ids)
    }
  }

  fire(path: string, ...params: unknown[]): void {
    this.context.endpoint.notify('api', this.context.extensionId, path, params)
  }

  register(method: string, ...params: unknown[]): Registration {
    const { endpoint, callbacks, extensionId, report } = this.context
    const handleId = this.nextHandle++
    const marshalled = callbacks.marshal(params)
    const ready =
      method === 'api'
        ? endpoint.request('api', extensionId, params[0], marshalled.params.slice(1), handleId)
        : endpoint.request(method, extensionId, ...marshalled.params, handleId)
    ready.catch(() => callbacks.release(marshalled.ids))
    let disposed = false
    const dispose = () => {
      if (disposed) return
      disposed = true
      callbacks.release(marshalled.ids)
      ready.then(() => endpoint.request('release', extensionId, handleId)).catch(report)
    }
    return { disposable: { dispose }, ready }
  }

  /** A registration whose failure only the log hears of, as an in-process one would throw. */
  held(path: string, ...params: unknown[]): Disposable {
    const { disposable, ready } = this.register('api', path, ...params)
    ready.catch(this.context.report)
    return disposable
  }
}

function settingsFor(context: HostContext, main: MainCalls): ExtensionAPI['settings'] {
  let schema: ExtensionSettingsSchema | undefined
  return {
    register(registered) {
      schema = registered
      return main.held('settings.register', registered)
    },
    get<T>(key: string): T | undefined {
      const values = context.snapshot.settings
      if (key in values) return values[key] as T
      return schema?.properties[key]?.default as T | undefined
    },
    set(key, value) {
      context.snapshot.settings = { ...context.snapshot.settings, [key]: value }
      main.fire('settings.set', key, value)
    },
    isBranchExcluded: (branch, repoPath) =>
      main.call('settings.isBranchExcluded', branch, repoPath),
  }
}

function workspaceFor(context: HostContext, main: MainCalls): ExtensionAPI['workspace'] {
  return {
    list: () => context.snapshot.workspaces.workspaces,
    listProjects: (workspaceId) => context.snapshot.workspaces.projects[workspaceId] ?? [],
    addProject: (input) => main.call('workspace.addProject', input),
    deleteProject: (projectId) => main.fire('workspace.deleteProject', projectId),
  }
}

function ptyFor(main: MainCalls): ExtensionAPI['pty'] {
  const listener = (path: string, sessionId: string, callback: unknown) => {
    const { disposable } = main.register('api', path, sessionId, callback)
    return () => disposable.dispose()
  }
  return {
    spawnSession: (options) => main.call('pty.spawnSession', options),
    openTerminal: (input) => main.call('pty.openTerminal', input),
    runInTerminal: (input) => main.call('pty.runInTerminal', input),
    closeTerminalTab: (sessionId) => main.fire('pty.closeTerminalTab', sessionId),
    onData: (sessionId, callback) => listener('pty.onData', sessionId, callback),
    onExit: (sessionId, callback) => listener('pty.onExit', sessionId, callback),
    getSession: (sessionId) => main.call('pty.getSession', sessionId),
    setWorkspace: (sessionId, workspaceId) => main.call('pty.setWorkspace', sessionId, workspaceId),
    write: (sessionId, data) => main.fire('pty.write', sessionId, data),
    resize: (sessionId, cols, rows) => main.fire('pty.resize', sessionId, cols, rows),
    kill: (sessionId) => main.fire('pty.kill', sessionId),
    listSessions: () => main.call('pty.listSessions'),
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
      const { disposable } = main.register('channel.register', spec.channel, remote)
      return {
        dispose() {
          context.channels.delete(spec.channel)
          disposable.dispose()
        },
      }
    },
    invokeChannel: (channel, payload) => main.call('ipc.invokeChannel', channel, payload),
    sendChannel: (channel, payload) => main.fire('ipc.sendChannel', channel, payload),
    onWindowEvent(channel, handler) {
      const { disposable } = main.register('api', 'ipc.onWindowEvent', channel, handler)
      return () => disposable.dispose()
    },
    isRemoteAccessible: (channel) => main.call('ipc.isRemoteAccessible', channel),
  }
}

function commandsFor(context: HostContext, main: MainCalls): ExtensionAPI['commands'] {
  return {
    register(command, handler) {
      const key = `${context.extensionId}.command.${command.id}`
      context.commands.set(key, { contribution: command, handler })
      const { args, ...crossing } = command
      const { disposable } = main.register('command.register', crossing, args !== undefined)
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
    connections: () => main.call('issues.connections'),
    listMine: (options) => main.call('issues.listMine', options),
    search: (term, options) => main.call('issues.search', term, options),
    get: (tracker, key, options) => main.call('issues.get', tracker, key, options),
    comment: (tracker, key, body) => main.call('issues.comment', tracker, key, body),
    states: (tracker, key) => main.call('issues.states', tracker, key),
    transition: (tracker, key, intent, optionId) =>
      main.call('issues.transition', tracker, key, intent, optionId),
    supportsTransitions: (tracker) => context.snapshot.trackers[tracker]?.transitions ?? false,
    teams: (tracker) => main.call('issues.teams', tracker),
    create: (tracker, input) => main.call('issues.create', tracker, input),
    supportsCreate: (tracker) => context.snapshot.trackers[tracker]?.create ?? false,
  }
}

function githubFor(main: MainCalls): ExtensionAPI['github'] {
  return {
    api: (target, request) => main.call('github.api', target, request),
    pullRequests: {
      view: (target, pullRequest, fields) =>
        main.call('github.pullRequests.view', target, pullRequest, fields),
      list: (target, query) => main.call('github.pullRequests.list', target, query),
      create: (target, input) => main.call('github.pullRequests.create', target, input),
      markReady: (target, pullRequest) =>
        main.call('github.pullRequests.markReady', target, pullRequest),
      updateBranch: (target, pullRequest) =>
        main.call('github.pullRequests.updateBranch', target, pullRequest),
    },
    repositories: {
      view: (target, fields) => main.call('github.repositories.view', target, fields),
      clone: (target, repository, directory) =>
        main.call('github.repositories.clone', target, repository, directory),
    },
  }
}

function windowFor(main: MainCalls): ExtensionAPI['window'] {
  return {
    openAuxiliary: (view, params) => main.fire('window.openAuxiliary', view, params),
    broadcast: (channel, data) => main.fire('window.broadcast', channel, data),
    focusSelf: (viewParam) => main.fire('window.focusSelf', viewParam),
    showSelf: (view) => main.fire('window.showSelf', view),
    raise: () => main.fire('window.raise'),
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
      main.fire(`log.${name}`, message, ...loggable(meta))
  return { debug: level('debug'), info: level('info'), warn: level('warn'), error: level('error') }
}

function globalShortcutFor(main: MainCalls): ExtensionAPI['globalShortcut'] {
  return {
    async register(accelerator, handler) {
      const { disposable, ready } = main.register(
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

type ForwardedMember = 'dialog' | 'shell' | 'notifications' | 'nativeMenu' | 'terminal'

/** The members that are each one call or registration in main, with nothing kept here. */
function forwardedMembersFor(main: MainCalls): Pick<ExtensionAPI, ForwardedMember> {
  return {
    dialog: {
      showOpenDialog: (options) => main.call('dialog.showOpenDialog', options),
      showSaveDialog: (options) => main.call('dialog.showSaveDialog', options),
    },
    shell: {
      exec: ((options) => main.call('shell.exec', options)) as ExtensionAPI['shell']['exec'],
    },
    notifications: {
      showToast: (type, message, key) => main.fire('notifications.showToast', type, message, key),
      createNotification: (options) => main.held('notifications.createNotification', options),
    },
    nativeMenu: { addViewMenuItem: (item) => main.held('nativeMenu.addViewMenuItem', item) },
    terminal: {
      onSessionCreate: (handler) => main.held('terminal.onSessionCreate', handler),
      onSessionClose: (handler) => main.held('terminal.onSessionClose', handler),
    },
  }
}

/**
 * The ExtensionAPI an extension receives in the extension host (ADR 094): the
 * same declaration as main's `api.ts`, each member a call across the port, a
 * read of the snapshot main pushes, or (`db`, `extensions`) answered here.
 */
export function createHostExtensionAPI(context: HostContext): ExtensionAPI {
  const main = new MainCalls(context)
  return {
    ...forwardedMembersFor(main),
    db: context.db,
    paths: context.snapshot.paths,
    extensions: { get: (dependencyId: string) => context.exportsOf(dependencyId) as never },
    log: logFor(main),
    settings: settingsFor(context, main),
    globalShortcut: globalShortcutFor(main),
    workspace: workspaceFor(context, main),
    github: githubFor(main),
    issues: issuesFor(context, main),
    commands: commandsFor(context, main),
    ipc: ipcFor(context, main),
    pty: ptyFor(main),
    window: windowFor(main),
  }
}
