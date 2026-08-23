export type { NotificationTarget, NotificationType } from '../notifications/resolve-targets'
import type { NotificationTarget } from '../notifications/resolve-targets'

export interface Workspace {
  id: string
  name: string
  folderPath: string
  color: string
  tags: string[]
  createdAt: string
  updatedAt: string
}

export interface Project {
  id: string
  workspaceId: string
  name: string
  /** Git branch this project tracks. Undefined for non-git projects. */
  gitBranch?: string
  /** Filesystem path for this project's working tree. Defaults to workspace.folderPath. */
  worktreePath?: string
  /** True when this project was created as a git worktree (branch is fixed). */
  isWorktree: boolean
  createdAt: string
  updatedAt: string
}

export interface Branch {
  name: string
  isCurrent: boolean
  isRemote: boolean
}

export interface WorktreeInfo {
  path: string
  branch: string
  isMain: boolean
  head: string
}

export type SessionStatus = 'active' | 'backgrounded' | 'closed'
export type SessionType = 'human' | 'agent'

/**
 * What a session appears to be doing. Derived on read from the bell, byte-flow
 * and exit signals — see src/renderer/sidebar/agent-state.ts. `awaiting-input`
 * is a heuristic and under-reports: core cannot consume an extension's agent
 * hooks, and a shell-launched agent emits none.
 */
export type AgentState = 'working' | 'awaiting-input' | 'idle' | 'exited'

export interface TerminalSession {
  id: string
  projectId: string
  tabTitle: string
  status: SessionStatus
  type: SessionType
  scrollbackLimit: number
  createdAt: string
  closedAt?: string
  parentSessionId?: string
  /** Unseen bell rings for this session (renderer-side view state). */
  bellCount?: number
  /** True while output is streaming (renderer-side view state). */
  busy?: boolean
  /**
   * Epoch ms of the last PTY output. Renderer-side view state, never
   * serialised — epoch ms rather than the ISO strings used by createdAt and
   * closedAt because it is compared against Date.now() on every row render.
   */
  lastActivityAt: number
  /** Epoch ms of when this session last became the visible one (renderer-side view state). */
  lastAttendedAt?: number
  /** Derived from bell/busy/exit, never stored authoritatively (renderer-side view state). */
  agentState: AgentState
  /** Optional single-line user note: one line, at most 120 chars (renderer-side view state). */
  note?: string
}

export type ExtensionStatus = 'enabled' | 'disabled' | 'error'

export interface ExtensionSurfaceContribution {
  label: string
  icon?: string
  view?: string
  defaultOpen?: boolean
}

export interface ExtensionContributes {
  globalTab?: ExtensionSurfaceContribution
  workspaceTab?: ExtensionSurfaceContribution
  projectTab?: ExtensionSurfaceContribution
  sidebarPanel?: ExtensionSurfaceContribution
  windowViews?: Array<{ id: string; view: string }>
  commands?: Array<{ id: string; label: string; shortcut?: string; description?: string }>
}

export interface Extension {
  id: string
  name: string
  version: string
  description: string
  entryPoint: string
  status: ExtensionStatus
  installedAt: string
  errorMessage?: string
  /** ext:// URL for the extension's renderer entry point, if the manifest declares one. */
  rendererUrl?: string
  /** Parsed contributes block from manifest.json, if present. */
  contributes?: ExtensionContributes
}

export interface ExtensionManifest {
  id: string
  name: string
  version: string
  description: string
  main: string
  renderer?: string
  minAppVersion: string
}

export interface GlobalSettings {
  appearance: {
    theme: 'dark' | 'light'
  }
  terminal: {
    scrollbackLimit: number
    defaultShell: string
    promptForName: boolean
  }
  git: {
    /** Base directory for new worktrees. Empty string means <repoRoot>/.worktrees. */
    worktreeBaseDir: string
    branchExcludePatterns: string[]
  }
  extensions: {
    [extensionId: string]: Record<string, unknown>
  }
  ui: {
    hasSeenWelcome: boolean
    showMetricsBar?: boolean
  }
  sidebar?: {
    /** How long a quiet session waits before the sidebar treats it as stale. */
    staleAfterMs: number
  }
  notifications: {
    defaultTargets: NotificationTarget[]
    overrides: {
      [notificationKey: string]: NotificationTarget[]
    }
  }
}

export interface WorkspaceSettings {
  workspaceId: string
  overrides: Partial<Omit<GlobalSettings, 'extensions'>>
  extensions: {
    [extensionId: string]: Record<string, unknown>
  }
}

