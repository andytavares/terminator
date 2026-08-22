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
