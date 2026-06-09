import type {
  Workspace,
  Project,
  GlobalSettings,
  WorkspaceSettings,
  Extension,
  Branch,
  WorktreeInfo,
  SystemMetrics,
  ProcessMetrics,
} from '../shared/types/index'

export interface SerializedNotification {
  id: string
  type: 'info' | 'success' | 'warning' | 'error'
  title: string
  message?: string
  timestamp: number
  source?: string
  actions?: Array<{ id: string; label: string }>
}

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
    createBranch(path: string, branch: string): Promise<{ success: true } | { error: string }>
    suggestWorktreePath(
      repoRoot: string,
      branch: string,
      baseDir?: string
    ): Promise<{ path: string }>
    createWorktree(payload: unknown): Promise<{ success: true } | { error: string }>
    removeWorktree(
      repoRoot: string,
      worktreePath: string
    ): Promise<{ success: true } | { error: string }>
    listWorktrees(path: string): Promise<{ worktrees: WorktreeInfo[] }>
  }
  shell: {
    exec(options: {
      command: 'git' | 'gh'
      args: string[]
      cwd: string
      timeoutMs?: number
      workspaceRoot?: string
    }): Promise<
      { exitCode: number; stdout: string; stderr: string; timedOut: boolean } | { error: string }
    >
    openPath(filePath: string): Promise<{ ok: true } | { error: string }>
    openExternal(url: string): Promise<{ ok: true } | { error: string }>
  }
  fs: {
    watchStart(projectRoot: string): Promise<{ ok: true } | { error: string }>
    watchStop(): Promise<{ ok: true }>
    onChanged(
      handler: (event: { projectRoot: string; eventType: string; filename: string | null }) => void
    ): () => void
    readFile(filePath: string): Promise<{ content: string } | { error: string }>
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
    uninstall(id: string): Promise<{ ok: true } | { error: string }>
    reload(id: string): Promise<{ extension: Extension } | { error: string }>
    getSettingsSchemas(): Promise<{
      schemas: Array<{
        extensionId: string
        label: string
        properties: Record<
          string,
          {
            type: string
            label: string
            description?: string
            default: unknown
            secret?: boolean
            options?: string[]
            min?: number
            max?: number
          }
        >
      }>
    }>
    getSettingsValues(): Promise<{ values: Record<string, unknown> }>
    updateSetting(key: string, value: unknown): Promise<{ ok: true }>
    getSidebarItems(): Promise<{ items: Array<{ id: string; label: string; tooltip?: string }> }>
    getContextMenuItems(target: string): Promise<{ items: Array<{ id: string; label: string }> }>
    contextMenuClick(target: string, itemId: string, targetId: string): void
    getCommands(): Promise<{
      commands: Array<{
        key: string
        id: string
        label: string
        description?: string
        shortcut?: string
        category?: string
      }>
    }>
    executeCommand(key: string): void
  }
  keyboard: {
    isReserved(accelerator: string): boolean
  }
  extensionEvents: {
    onToast(handler: (payload: { type: string; message: string }) => void): () => void
    onTogglePanel(handler: (panelId: string) => void): () => void
    onSelectProjectTab(handler: (tabId: string) => void): () => void
    onMenuOpenSettings(handler: () => void): () => void
    onMenuToggleSidebar(handler: () => void): () => void
    onMenuCloseTab(handler: () => void): () => void
    onMenuOpenAbout(handler: () => void): () => void
  }
  app: {
    getInfo(): Promise<{
      appName: string
      version: string
      electronVersion: string
      nodeVersion: string
      chromeVersion: string
      platform: string
    }>
  }
  notification: {
    show(title: string, body: string): void
  }
  notifications: {
    list(): Promise<SerializedNotification[]>
    dismiss(id: string): Promise<{ ok: true } | { error: string }>
    triggerAction(notifId: string, actionId: string): Promise<{ ok: true } | { error: string }>
    onPush(handler: (n: SerializedNotification) => void): () => void
  }
  metrics: {
    getSystem(): Promise<{ data: SystemMetrics } | { error: string }>
    getProcesses(pids: number[]): Promise<{ data: ProcessMetrics[] } | { error: string }>
    getPids(
      sessionIds: string[]
    ): Promise<{ data: Array<{ sessionId: string; pid: number }> } | { error: string }>
  }
  logger: {
    write(level: string, namespace: string, message: string): void
  }
  extensionBridge: {
    invoke(channel: string, payload?: unknown): Promise<unknown>
    on(channel: string, handler: (data: unknown) => void): () => void
  }
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
