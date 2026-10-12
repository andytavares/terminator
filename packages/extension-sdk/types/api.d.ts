/**
 * ExtensionAPI — the object passed to `activate(api)` in your extension's main process entry.
 * This is the server-side (Node.js / Electron main process) API surface.
 */

export interface Disposable {
  dispose(): void
}

export interface ExtensionSettingsSchema {
  label: string
  description?: string
  properties: Record<string, SettingDefinition>
}

export interface SettingDefinition {
  type: 'string' | 'number' | 'boolean' | 'enum' | 'folder' | 'action'
  label: string
  description?: string
  default: unknown
  options?: string[]
  min?: number
  max?: number
  workspaceScoped?: boolean
  secret?: boolean
  channel?: string
  confirmMessage?: string
  danger?: boolean
}

export interface TopBarMenuContribution {
  id: string
  label: string
  onClick(): void
  tooltip?: string
}

export interface NativeMenuItemContribution {
  id: string
  label: string
  onClick(): void
  accelerator?: string
  type?: 'checkbox'
  panelId?: string
}

export type ToastType = 'info' | 'success' | 'warning' | 'error'

export interface SessionSnapshot {
  readonly id: string
  readonly projectId: string
  readonly tabTitle: string
  readonly type: 'human' | 'agent'
}

export interface CommandContribution {
  id: string
  label: string
  description?: string
  shortcut?: string
  category?: string
  mnemonic?: string
  requires?: 'repo' | 'session'
}

export interface CommandContext {
  projectId: string | null
  sessionId: string | null
  repoRoot: string | null
}

export interface WorkspaceSnapshot {
  readonly id: string
  readonly name: string
  readonly folderPath: string
}

export interface ProjectSnapshot {
  readonly id: string
  readonly workspaceId: string
  readonly name: string
  /** The directory it points at, when it is not the workspace folder (v2.5.0). */
  readonly worktreePath?: string
}

export interface PtyManagerAPI {
  write(sessionId: string, data: string): void
  resize(sessionId: string, cols: number, rows: number): void
  kill(sessionId: string): void
  listSessions(): Array<{ sessionId: string; cwd: string }>
}

export interface ExtensionAPI {
  log: {
    debug(message: string, ...meta: unknown[]): void
    info(message: string, ...meta: unknown[]): void
    warn(message: string, ...meta: unknown[]): void
    error(message: string, ...meta: unknown[]): void
  }
  settings: {
    register(schema: ExtensionSettingsSchema): Disposable
    get<T>(key: string): T | undefined
    set(key: string, value: unknown): void
  }
  globalShortcut: {
    register(accelerator: string, handler: () => void): Disposable
  }
  workspace: {
    list(): WorkspaceSnapshot[]
    listProjects(workspaceId: string): ProjectSnapshot[]
  }
  topBar: {
    registerMenuItem(item: TopBarMenuContribution): Disposable
  }
  shell: {
    exec(options: {
      command: 'git' | 'gh'
      args: string[]
      cwd: string
      timeoutMs?: number
    }): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }>
  }
  notifications: {
    /**
     * `key` identifies this specific notification kind (unique within this
     * extension, e.g. 'taskCompleted') so the user can configure its delivery
     * target(s) independently of every other notification this extension
     * sends. Register matching settings via api.settings.register() —
     * `${extensionId}.notify.${key}.system` / `.center` / `.toast` (booleans)
     * — so they appear in this extension's own settings panel.
     */
    showToast(type: ToastType, message: string, key: string): void
    createNotification(opts: {
      type: ToastType
      title: string
      message?: string
      key: string
      actions?: Array<{ id: string; label: string; handler: () => void }>
    }): Disposable
  }
  nativeMenu: {
    addViewMenuItem(item: NativeMenuItemContribution): Disposable
  }
  commands: {
    register(
      command: CommandContribution,
      handler: (ctx: CommandContext) => void | Promise<void>
    ): Disposable
  }
  ipc: {
    registerHandler(
      channel: string,
      handler: (payload: unknown) => Promise<unknown> | unknown
    ): Disposable
    invokeChannel(channel: string, payload: unknown): Promise<unknown>
    sendChannel(channel: string, payload: unknown): void
    onWindowEvent(channel: string, handler: (...args: unknown[]) => void): () => void
    isRemoteAccessible(channel: string): boolean
  }
  terminal: {
    onSessionCreate(handler: (session: Readonly<SessionSnapshot>) => void): Disposable
    onSessionClose(handler: (sessionId: string) => void): Disposable
  }
  pty: PtyManagerAPI
  window: {
    openAuxiliary(view: string, params?: Record<string, string>): void
    broadcast(channel: string, data: unknown): void
    showSelf(view?: string): void
  }
}
