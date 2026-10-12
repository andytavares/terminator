/**
 * ExtensionAPI — the object passed to `activate(api)` in your extension's main process entry.
 * The core implements exactly this declaration (`src/main/extensions/api.ts`).
 */

import type { ZodTypeAny } from 'zod'
import type {
  Issue,
  IssueListResult,
  NewIssueInput,
  TrackerConnection,
  TrackerId,
  TrackerStateOption,
  TrackerTeam,
  TransitionIntent,
} from './issues'

export interface Disposable {
  dispose(): void
}

/** The extension's own SQLite tables. Every call is async and runs in call order. */
export interface ExtensionDB {
  exec(sql: string): Promise<void>
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<T[]>
  get<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<T | undefined>
  /** Returns the number of rows changed. */
  run(sql: string, params?: unknown[]): Promise<number>
  /** Commits when `fn` resolves, rolls back when it rejects. Nested calls use savepoints. */
  transaction<T>(fn: (tx: ExtensionDB) => Promise<T>): Promise<T>
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
  /** When set to 'checkbox', renders as a checkable menu item. */
  type?: 'checkbox'
  /** Panel ID that this menu item toggles. Used to update the checked state when the panel opens/closes. */
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
  /** One-character mnemonic shown in the quick-actions panel. */
  mnemonic?: string
  /** Dims the action, with a stock reason, when the focused context lacks this. */
  requires?: 'repo' | 'session'
  /**
   * Shape of the `args` another surface may pass when it runs this command
   * (v2.7.0, ADR-083). A command without one never receives args.
   */
  args?: ZodTypeAny
}

/** Core-owned focus context, passed outbound to a command's handler. */
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

export interface CreateProjectInput {
  workspaceId: string
  name: string
  /** The directory the project points at — a worktree, or any checkout. */
  worktreePath: string
  gitBranch?: string
  /** True when the directory is a git worktree rather than a plain folder. */
  isWorktree?: boolean
  /**
   * Attach this issue to the project as it is created (v2.2.0). When an
   * existing project is returned for the same path, the issue is attached to
   * that project.
   */
  issue?: { tracker: TrackerId; key: string }
}

export type SessionOrigin = 'app' | 'remote'

export interface SpawnSessionOptions {
  sessionId: string
  cwd: string
  shell: string
  type: 'human' | 'agent'
  origin: SessionOrigin
  projectId?: string
  tabTitle?: string
  /** Withhold output until a listener attaches through `onData`. */
  holdOutput?: boolean
  /** Added to the child's environment, on top of the parent's. */
  env?: Record<string, string>
}

export interface SessionInfo {
  sessionId: string
  cwd: string
  type: 'human' | 'agent'
  origin: SessionOrigin
  createdAt: string
  pid: number
  projectId?: string
  tabTitle?: string
  workspaceId?: string
}

export interface OpenTerminalTabInput {
  /** Where the tab appears. From `workspace.createProject`, normally. */
  projectId: string
  cwd: string
  tabTitle: string
  /** Marks whose terminal it is. A person can still type in an agent's. */
  type?: 'human' | 'agent'
  shell?: string
  scrollbackLimit?: number
}

export interface PtyManagerAPI {
  /**
   * Spawns a process and a data stream. Throws an error whose `name` is
   * 'MissingCwdError' when `cwd` is not an existing directory.
   */
  spawnSession(opts: SpawnSessionOptions): SessionInfo
  /**
   * Spawns a terminal and puts it on screen as an ordinary tab, holding the
   * process's output until the tab is mounted. Returns the session id, or
   * null when there is no window to show it in.
   */
  openTerminalTab(input: OpenTerminalTabInput): string | null
  /**
   * Closes a tab `openTerminalTab` opened, ending its process if it still runs
   * (v2.6.0). `kill` alone leaves the tab on screen marked "[exited]".
   */
  closeTerminalTab(sessionId: string): void
  /** Multi-subscriber output fan-out. Returns a disposer, or null if unknown. */
  onData(sessionId: string, listener: (data: string) => void): (() => void) | null
  /** Multi-subscriber exit fan-out. Listeners fire after the session is removed. */
  onExit(sessionId: string, listener: (exitCode: number) => void): (() => void) | null
  getSession(sessionId: string): SessionInfo | undefined
  /** Stamps workspace metadata on the session (null clears it). */
  setWorkspace(sessionId: string, workspaceId: string | null): boolean
  write(sessionId: string, data: string): void
  resize(sessionId: string, cols: number, rows: number): void
  kill(sessionId: string): void
  listSessions(): SessionInfo[]
}

