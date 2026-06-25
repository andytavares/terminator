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
