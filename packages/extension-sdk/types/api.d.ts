/**
 * ExtensionAPI — the object passed to `activate(api)` in your extension's backend entry.
 * The core implements exactly this declaration (`src/main/extensions/api.ts`).
 *
 * Since 4.0.0 a backend runs in the extension host, a separate process (ADR 094), and every
 * member crosses a MessagePort: a value the core holds is returned as a promise or kept in a
 * snapshot the core pushes, and a callback is held by the extension host and called by id.
 */

import type { ZodTypeAny } from 'zod'
import type { ChannelSpec } from '../src/index'
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
import type { BuiltInExtensionExports } from './extensions'
import type { GithubAPI } from './github'

export interface Disposable {
  dispose(): void
}

/** Local-only unless `remoteAccessible` is true. */
export interface RegisterHandlerOptions {
  remoteAccessible?: boolean
}

/** Registers `spec.channel`. The payload is parsed with `spec.schema` before `spec.run` sees it;
 * a payload the schema rejects is answered with `spec.invalid` and `run` is not called
 * (ADR 096). */
export type RegisterChannel = (spec: ChannelSpec, opts?: RegisterHandlerOptions) => Disposable

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
  /** `list` holds a `string[]`, edited in Settings one item per line (since 5.0.0). */
  type: 'string' | 'number' | 'boolean' | 'enum' | 'folder' | 'action' | 'list'
  label: string
  description?: string
  default: unknown
  options?: string[]
  min?: number
  max?: number
  /** Workspace Settings can set a value for one workspace, with "Use global default" to hand it
   * back. Read it with `settings.get(key, { repoPath })`. */
  workspaceScoped?: boolean
  secret?: boolean
  channel?: string
  confirmMessage?: string
  danger?: boolean
}

/** Where `settings.get` reads a `workspaceScoped` setting. Since 5.0.0. */
export interface SettingScope {
  /** A path in a workspace: its folder, a project's worktree, or anything below one. The setting
   * resolves to that workspace's own value, else the global one. */
  repoPath?: string
}

/** Which value of an extension setting changed: one workspace's own, or (null) the global one. Since 5.0.0. */
export interface SettingsChange {
  workspaceId: string | null
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
  /** Shape of the `args` another surface may pass when it runs this command (v2.7.0, ADR-083). A
   * command without one never receives args. */
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
  /** Attach this issue to the project as it is created (v2.2.0). When an existing project is
   * returned for the same path, the issue is attached to that project. */
  issue?: { tracker: TrackerId; key: string }
}

export type SessionOrigin = 'app' | 'remote'

export interface SpawnSessionOptions {
  sessionId: string
  cwd: string
  shell: string
  /** Arguments for `shell`. Without them it starts as a login shell, `-l`. Since 4.0.0. */
  args?: string[]
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
  /** Where the tab appears. From `workspace.addProject`, normally. */
  projectId: string
  cwd: string
  tabTitle: string
  /** Marks whose terminal it is. A person can still type in an agent's. */
  type?: 'human' | 'agent'
  shell?: string
  scrollbackLimit?: number
}

/** A program to run as a terminal tab's own process, in place of a shell. Since 4.0.0. */
export interface RunInTerminalInput extends Omit<OpenTerminalTabInput, 'shell'> {
  /** The program, as node-pty's `spawn` takes it. */
  file: string
  args: string[]
}

/** How a `runInTerminal` process ended. */
export interface TerminalExit {
  sessionId: string
  /** The process's exit code. Null when it has none: a signal ended it, which is also what
   * closing its tab before it finished does. Null is never a success. */
  exitCode: number | null
}

