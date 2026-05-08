import { contextBridge, ipcRenderer } from 'electron'

const RESERVED_SHORTCUTS = new Set([
  'CmdOrCtrl+1',
  'CmdOrCtrl+2',
  'CmdOrCtrl+3',
  'CmdOrCtrl+4',
  'CmdOrCtrl+5',
  'CmdOrCtrl+6',
  'CmdOrCtrl+7',
  'CmdOrCtrl+8',
  'CmdOrCtrl+9',
  'CmdOrCtrl+=',
  'CmdOrCtrl+-',
  'CmdOrCtrl+Left',
  'CmdOrCtrl+Right',
  'CmdOrCtrl+T',
  'CmdOrCtrl+W',
  'CmdOrCtrl+,',
])

contextBridge.exposeInMainWorld('electronAPI', {
  terminal: {
    create: (payload: unknown) => ipcRenderer.invoke('terminal:create', payload),
    close: (sessionId: string) => ipcRenderer.invoke('terminal:close', { sessionId }),
    input: (sessionId: string, data: string) =>
      ipcRenderer.send('terminal:input', { sessionId, data }),
    resize: (sessionId: string, cols: number, rows: number) =>
      ipcRenderer.send('terminal:resize', { sessionId, cols, rows }),
    onOutput: (handler: (sessionId: string, data: string) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: { sessionId: string; data: string }
      ) => handler(payload.sessionId, payload.data)
      ipcRenderer.on('terminal:output', listener)
      return () => ipcRenderer.removeListener('terminal:output', listener)
    },
    closeAll: () => ipcRenderer.invoke('terminal:close-all'),
    cleanupOrphans: () => ipcRenderer.invoke('terminal:cleanup-orphans'),
    onProcessExit: (handler: (sessionId: string, exitCode: number) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: { sessionId: string; exitCode: number }
      ) => handler(payload.sessionId, payload.exitCode)
      ipcRenderer.on('terminal:process-exit', listener)
      return () => ipcRenderer.removeListener('terminal:process-exit', listener)
    },
  },
  workspace: {
    list: () => ipcRenderer.invoke('workspace:list'),
    create: (payload: unknown) => ipcRenderer.invoke('workspace:create', payload),
    update: (payload: unknown) => ipcRenderer.invoke('workspace:update', payload),
    delete: (id: string) => ipcRenderer.invoke('workspace:delete', { id }),
    reorder: (ids: string[]) => ipcRenderer.invoke('workspace:reorder', { ids }),
  },
  project: {
    list: (workspaceId: string) => ipcRenderer.invoke('project:list', { workspaceId }),
    create: (payload: unknown) => ipcRenderer.invoke('project:create', payload),
    delete: (id: string) => ipcRenderer.invoke('project:delete', { id }),
    updateBranch: (id: string, gitBranch: string) =>
      ipcRenderer.invoke('project:update-branch', { id, gitBranch }),
    rename: (id: string, name: string) => ipcRenderer.invoke('project:rename', { id, name }),
    reorder: (workspaceId: string, ids: string[]) =>
      ipcRenderer.invoke('project:reorder', { workspaceId, ids }),
  },
  git: {
    isRepo: (path: string) => ipcRenderer.invoke('git:is-repo', { path }),
    currentBranch: (path: string) => ipcRenderer.invoke('git:current-branch', { path }),
    listBranches: (path: string) => ipcRenderer.invoke('git:list-branches', { path }),
    checkout: (path: string, branch: string) =>
      ipcRenderer.invoke('git:checkout', { path, branch }),
    suggestWorktreePath: (repoRoot: string, branch: string, baseDir?: string) =>
      ipcRenderer.invoke('git:suggest-worktree-path', { repoRoot, branch, baseDir }),
    createWorktree: (payload: unknown) => ipcRenderer.invoke('git:create-worktree', payload),
    removeWorktree: (repoRoot: string, worktreePath: string) =>
      ipcRenderer.invoke('git:remove-worktree', { repoRoot, worktreePath }),
    listWorktrees: (path: string) => ipcRenderer.invoke('git:list-worktrees', { path }),
    status: (path: string, maxFiles?: number) =>
      ipcRenderer.invoke('git:status', { path, maxFiles }),
    diffFile: (repoRoot: string, path: string, staged: boolean) =>
      ipcRenderer.invoke('git:diff-file', { repoRoot, path, staged }),
    stage: (repoRoot: string, paths: string[]) =>
      ipcRenderer.invoke('git:stage', { repoRoot, paths }),
    unstage: (repoRoot: string, paths: string[]) =>
      ipcRenderer.invoke('git:unstage', { repoRoot, paths }),
    commit: (repoRoot: string, message: string, signOff?: boolean) =>
      ipcRenderer.invoke('git:commit', { repoRoot, message, signOff }),
    prStatus: (repoRoot: string) =>
      ipcRenderer.invoke('git:pr-status', { repoRoot }),
    prCreate: (payload: unknown) =>
      ipcRenderer.invoke('git:pr-create', payload),
  },
  settings: {
    getGlobal: () => ipcRenderer.invoke('settings:get-global'),
    updateGlobal: (patch: unknown) => ipcRenderer.invoke('settings:update-global', { patch }),
    getWorkspace: (workspaceId: string) =>
      ipcRenderer.invoke('settings:get-workspace', { workspaceId }),
    updateWorkspace: (workspaceId: string, patch: unknown) =>
      ipcRenderer.invoke('settings:update-workspace', { workspaceId, patch }),
  },
  dialog: {
    openDirectory: () => ipcRenderer.invoke('dialog:open-directory'),
  },
  extension: {
    list: () => ipcRenderer.invoke('extension:list'),
    install: (directoryPath: string) => ipcRenderer.invoke('extension:install', { directoryPath }),
    toggle: (id: string, enabled: boolean) =>
      ipcRenderer.invoke('extension:toggle', { id, enabled }),
    getSidebarItems: () => ipcRenderer.invoke('extension:get-sidebar-items'),
    getContextMenuItems: (target: string) =>
      ipcRenderer.invoke('extension:get-context-menu-items', { target }),
    contextMenuClick: (target: string, itemId: string, targetId: string) =>
      ipcRenderer.send('extension:context-menu-click', { target, itemId, targetId }),
  },
  keyboard: {
    isReserved: (accelerator: string) => RESERVED_SHORTCUTS.has(accelerator),
  },
  shell: {
    exec: (options: unknown) => ipcRenderer.invoke('shell:exec', options),
  },
  github: {
    listOpenPrs: (repoRoot: string) =>
      ipcRenderer.invoke('github:list-open-prs', { repoRoot }),
    prReviewDetail: (repoRoot: string, prNumber: number) =>
      ipcRenderer.invoke('github:pr-review-detail', { repoRoot, prNumber }),
    prFileDiff: (repoRoot: string, prNumber: number, path: string) =>
      ipcRenderer.invoke('github:pr-file-diff', { repoRoot, prNumber, path }),
    fileMetrics: (repoRoot: string, path: string) =>
      ipcRenderer.invoke('github:file-metrics', { repoRoot, path }),
    prInlineComments: (repoRoot: string, prNumber: number) =>
      ipcRenderer.invoke('github:pr-inline-comments', { repoRoot, prNumber }),
    prCommentAdd: (payload: unknown) =>
      ipcRenderer.invoke('github:pr-comment-add', payload),
    prCommentReply: (payload: unknown) =>
      ipcRenderer.invoke('github:pr-comment-reply', payload),
    prReviewSubmit: (payload: unknown) =>
      ipcRenderer.invoke('github:pr-review-submit', payload),
    sessionGet: (key: string) =>
      ipcRenderer.invoke('github:session-get', { key }),
    sessionSet: (key: string, session: unknown) =>
      ipcRenderer.invoke('github:session-set', { key, session }),
  },
  fs: {
    watchStart: (projectRoot: string) => ipcRenderer.invoke('fs:watch-start', { projectRoot }),
    watchStop: () => ipcRenderer.invoke('fs:watch-stop'),
    onChanged: (handler: (event: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => handler(payload)
      ipcRenderer.on('fs:changed', listener)
      return () => ipcRenderer.removeListener('fs:changed', listener)
    },
    readFile: (filePath: string) => ipcRenderer.invoke('fs:read-file', { filePath }),
  },
  extensionEvents: {
    onToast: (handler: (payload: { type: string; message: string }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: { type: string; message: string }) =>
        handler(payload)
      ipcRenderer.on('extension:toast', listener)
      return () => ipcRenderer.removeListener('extension:toast', listener)
    },
    onTogglePanel: (handler: (panelId: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: { panelId: string }) =>
        handler(payload.panelId)
      ipcRenderer.on('extension:toggle-panel', listener)
      return () => ipcRenderer.removeListener('extension:toggle-panel', listener)
    },
    onSelectProjectTab: (handler: (tabId: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: { tabId: string }) =>
        handler(payload.tabId)
      ipcRenderer.on('extension:select-project-tab', listener)
      return () => ipcRenderer.removeListener('extension:select-project-tab', listener)
    },
  },
})
