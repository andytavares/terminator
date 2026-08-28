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
  NotificationTarget,
  AgentContext,
  Issue,
  IssueLink,
  IssueListResult,
  MineSelector,
  TrackerConnection,
  TrackerId,
} from '../shared/types/index'
import type { ChangeStats } from '../shared/schemas/git.schema'

export type { NotificationTarget }

export interface SerializedNotification {
  id: string
  type: 'info' | 'success' | 'warning' | 'error'
  title: string
  message?: string
  timestamp: number
  source?: string
  actions?: Array<{ id: string; label: string }>
  /** Whether clicking the row goes anywhere. False for a bare report. */
  clickable?: boolean
  targets: NotificationTarget[]
}

interface ElectronAPI {
  terminal: {
    create(payload: unknown): Promise<{ sessionId: string } | { error: string }>
    close(sessionId: string): Promise<{ success: boolean }>
    /** Says a terminal is on screen; delivers anything held back until now. */
    attach(sessionId: string): Promise<{ released: boolean }>
    input(sessionId: string, data: string): void
    resize(sessionId: string, cols: number, rows: number): void
    onOutput(handler: (sessionId: string, data: string) => void): () => void
    closeAll(): Promise<{ terminatedCount: number }>
    cleanupOrphans(): Promise<{ cleanedCount: number }>
    onProcessExit(handler: (sessionId: string, exitCode: number) => void): () => void
    listSessions(): Promise<
      Array<{ sessionId: string; projectId: string; tabTitle: string; type: string }>
    >
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
    onAdded(handler: (project: Project) => void): () => void
    onRemoved(handler: (id: string) => void): () => void
  }
  git: {
    isRepo(path: string): Promise<{ isRepo: boolean; root?: string }>
    currentBranch(path: string): Promise<{ branch: string } | { error: string }>
    listBranches(path: string): Promise<{ branches: Branch[] }>
    changeStats(path: string): Promise<ChangeStats | { error: string }>
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
            channel?: string
            confirmMessage?: string
            danger?: boolean
          }
        >
      }>
    }>
    getSettingsValues(): Promise<{ values: Record<string, unknown> }>
    updateSetting(key: string, value: unknown): Promise<{ ok: true }>
    getSidebarItems(): Promise<{ items: Array<{ id: string; label: string; tooltip?: string }> }>
    sidebarItemClick(itemId: string): Promise<{ ok: boolean }>
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
    updatePanelBounds(payload: {
      extensionId: string
      viewParam: string
      bounds: { x: number; y: number; width: number; height: number }
      visible: boolean
      repoRoot?: string | null
    }): Promise<void>
    setBottomInset(inset: number): void
    setLeftInset(inset: number): void
  }
  keyboard: {
    isReserved(accelerator: string): boolean
  }
  extensionEvents: {
    onTogglePanel(handler: (panelId: string) => void): () => void
    onSelectProjectTab(handler: (tabId: string) => void): () => void
    onMenuOpenSettings(handler: () => void): () => void
    onMenuToggleSidebar(handler: () => void): () => void
    onMenuCloseTab(handler: () => void): () => void
    onMenuOpenAbout(handler: () => void): () => void
    notifyPanelState(panelId: string, open: boolean): void
    onExtensionPanelLoaded(handler: (id: string) => void): () => void
    onExtensionRendererReload(handler: (id: string) => void): () => void
    onExtensionExitToTerminal(
      handler: (payload: { extensionId: string; sidebarPanelId: string | null }) => void
    ): () => void
  }
  app: {
    getInfo(): Promise<{
      appName: string
      version: string
      electronVersion: string
      nodeVersion: string
      chromeVersion: string
      platform: string
      homeDir: string
    }>
  }
  notifications: {
    create(payload: {
      type: 'info' | 'success' | 'warning' | 'error'
      title: string
      message?: string
      source?: string
      key: string
    }): Promise<{ id: string } | { error: string }>
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
  db: {
    health(): Promise<{ ok: boolean; message?: string }>
  }
  logger: {
    write(level: string, namespace: string, message: string): void
  }
  integrations: {
    status(input: {
      tracker?: TrackerId
    }): Promise<{ connections: TrackerConnection[] } | { error: string; message?: string }>
    connect(
      input:
        | { tracker: 'linear'; apiKey: string; email?: string | null }
        | { tracker: 'jira'; site: string; email: string; apiToken: string; jql: string }
    ): Promise<{ connection: TrackerConnection } | { error: string; message?: string }>
    disconnect(input: { tracker: TrackerId }): Promise<{ ok: true } | { error: string }>
    setMine(input: {
      tracker: TrackerId
      mine: MineSelector
    }): Promise<{ ok: true } | { error: string }>
    listMine(input: {
      tracker?: TrackerId
      limit?: number
    }): Promise<IssueListResult | { error: string; message?: string }>
    search(input: {
      term: string
      tracker?: TrackerId
      limit?: number
    }): Promise<IssueListResult | { error: string; message?: string }>
    getIssue(input: {
      tracker: TrackerId
      key: string
      refresh?: boolean
    }): Promise<{ issue: Issue | null } | { error: string; message?: string }>
    comment(input: {
      tracker: TrackerId
      key: string
      body: string
    }): Promise<{ ok: true } | { error: string; message?: string }>
    linkSet(input: {
      projectId: string
      tracker: TrackerId
      key: string
      injectContext?: boolean
    }): Promise<{ link: IssueLink } | { error: string; message?: string }>
    linkGet(input: {
      projectId: string
    }): Promise<
      | { link: IssueLink | null; issue: Issue | null; issueError?: string }
      | { error: string; message?: string }
    >
    linkClear(input: { projectId: string }): Promise<{ ok: true } | { error: string }>
    contextPreview(input: {
      projectId: string
    }): Promise<{ context: AgentContext } | { error: string; message?: string }>
    setInjectContext(input: {
      projectId: string
      injectContext: boolean
    }): Promise<{ ok: true } | { error: string; message?: string }>
    onStatusChanged(handler: (payload: unknown) => void): () => void
    onLinkChanged(handler: (payload: unknown) => void): () => void
    onContextInjected(handler: (payload: unknown) => void): () => void
  }
  getFilePath(file: File): string
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
