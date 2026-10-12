export type { NotificationTarget } from '../notifications/resolve-targets'
import type { NotificationTarget, NotificationType } from '../notifications/resolve-targets'

export interface NotificationAction {
  id: string
  label: string
}

/** A notification as the main process sends it to the renderer. */
export interface SerializedNotification {
  id: string
  type: NotificationType
  title: string
  message?: string
  timestamp: number
  source?: string
  actions?: NotificationAction[]
  /** Whether clicking the row goes anywhere. False for a bare report. */
  clickable?: boolean
  targets: NotificationTarget[]
}

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

type SessionStatus = 'active' | 'backgrounded' | 'closed'
type SessionType = 'human' | 'agent'

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
  /** The shell the main process spawned. Absent for adopted sessions, whose shell is not reported. */
  shell?: string
  /** The last non-empty visible row at the last busy → idle (renderer-side view state). */
  latestLine?: string
  /** A numbered-choice prompt read off the visible screen at the last busy → idle (renderer-side view state). */
  choicePrompt?: ChoicePrompt
}

/** One option in a numbered-choice prompt, numbered as on screen. */
export interface ChoiceOption {
  number: number
  label: string
}

/** A numbered-choice question an agent is showing, as parsed from the terminal screen. */
export interface ChoicePrompt {
  question: string
  options: ChoiceOption[]
}

type ExtensionStatus = 'enabled' | 'disabled' | 'error'

interface ExtensionSurfaceContribution {
  label: string
  icon?: string
  view?: string
  defaultOpen?: boolean
}

interface ExtensionContributes {
  globalTab?: ExtensionSurfaceContribution
  workspaceTab?: ExtensionSurfaceContribution
  projectTab?: ExtensionSurfaceContribution
  sidebarPanel?: ExtensionSurfaceContribution
  windowViews?: Array<{ id: string; view: string }>
  commands?: Array<{
    id: string
    label: string
    shortcut?: string
    description?: string
    mnemonic?: string
    requires?: 'repo' | 'session'
  }>
  quickActions?: { group?: { mnemonic?: string; label: string } }
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

export type {
  ActionUsage,
  CustomAction,
  CustomActionKind,
  CustomActionTarget,
  DirectUse,
  GlobalSettings,
  QuickActionsSettings,
  WorkspaceSettings,
} from '../schemas/settings.schema'

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

import type { TrackerId } from '@terminator/extension-sdk'

export type {
  TrackerId,
  TrackerErrorKind,
  MineSelector,
  TrackerAccount,
  TrackerConnection,
  IssueStateType,
  IssueState,
  IssueComment,
  IssueSummary,
  Issue,
  IssueLink,
  TrackerFailure,
  IssueListResult,
} from '@terminator/extension-sdk'

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

/** A ticket in a connected tracker, by key alone. */
export interface WorkItemRef {
  tracker: TrackerId
  key: string
}

/**
 * The facts about a session that are copied into its record, so a closed
 * session still reads correctly after its project or workspace is gone.
 */
export interface SessionSnapshot {
  sessionId: string
  projectId: string
  workspaceName: string | null
  projectName: string | null
  branch: string | null
  tabTitle: string
  shell: string | null
  startedAt: string
}

/** Agents whose conversations can be brought back by id. */
export type AgentProvider = 'claude'

/**
 * One agent conversation, as the agent itself reported it.
 *
 * `sessionId` is the agent's own identifier and survives resuming; the
 * transcript is the agent's file, and its existence is what makes the
 * conversation resumable on this machine.
 */
export interface AgentConversation {
  provider: AgentProvider
  sessionId: string
  transcriptPath: string
  cwd: string
  capturedAt: string
}

/**
 * The retained context of one session: the operator's description of it, its
 * own work item link, and the agent conversation that ran in it. Exists while
 * any of the three is set, and for 30 days after the session closes.
 */
export interface SessionRecord extends SessionSnapshot {
  description: string | null
  link: WorkItemRef | null
  agent: AgentConversation | null
  updatedAt: string
  closedAt?: string
}

/** A record as a surface reads it: with whether its conversation can be brought back now. */
export interface SessionRecordListing extends SessionRecord {
  resumable: boolean
}
