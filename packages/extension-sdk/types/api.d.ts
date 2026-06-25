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

export type PanelSlot = 'right-sidebar' | 'global-tab'

export interface PanelContribution {
  id: string
  title: string
  component: unknown
  defaultVisible?: boolean
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

export interface FsChangeEvent {
  projectRoot: string
  eventType: 'change' | 'rename'
  filename: string | null
}

export type ToastType = 'info' | 'success' | 'warning' | 'error'

export interface SidebarContribution {
  id: string
  label: string
  tooltip?: string
  onClick(): void
}

export type ContextMenuTarget = 'workspace' | 'project' | 'tab' | 'terminal'

export interface MenuItemContribution {
  id: string
  label: string
  onClick(targetId: string): void
}

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
}

export interface GlobalTabContribution {
  id: string
  label: string
  icon?: string
  component: unknown
  permanent?: boolean
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
}

export interface PtyManagerAPI {
  spawn(
    sessionId: string,
    cwd: string,
    shell: string,
    type: 'human' | 'agent',
    onData: (data: string) => void,
    onExit: (exitCode: number) => void
  ): string
  write(sessionId: string, data: string): void
  resize(sessionId: string, cols: number, rows: number): void
  kill(sessionId: string): void
  listSessions(): Array<{ sessionId: string; cwd: string }>
  attachOnData(sessionId: string, onData: (data: string) => void): (() => void) | null
  attachOnExit(sessionId: string, onExit: (exitCode: number) => void): (() => void) | null
}

export interface ExtensionAPI {
  readonly app: { readonly version: string }
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
  sidebar: {
    registerItem(item: SidebarContribution): Disposable
    registerPanel(slot: PanelSlot, panel: PanelContribution): Disposable
    registerGlobalTab(tab: GlobalTabContribution): Disposable
  }
  globalShortcut: {
    register(accelerator: string, handler: () => void): Disposable
  }
  workspace: {
    list(): WorkspaceSnapshot[]
    listProjects(workspaceId: string): ProjectSnapshot[]
    onDelete(handler: (workspaceId: string) => void): Disposable
    onProjectDelete(handler: (projectId: string) => void): Disposable
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
    showToast(type: ToastType, message: string): void
    createNotification(opts: {
      type: ToastType
      title: string
      message?: string
      targets?: Array<'system' | 'center' | 'toast'>
      actions?: Array<{ id: string; label: string; handler: () => void }>
    }): Disposable
  }
  nativeMenu: {
    addViewMenuItem(item: NativeMenuItemContribution): Disposable
  }
  fs: {
    watch(handler: (event: FsChangeEvent) => void): Disposable
  }
  contextMenu: {
    registerItem(target: ContextMenuTarget, item: MenuItemContribution): Disposable
  }
  keyboard: {
    register(accelerator: string, handler: () => void): Disposable
  }
  commands: {
    register(command: CommandContribution, handler: () => void): Disposable
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
  }
}
