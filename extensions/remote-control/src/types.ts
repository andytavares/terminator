export type SessionOrigin = 'app' | 'remote'

export interface SpawnSessionOptions {
  sessionId: string
  cwd: string
  shell: string
  type: 'human' | 'agent'
  origin: SessionOrigin
  projectId?: string
  tabTitle?: string
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

// Mirrors the v1.4.0 session-authority surface of the core PtyManagerAPI
// (ExtensionAPI contract). PtyManager owns all session state; this extension
// keeps no session registry of its own.
export interface PtyManagerAPI {
  spawnSession(opts: SpawnSessionOptions): SessionInfo
  onData(sessionId: string, listener: (data: string) => void): (() => void) | null
  onExit(sessionId: string, listener: (exitCode: number) => void): (() => void) | null
  getSession(sessionId: string): SessionInfo | undefined
  setWorkspace(sessionId: string, workspaceId: string | null): boolean
  write(sessionId: string, data: string): void
  resize(sessionId: string, cols: number, rows: number): void
  kill(sessionId: string): void
  listSessions(): SessionInfo[]
}

export interface WorkspaceSnapshot {
  id: string
  name: string
  folderPath: string
  color: string
  tags: string[]
}

export interface ProjectSnapshot {
  id: string
  workspaceId: string
  name: string
  gitBranch?: string
  worktreePath?: string
  isWorktree: boolean
}
