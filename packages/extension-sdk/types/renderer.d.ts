/**
 * ElectronAPI — the `window.electronAPI` interface available inside extension webviews.
 * This is the renderer-side (webview / browser context) API surface.
 */

export type NotificationTarget = 'system' | 'center' | 'toast'

export interface SerializedNotification {
  id: string
  type: 'info' | 'success' | 'warning' | 'error'
  title: string
  message?: string
  timestamp: number
  source?: string
  actions?: Array<{ id: string; label: string }>
  targets: NotificationTarget[]
}

export interface ElectronAPI {
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
    list(): Promise<{ workspaces: Array<{ id: string; name: string; folderPath: string }> }>
    create(payload: unknown): Promise<{ workspace: unknown } | { error: string }>
    update(payload: unknown): Promise<{ workspace: unknown } | { error: string }>
    delete(id: string): Promise<{ success: boolean }>
    reorder(ids: string[]): Promise<{ success: boolean }>
  }
  project: {
    list(workspaceId: string): Promise<{ projects: Array<{ id: string; name: string }> }>
    create(payload: unknown): Promise<{ project: unknown } | { error: string }>
    delete(id: string): Promise<{ success: boolean }>
    updateBranch(id: string, gitBranch: string): Promise<{ project: unknown } | { error: string }>
    rename(id: string, name: string): Promise<{ project: unknown } | { error: string }>
    reorder(workspaceId: string, ids: string[]): Promise<{ success: boolean }>
  }
  git: {
    isRepo(path: string): Promise<{ isRepo: boolean; root?: string }>
    currentBranch(path: string): Promise<{ branch: string } | { error: string }>
    listBranches(path: string): Promise<{ branches: Array<{ name: string }> }>
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
    listWorktrees(path: string): Promise<{ worktrees: Array<{ path: string; branch?: string }> }>
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
    getGlobal(): Promise<{ settings: unknown }>
    updateGlobal(patch: unknown): Promise<{ settings: unknown }>
    getWorkspace(workspaceId: string): Promise<{ settings: unknown }>
    updateWorkspace(workspaceId: string, patch: unknown): Promise<{ settings: unknown }>
  }
  dialog: {
    openDirectory(): Promise<{ filePath: string } | { cancelled: true }>
  }
  extension: {
    list(): Promise<{ extensions: Array<{ id: string; name: string; status: string }> }>
    install(directoryPath: string): Promise<{ extension: unknown } | { error: string }>
    toggle(id: string, enabled: boolean): Promise<{ extension: unknown } | { error: string }>
    uninstall(id: string): Promise<{ ok: true } | { error: string }>
    reload(id: string): Promise<{ extension: unknown } | { error: string }>
    getSettingsSchemas(): Promise<{ schemas: unknown[] }>
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
    updatePanelBounds(payload: {
      extensionId: string
      viewParam: string
      bounds: { x: number; y: number; width: number; height: number }
      visible: boolean
      dpr: number
    }): Promise<void>
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
    notifyPanelState(panelId: string, open: boolean): void
    onExtensionPanelLoaded(handler: (id: string) => void): () => void
    onExtensionRendererReload(handler: (id: string) => void): () => void
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
    create(payload: {
      type: 'info' | 'success' | 'warning' | 'error'
      title: string
      message?: string
      targets?: NotificationTarget[]
    }): Promise<{ id: string } | { error: string }>
    list(): Promise<SerializedNotification[]>
    dismiss(id: string): Promise<{ ok: true } | { error: string }>
    triggerAction(notifId: string, actionId: string): Promise<{ ok: true } | { error: string }>
    onPush(handler: (n: SerializedNotification) => void): () => void
  }
  metrics: {
    getSystem(): Promise<{ data: unknown } | { error: string }>
    getProcesses(pids: number[]): Promise<{ data: unknown[] } | { error: string }>
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
