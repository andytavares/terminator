import { contextBridge, ipcRenderer, webUtils } from 'electron'

// Inlined to keep the preload self-contained (no shared Rollup chunks that
// Electron's sandboxed require cannot resolve).
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
    getActive: () => ipcRenderer.invoke('workspace:get-active'),
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
    createBranch: (path: string, branch: string) =>
      ipcRenderer.invoke('git:create-branch', { path, branch }),
    suggestWorktreePath: (repoRoot: string, branch: string, baseDir?: string) =>
      ipcRenderer.invoke('git:suggest-worktree-path', { repoRoot, branch, baseDir }),
    createWorktree: (payload: unknown) => ipcRenderer.invoke('git:create-worktree', payload),
    removeWorktree: (repoRoot: string, worktreePath: string) =>
      ipcRenderer.invoke('git:remove-worktree', { repoRoot, worktreePath }),
    listWorktrees: (path: string) => ipcRenderer.invoke('git:list-worktrees', { path }),
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
    uninstall: (id: string) => ipcRenderer.invoke('extension:uninstall', { id }),
    reload: (id: string) => ipcRenderer.invoke('extension:reload', { id }),
    getSettingsSchemas: () => ipcRenderer.invoke('extension:get-settings-schemas'),
    getSettingsValues: () => ipcRenderer.invoke('extension:get-settings-values'),
    updateSetting: (key: string, value: unknown) =>
      ipcRenderer.invoke('extension:update-setting', { key, value }),
    getSidebarItems: () => ipcRenderer.invoke('extension:get-sidebar-items'),
    getContextMenuItems: (target: string) =>
      ipcRenderer.invoke('extension:get-context-menu-items', { target }),
    contextMenuClick: (target: string, itemId: string, targetId: string) =>
      ipcRenderer.send('extension:context-menu-click', { target, itemId, targetId }),
    getCommands: () => ipcRenderer.invoke('extension:get-commands'),
    executeCommand: (key: string) => ipcRenderer.send('extension:execute-command', { key }),
    updatePanelBounds: (payload: {
      extensionId: string
      viewParam: string
      bounds: { x: number; y: number; width: number; height: number }
      visible: boolean
      repoRoot?: string | null
    }) => ipcRenderer.invoke('extension:update-panel-bounds', payload),
  },
  keyboard: {
    isReserved: (accelerator: string) => RESERVED_SHORTCUTS.has(accelerator),
  },
  shell: {
    exec: (options: unknown) => ipcRenderer.invoke('shell:exec', options),
    openPath: (filePath: string) => ipcRenderer.invoke('shell:open-path', { filePath }),
    openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', { url }),
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
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: { type: string; message: string }
      ) => handler(payload)
      ipcRenderer.on('extension:toast', listener)
      return () => ipcRenderer.removeListener('extension:toast', listener)
    },
    onTogglePanel: (handler: (panelId: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, panelId: string) => handler(panelId)
      ipcRenderer.on('extension:toggle-panel', listener)
      return () => ipcRenderer.removeListener('extension:toggle-panel', listener)
    },
    onSelectProjectTab: (handler: (tabId: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: { tabId: string }) =>
        handler(payload.tabId)
      ipcRenderer.on('extension:select-project-tab', listener)
      return () => ipcRenderer.removeListener('extension:select-project-tab', listener)
    },
    onMenuOpenSettings: (handler: () => void) => {
      const listener = () => handler()
      ipcRenderer.on('menu:open-settings', listener)
      return () => ipcRenderer.removeListener('menu:open-settings', listener)
    },
    onMenuToggleSidebar: (handler: () => void) => {
      const listener = () => handler()
      ipcRenderer.on('menu:toggle-sidebar', listener)
      return () => ipcRenderer.removeListener('menu:toggle-sidebar', listener)
    },
    onMenuCloseTab: (handler: () => void) => {
      const listener = () => handler()
      ipcRenderer.on('menu:close-tab', listener)
      return () => ipcRenderer.removeListener('menu:close-tab', listener)
    },
    onMenuOpenAbout: (handler: () => void) => {
      const listener = () => handler()
      ipcRenderer.on('menu:open-about', listener)
      return () => ipcRenderer.removeListener('menu:open-about', listener)
    },
    notifyPanelState: (panelId: string, open: boolean) => {
      ipcRenderer.send('menu:set-panel-checked', { panelId, open })
    },
    onExtensionPanelLoaded: (handler: (id: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: { id: string }) =>
        handler(payload.id)
      ipcRenderer.on('extension:panel-loaded', listener)
      return () => ipcRenderer.removeListener('extension:panel-loaded', listener)
    },
    onExtensionRendererReload: (handler: (id: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: { id: string }) =>
        handler(payload.id)
      ipcRenderer.on('extension:renderer-reload', listener)
      return () => ipcRenderer.removeListener('extension:renderer-reload', listener)
    },
  },
  app: {
    getInfo: () => ipcRenderer.invoke('app:get-info'),
  },
  extensionBridge: {
    invoke: (channel: string, payload?: unknown) => ipcRenderer.invoke(channel, payload),
    on: (channel: string, handler: (data: unknown) => void) => {
      const listener = (_: Electron.IpcRendererEvent, data: unknown) => handler(data)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    },
  },
  notification: {
    show: (title: string, body: string) =>
      ipcRenderer.invoke('notifications:create', {
        type: 'info',
        title,
        message: body,
        targets: ['system'],
      }),
  },
  notifications: {
    create: (payload: {
      type: 'info' | 'success' | 'warning' | 'error'
      title: string
      message?: string
      targets?: Array<'system' | 'center' | 'toast'>
    }) => ipcRenderer.invoke('notifications:create', payload),
    list: () => ipcRenderer.invoke('notifications:list'),
    dismiss: (id: string) => ipcRenderer.invoke('notifications:dismiss', { id }),
    triggerAction: (notifId: string, actionId: string) =>
      ipcRenderer.invoke('notifications:trigger-action', { notifId, actionId }),
    onPush: (handler: (n: unknown) => void) => {
      const listener = (_: Electron.IpcRendererEvent, n: unknown) => handler(n)
      ipcRenderer.on('notifications:push', listener)
      return () => ipcRenderer.removeListener('notifications:push', listener)
    },
  },
  db: {
    health: () => ipcRenderer.invoke('db:health'),
  },
  metrics: {
    getSystem: () => ipcRenderer.invoke('metrics:system'),
    getProcesses: (pids: number[]) => ipcRenderer.invoke('metrics:processes', { pids }),
    getPids: (sessionIds: string[]) => ipcRenderer.invoke('metrics:pids', { sessionIds }),
  },
  logger: {
    write: (level: string, namespace: string, message: string) =>
      ipcRenderer.send('log:write', { level, namespace, message }),
  },
  getFilePath: (file: File): string => webUtils.getPathForFile(file),
})
