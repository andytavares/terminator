export interface PtyManagerAPI {
  spawn(
    sessionId: string,
    cwd: string,
    shell: string,
    type: 'human' | 'agent',
    onData: (data: string) => void,
    onExit: (code: number | null) => void
  ): string
  write(sessionId: string, data: string): void
  resize(sessionId: string, cols: number, rows: number): void
  kill(sessionId: string): void
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