export interface PtyManagerAPI {
  /** Spawns a process and a data stream. Throws an error whose `name` is 'MissingCwdError' when
   * `cwd` is not an existing directory. */
  spawnSession(opts: SpawnSessionOptions): Promise<SessionInfo>
  /** Spawns a terminal and puts it on screen as an ordinary tab, holding the process's output
   * until the tab is mounted. Resolves to the session id, or null when there is no window to
   * show it in. Since 4.0.0. */
  openTerminal(input: OpenTerminalTabInput): Promise<string | null>
  /** Runs a program as a new terminal tab's process (nothing typed into a shell) and resolves with
   * how it ended. The tab shows "[exited]" until `closeTerminalTab`. Null, running nothing, when
   * there is no window to show it in. Since 4.0.0. */
  runInTerminal(input: RunInTerminalInput): Promise<TerminalExit | null>
  /** Closes a tab `openTerminal` opened, ending its process if it still runs (v2.6.0). `kill`
   * alone leaves the tab on screen marked "[exited]". */
  closeTerminalTab(sessionId: string): void
  /** The session's output, in batches of at most one per frame (4.0.0). Returns a disposer; a
   * session that does not exist never calls the listener. */
  onData(sessionId: string, listener: (data: string) => void): () => void
  /** Multi-subscriber exit fan-out. Listeners fire after the session is removed, and after the
   * last batch of its output, with the exit code, or null when a signal ended the process
   * (4.0.0). Returns a disposer. */
  onExit(sessionId: string, listener: (exitCode: number | null) => void): () => void
  getSession(sessionId: string): Promise<SessionInfo | undefined>
  /** Stamps workspace metadata on the session (null clears it). False for an unknown session. */
  setWorkspace(sessionId: string, workspaceId: string | null): Promise<boolean>
  write(sessionId: string, data: string): void
  resize(sessionId: string, cols: number, rows: number): void
  kill(sessionId: string): void
  listSessions(): Promise<SessionInfo[]>
}

export interface ShellExecOptions {
  command: 'git' | 'gh'
  args: string[]
  /** Must be, after resolving symlinks, one of the extension's shell roots or below one: a
   * workspace folder, a project worktree, `api.paths.globalStorage`, or the directory a folder
   * setting the manifest declares in `contributes.shellRoots` holds. Since 4.0.0. */
  cwd: string
  /** Default 10 000. When it expires the command is killed and the result is a failure:
   * `timedOut: true` and `exitCode` 124, timeout(1)'s status. */
  timeoutMs?: number
  /** Most bytes of output kept per stream (default 1 MiB). Past it the command is stopped:
   * `exceededMaxBuffer: true` and a non-zero `exitCode`. Since 2.1.0. */
  maxBuffer?: number
  /** Added to the command's environment, over the minimal one every command gets (PATH, HOME,
   * git and gh credentials, `GIT_TERMINAL_PROMPT=0`). Since 2.1.0. */
  env?: Record<string, string>
  /** `'buffer'` returns stdout and stderr as bytes. Since 2.1.0. */
  encoding?: 'utf8' | 'buffer'
  /** Each chunk of stdout and stderr as it arrives, in text mode. Since 2.1.0. */
  onOutput?: (chunk: string) => void
}

/** Output is exactly what the command wrote: text is never trimmed. */
export interface ShellExecResult<Output extends string | Uint8Array = string> {
  exitCode: number
  stdout: Output
  stderr: Output
  timedOut: boolean
  /** Since 2.1.0. */
  exceededMaxBuffer: boolean
}

/** Options for `dialog.showOpenDialog`, a subset of Electron's. Since 4.0.0. */
export interface OpenDialogOptions {
  title?: string
  defaultPath?: string
  buttonLabel?: string
  filters?: Array<{ name: string; extensions: string[] }>
  properties?: Array<'openFile' | 'openDirectory' | 'multiSelections' | 'createDirectory'>
}

/** Options for `dialog.showSaveDialog`, a subset of Electron's. Since 4.0.0. */
export interface SaveDialogOptions {
  title?: string
  defaultPath?: string
  buttonLabel?: string
  filters?: Array<{ name: string; extensions: string[] }>
}