export interface ExtensionAPI {
  /** The extension's database. Throws until the app database is initialised. */
  db: ExtensionDB
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
    /**
     * Whether a branch matches Settings → Git → Branch Exclude Patterns: the
     * override of the workspace that owns `repoPath`, else the global list.
     * `*` matches anything, slashes included. Since 2.8.0.
     */
    isBranchExcluded(branch: string, repoPath?: string): boolean
  }
  globalShortcut: {
    /** Throws `ACCELERATOR_TAKEN` when the accelerator is already in use. */
    register(accelerator: string, handler: () => void): Disposable
  }
  workspace: {
    list(): WorkspaceSnapshot[]
    listProjects(workspaceId: string): ProjectSnapshot[]
    /**
     * Registers a directory as a project in a workspace, so it appears in the
     * sidebar and can hold terminals. Returns the existing project when the
     * workspace already has one for that path; null when it cannot be created.
     */
    createProject(input: CreateProjectInput): ProjectSnapshot | null
    deleteProject(projectId: string): void
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
  /**
   * Issue trackers, through the application's single connection (v2.2.0). An
   * extension never holds a tracker credential. Three writes, and only three:
   * a comment, a move in the issue's own workflow, and a new issue the
   * operator asked for.
   */
  issues: {
    /** Connected trackers and whose account each credential proved to be. Never a secret. */
    connections(): Promise<TrackerConnection[]>
    /** "My issues" across connected trackers. Per-tracker failures are reported, not thrown. */
    listMine(opts?: { tracker?: TrackerId; limit?: number }): Promise<IssueListResult>
    /** Full-text search. An exact issue key resolves directly and sorts first. */
    search(term: string, opts?: { tracker?: TrackerId; limit?: number }): Promise<IssueListResult>
    /** One issue; description and comments are markdown whichever tracker it came from. */
    get(tracker: TrackerId, key: string, opts?: { refresh?: boolean }): Promise<Issue | null>
    /** Comment on an issue. Rejects on failure. */
    comment(tracker: TrackerId, key: string, body: string): Promise<void>
    /** What this issue can be moved to. Per-issue: the answer may depend on its current status. */
    states(tracker: TrackerId, key: string): Promise<TrackerStateOption[]>
    /**
     * Move it. `optionId` is the operator's own mapping for this intent, taken
     * from `states()`; without one the tracker resolves the intent itself.
     * Rejects when nothing available satisfies it.
     */
    transition(
      tracker: TrackerId,
      key: string,
      intent: TransitionIntent,
      optionId?: string
    ): Promise<void>
    /** Whether this tracker supports being moved at all. */
    supportsTransitions(tracker: TrackerId): boolean
    /** Teams the operator can file an issue in. */
    teams(tracker: TrackerId): Promise<TrackerTeam[]>
    /** File a new issue, only on the operator's explicit word. Rejects on failure. */
    create(tracker: TrackerId, input: NewIssueInput): Promise<Issue>
    /** Whether this tracker can create an issue at all. */
    supportsCreate(tracker: TrackerId): boolean
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
      /** Takes the operator to what this is about. Without one the row is not clickable. */
      onClick?: () => void
    }): Disposable
  }
  nativeMenu: {
    addViewMenuItem(item: NativeMenuItemContribution): Disposable
  }
  commands: {
    register(
      command: CommandContribution,
      handler: (ctx: CommandContext, args?: never) => void | Promise<void>
    ): Disposable
  }
  ipc: {
    /** Local-only unless `opts.remoteAccessible` is true. */
    registerHandler(
      channel: string,
      handler: (payload: unknown) => Promise<unknown> | unknown,
      opts?: { remoteAccessible?: boolean }
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
    /** Focuses this extension's view `viewParam` (default 'main') where it is already open. */
    focusSelf(viewParam?: string): void
    /**
     * Asks core to bring forward whichever surface this extension registered
     * for `view` (global, workspace, project tab or sidebar panel) and focus
     * it. Core's own "Open <surface>" quick actions use this same path.
     */
    showSelf(view?: string): void
  }
}