export type SettingsScope = 'global' | 'workspace'

export interface SystemMetrics {
  cpuPercent: number
  memUsedBytes: number
  memTotalBytes: number
  netInBytesPerSec: number
  netOutBytesPerSec: number
}

export interface ProcessMetrics {
  pid: number
  cpuPercent: number
  rssBytes: number
}

export type PaneSplitDirection = 'horizontal' | 'vertical'

export type PaneNode =
  | { type: 'leaf'; sessionId: string }
  | {
      type: 'split'
      id: string
      direction: PaneSplitDirection
      ratio: number
      first: PaneNode
      second: PaneNode
    }

export const SCRATCH_PROJECT_ID = '00000000-0000-0000-0000-000000000000'

// ── Issue tracker integrations (feature 031) ─────────────────────────────────
//
// One shape for every tracker. A provider converts its tracker's wire format
// into these types and nothing downstream knows which tracker it came from —
// except where the operator needs to be told, which is why `tracker` is on
// every issue, link and connection.

export type TrackerId = 'linear' | 'jira'

/**
 * Two trackers can issue the same key (`TAV-42` in both), so nothing in this
 * feature is identified by key alone. This pair is the identity.
 */
export interface IssueRef {
  tracker: TrackerId
  key: string
}

export type TrackerErrorKind =
  | 'not-connected'
  | 'auth-failed'
  | 'rate-limited'
  | 'unavailable'
  | 'not-found'
  | 'failed'

/**
 * How "my issues" is defined, per tracker. Tracker-shaped rather than
 * flattened: Linear identifies an assignee directly, Jira expresses it as a
 * saved query, and pretending those are the same loses information.
 */
export type MineSelector =
  | { kind: 'assignee'; email: string | null }
  | { kind: 'query'; jql: string }

export interface TrackerAccount {
  name: string
  email: string
}

/** What the renderer is told about a tracker. Never carries the secret. */
export interface TrackerConnection {
  tracker: TrackerId
  connected: boolean
  /** Proof the credential was verified — absent means it never was. */
  account: TrackerAccount | null
  /** Jira only: the site domain. Always null for Linear. */
  site: string | null
  mine: MineSelector
  /** Set when a credential that worked starts failing. */
  lastError: TrackerErrorKind | null
}

export type IssueStateType = 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled'

export interface IssueState {
  /** The tracker's own label, displayed as-is. */
  name: string
  /** What the UI reasons about — never the colour. */
  type: IssueStateType
}

export interface IssueComment {
  author: string
  /** Markdown, normalised the same way as a description. */
  body: string
  createdAt: string
}

/** The subset lists and pickers need. No description, no comments. */
export interface IssueSummary {
  tracker: TrackerId
  /** The tracker's own stable id — a UUID for Linear, a numeric string for Jira. */
  id: string
  key: string
  title: string
  url: string
  state: IssueState
  assignee: TrackerAccount | null
  /**
   * The tracker's suggested VCS branch. Always null for Jira.
   *
   * On the summary rather than only the full issue because the new-project
   * dialog prefills a branch straight from a picked row, and Linear returns
   * this on the same query the list already makes — fetching the whole issue
   * again just to read one string would be a request for nothing.
   */
  branchName: string | null
}

export interface Issue extends IssueSummary {
  /** Always markdown. Jira's ADF is converted before it reaches this type. */
  description: string
  labels: string[]
  completed: boolean
  updatedAt: string
  /** Most recent first, bounded — a long thread is read in the tracker. */
  comments: IssueComment[]
}

/** A project's attachment to exactly one issue. */
export interface IssueLink {
  projectId: string
  tracker: TrackerId
  key: string
  injectContext: boolean
  linkedAt: string
}

/** Derived, never authored. Rebuilt when the link, issue, or toggle changes. */
export interface AgentContext {
  projectId: string
  tracker: TrackerId
  key: string
  /** Exactly what a session receives, and what the drawer previews. */
  markdown: string
  chars: number
  truncated: boolean
  builtAt: string
}

export interface TrackerFailure {
  tracker: TrackerId
  error: TrackerErrorKind
}

/**
 * A tracker that fails does not fail the call. Callers show what arrived and
 * say what is missing, rather than presenting a partial list as complete.
 */
export interface IssueListResult {
  issues: IssueSummary[]
  failures: TrackerFailure[]
}