export interface HomeApi {
  /** Replace everything this extension shows on Home. */
  publish(feed: HomeFeed): void
  /** Called when the user presses one of this extension's item actions. */
  onAction(handler: (itemId: string, actionId: string) => Promise<void>): Disposable
}

export interface HomeFeed {
  asks: HomeAsk[]
  facets: ThreadFacet[]
  measures: HomeMeasure[]
  focus?: HomeFocusCandidate[]
}

export interface HomeAsk {
  id: string
  kind: 'answer' | 'fix' | 'review' | 'decide' | 'finished' | 'task'
  title: string
  detail: string
  /** Where it comes from, e.g. "terminator · TAV-20 · pull request #275". */
  where?: string
  facts: string[]
  workKey: WorkKey | null
  /** ISO time. */
  since: string
  /** An action with the id `SEND_TO_AGENT_ACTION` (exported from the SDK) also appears as Send
   * to agent on the failing checks of the work this ask is about. */
  actions: { id: string; label: string; primary?: boolean }[]
  open: { command: string; args?: unknown }
}

export type WorkKey =
  | { tracker: 'linear' | 'jira'; key: string }
  | { repoRoot: string; branch: string }

export interface ThreadFacet {
  workKey: WorkKey
  kind: 'pull-request' | 'order' | 'task'
  stage: 'shaping' | 'building' | 'in-review' | 'merging' | 'shipped'
  whoseMove: 'you' | 'agents' | 'others'
  title?: string
  line: string
  tone: 'neutral' | 'good' | 'bad' | 'waiting'
  url?: string
  /** Where the thread's result is, as buttons on its drawer (since 5.1.0). */
  links?: { label: string; url: string }[]
  closedAt: string | null
  checks?: { name: string; state: 'passed' | 'failed' | 'running'; detail?: string }[]
  /** What a merged pull request's timeline measured (ISO times; minutes for checks). */
  openedAt?: string
  readyAt?: string
  firstReviewAt?: string | null
  checksMinutes?: number | null
  updatedAt: string
}

export interface HomeMeasure {
  /** Home places a measure by id: use a value of `HOME_MEASURES` (exported from the SDK) to be
   * drawn on the Week and Insights cards. Its `question` and `detail` are shown as written. */
  id: string
  question: string
  value: number
  unit: 'count' | 'minutes' | 'days' | 'percent'
  window: 'week' | '30d' | 'quarter' | 'year'
  series: number[]
  previous?: number
  detail?: string
}

export interface HomeFocusCandidate {
  id: string
  title: string
  detail?: string
  workKey: WorkKey | null
  done: boolean
}

