import type {
  Workspace,
  Project,
  GlobalSettings,
  WorkspaceSettings,
  Extension,
  Branch,
  WorktreeInfo,
} from '../shared/types/index'

interface ElectronAPI {
  terminal: {
    create(payload: unknown): Promise<{ sessionId: string } | { error: string }>
    close(sessionId: string): Promise<{ success: boolean }>
    input(sessionId: string, data: string): void
    resize(sessionId: string, cols: number, rows: number): void
    onOutput(handler: (sessionId: string, data: string) => void): () => void
    closeAll(): Promise<{ terminatedCount: number }>
    cleanupOrphans(): Promise<{ cleanedCount: number }>
    onProcessExit(handler: (sessionId: string, exitCode: number) => void): () => void
  }
  workspace: {
    list(): Promise<{ workspaces: Workspace[] }>
    create(payload: unknown): Promise<{ workspace: Workspace } | { error: string }>
    update(payload: unknown): Promise<{ workspace: Workspace } | { error: string }>
    delete(id: string): Promise<{ success: boolean }>
    reorder(ids: string[]): Promise<{ success: boolean }>
  }
  project: {
    list(workspaceId: string): Promise<{ projects: Project[] }>
    create(payload: unknown): Promise<{ project: Project } | { error: string }>
    delete(id: string): Promise<{ success: boolean }>
    updateBranch(id: string, gitBranch: string): Promise<{ project: Project } | { error: string }>
    rename(id: string, name: string): Promise<{ project: Project } | { error: string }>
    reorder(workspaceId: string, ids: string[]): Promise<{ success: boolean }>
  }
  git: {
    isRepo(path: string): Promise<{ isRepo: boolean; root?: string }>
    currentBranch(path: string): Promise<{ branch: string } | { error: string }>
    listBranches(path: string): Promise<{ branches: Branch[] }>
    checkout(path: string, branch: string): Promise<{ success: true } | { error: string }>
    suggestWorktreePath(repoRoot: string, branch: string, baseDir?: string): Promise<{ path: string }>
    createWorktree(payload: unknown): Promise<{ success: true } | { error: string }>
    removeWorktree(repoRoot: string, worktreePath: string): Promise<{ success: true } | { error: string }>
    listWorktrees(path: string): Promise<{ worktrees: WorktreeInfo[] }>
  }

  settings: {
    getGlobal(): Promise<{ settings: GlobalSettings }>
    updateGlobal(patch: unknown): Promise<{ settings: GlobalSettings }>
    getWorkspace(workspaceId: string): Promise<{ settings: WorkspaceSettings }>
    updateWorkspace(workspaceId: string, patch: unknown): Promise<{ settings: WorkspaceSettings }>
  }
  dialog: {
    openDirectory(): Promise<{ filePath: string } | { cancelled: true }>
  }
  extension: {
    list(): Promise<{ extensions: Extension[] }>
    install(directoryPath: string): Promise<{ extension: Extension } | { error: string }>
    toggle(id: string, enabled: boolean): Promise<{ extension: Extension } | { error: string }>
    getSidebarItems(): Promise<{ items: Array<{ id: string; label: string; tooltip?: string }> }>
    getContextMenuItems(target: string): Promise<{ items: Array<{ id: string; label: string }> }>
    contextMenuClick(target: string, itemId: string, targetId: string): void
  }
  keyboard: {
    isReserved(accelerator: string): boolean
  }
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