export interface ExtensionAPI {
  /** The extension's database. Throws until the app database is initialised. The extension host
   * holds its own connection, so `transaction(fn)` runs `fn` in the extension's own process. */
  db: ExtensionDB
  /** Where the application and this extension's data live on disk. Since 4.0.0. */
  paths: {
    /** The application's own directory (Electron's `app.getAppPath()`). */
    readonly app: string
    /** This extension's own data folder, `<userData>/extensions/<id>`: VS Code's
     * `ExtensionContext.globalStorageUri`, shared by no other extension. It may not exist yet;
     * create it (recursively) before writing into it. */
    readonly globalStorage: string
  }
  /** The operating system's file dialogs, over the focused window. Since 4.0.0. */
  dialog: {
    showOpenDialog(options: OpenDialogOptions): Promise<{ canceled: boolean; filePaths: string[] }>
    showSaveDialog(options: SaveDialogOptions): Promise<{ canceled: boolean; filePath?: string }>
  }
  log: {
    debug(message: string, ...meta: unknown[]): void
    info(message: string, ...meta: unknown[]): void
    warn(message: string, ...meta: unknown[]): void
    error(message: string, ...meta: unknown[]): void
  }
  settings: {
    register(schema: ExtensionSettingsSchema): Disposable
    /** Synchronous: a snapshot the core pushes on every change, which `set` updates at once. With
     * `scope.repoPath` (5.0.0) a `workspaceScoped` setting is that workspace's own value, else the
     * global value, else the schema's default; without a scope, the global value. */
    get<T>(key: string, scope?: SettingScope): T | undefined
    set(key: string, value: unknown): void
    /** Whether a branch matches Settings → Git → Branch Exclude Patterns: the override of the
     * workspace that owns `repoPath`, else the global list. `*` matches anything, slashes
     * included. Since 2.8.0; a promise since 4.0.0. */
    isBranchExcluded(branch: string, repoPath?: string): Promise<boolean>
  }
  globalShortcut: {
    /** Rejects with `ACCELERATOR_TAKEN` when the accelerator is already in use (4.0.0). */
    register(accelerator: string, handler: () => void): Promise<Disposable>
  }
  /** Read from a snapshot the core pushes whenever a workspace or project changes. */
  workspace: {
    list(): WorkspaceSnapshot[]
    listProjects(workspaceId: string): ProjectSnapshot[]
    /** Registers a directory as a project in a workspace, so it appears in the sidebar and can
     * hold terminals. Resolves to the existing project when the workspace already has one for
     * that path; null when it cannot be created. Since 4.0.0. */
    addProject(input: CreateProjectInput): Promise<ProjectSnapshot | null>
    deleteProject(projectId: string): void
  }
  /** Other extensions' APIs, each the value its `activate` returns (since 2.1.0). List the
   * provider in your manifest's `extensionDependencies`: the host activates it first, and fails
   * yours when it is missing, failed, or in a dependency cycle. */
  extensions: {
    /** The provider's `activate` return value. Throws for an id the manifest does not declare. */
    get<K extends keyof BuiltInExtensionExports>(extensionId: K): BuiltInExtensionExports[K]
    get<T = unknown>(extensionId: string): T
  }
  shell: {
    /** Runs git or gh without a shell. Resolves for every outcome of the command; read
     * `exitCode`. Rejects, running nothing, with an error named 'CwdOutOfScopeError' when `cwd`
     * is outside every shell root (since 4.0.0). */
    exec(options: ShellExecOptions & { encoding: 'buffer' }): Promise<ShellExecResult<Uint8Array>>
    exec(options: ShellExecOptions): Promise<ShellExecResult<string>>
  }
  /** GitHub pull requests and API through the gh CLI the core runs. Since 2.1.0. */
  github: GithubAPI
  /** Issue trackers, through the application's single connection (v2.2.0). An extension never
   * holds a tracker credential. Three writes, and only three: a comment, a move in the issue's
   * own workflow, and a new issue the operator asked for. */
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
    /** Move it. `optionId` is the operator's own mapping for this intent, taken from `states()`;
     * without one the tracker resolves the intent itself. Rejects when nothing available
     * satisfies it. */
    transition(
      tracker: TrackerId,
      key: string,
      intent: TransitionIntent,
      optionId?: string
    ): Promise<void>
    /** Whether this tracker supports being moved at all. A fixed fact of the tracker. */
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
  /** Publish what Home should show; core draws it (ADR 117). */
  home: HomeApi
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
    registerHandler: RegisterChannel
    invokeChannel(channel: string, payload: unknown): Promise<unknown>
    sendChannel(channel: string, payload: unknown): void
    onWindowEvent(channel: string, handler: (...args: unknown[]) => void): () => void
    /** A promise since 4.0.0. */
    isRemoteAccessible(channel: string): Promise<boolean>
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
    /** Asks core to bring forward whichever surface this extension registered for `view`
     * (global, workspace, project tab or sidebar panel) and focus it. Core's own "Open
     * <surface>" quick actions use this same path. */
    showSelf(view?: string): void
    /** Restores and focuses every application window. Since 4.0.0. */
    raise(): void
  }
}
