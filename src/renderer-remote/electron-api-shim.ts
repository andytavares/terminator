// Runs as an IIFE before the renderer bundle. Sets up window.electronAPI over a WebSocket
// bridge so the unmodified Electron renderer can run in any browser.
;(function () {
  let ws: WebSocket
  let wsReady = false
  const sendQueue: string[] = []
  let reqId = 0
  const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()

  function sendRaw(msg: unknown) {
    const s = JSON.stringify(msg)
    if (wsReady) {
      ws.send(s)
    } else {
      sendQueue.push(s)
    }
  }

  function invoke(channel: string, payload?: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = `r${++reqId}`
      pending.set(id, { resolve, reject })
      sendRaw({ type: 'invoke', id, channel, args: [payload] })
    })
  }

  function fire(channel: string, payload?: unknown) {
    sendRaw({ type: 'send', channel, args: [payload] })
  }

  function on(channel: string, handler: (...args: unknown[]) => void): () => void {
    if (!listeners.has(channel)) {
      listeners.set(channel, new Set())
      sendRaw({ type: 'subscribe', channel })
    }
    listeners.get(channel)!.add(handler)
    return () => {
      listeners.get(channel)?.delete(handler)
    }
  }

  async function connectBridge(): Promise<void> {
    const token = sessionStorage.getItem('remoteToken') ?? ''
    let ticket: string
    try {
      const res = await fetch('/api/bridge-ticket', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        setTimeout(() => void connectBridge(), 2000)
        return
      }
      ticket = ((await res.json()) as { ticket: string }).ticket
    } catch {
      setTimeout(() => void connectBridge(), 2000)
      return
    }

    const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    ws = new WebSocket(
      `${wsProto}//${location.host}/api/bridge?ticket=${encodeURIComponent(ticket)}`
    )

    ws.onopen = () => {
      wsReady = true
      // Re-subscribe to all active channels (handles reconnects)
      for (const channel of listeners.keys()) {
        ws.send(JSON.stringify({ type: 'subscribe', channel }))
      }
      for (const msg of sendQueue) ws.send(msg)
      sendQueue.length = 0
    }

    ws.onmessage = (event) => {
      let msg: {
        type: string
        id?: string
        result?: unknown
        error?: string
        channel?: string
        args?: unknown[]
      }
      try {
        msg = JSON.parse(event.data as string)
      } catch {
        return
      }

      if (msg.type === 'result' && msg.id) {
        const p = pending.get(msg.id)
        if (p) {
          pending.delete(msg.id)
          p.resolve(msg.result)
        }
      } else if (msg.type === 'error' && msg.id) {
        const p = pending.get(msg.id)
        if (p) {
          pending.delete(msg.id)
          p.reject(new Error(msg.error ?? 'bridge error'))
        }
      } else if (msg.type === 'event' && msg.channel) {
        const cbs = listeners.get(msg.channel)
        if (cbs) {
          const args = msg.args ?? []
          cbs.forEach((cb) => cb(...args))
        }
      }
    }

    ws.onclose = () => {
      wsReady = false
      for (const { reject } of pending.values()) {
        reject(new Error('bridge disconnected'))
      }
      pending.clear()
      setTimeout(() => void connectBridge(), 2000)
    }

    ws.onerror = () => {
      ws.close()
    }
  }

  void connectBridge()

  // Helper: build a subscription-based on() that matches the electronAPI signature
  // Most on* methods take (handler) and return unsubscribe fn
  function makePushOn<T>(channel: string, map: (args: unknown[]) => T) {
    return (handler: (v: T) => void) => on(channel, (...args) => handler(map(args)))
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).electronAPI = {
    terminal: {
      create: (payload: unknown) => invoke('terminal:create', payload),
      close: (sessionId: string) => invoke('terminal:close', { sessionId }),
      input: (sessionId: string, data: string) => fire('terminal:input', { sessionId, data }),
      resize: (sessionId: string, cols: number, rows: number) =>
        fire('terminal:resize', { sessionId, cols, rows }),
      onOutput: (handler: (sessionId: string, data: string) => void) =>
        on('terminal:output', (...args) => {
          const p = args[0] as { sessionId: string; data: string }
          handler(p.sessionId, p.data)
        }),
      closeAll: () => invoke('terminal:close-all'),
      cleanupOrphans: () => invoke('terminal:cleanup-orphans'),
      onProcessExit: (handler: (sessionId: string, exitCode: number) => void) =>
        on('terminal:process-exit', (...args) => {
          const p = args[0] as { sessionId: string; exitCode: number }
          handler(p.sessionId, p.exitCode)
        }),
    },
    workspace: {
      list: () => invoke('workspace:list'),
      create: (payload: unknown) => invoke('workspace:create', payload),
      update: (payload: unknown) => invoke('workspace:update', payload),
      delete: (id: string) => invoke('workspace:delete', { id }),
      reorder: (ids: string[]) => invoke('workspace:reorder', { ids }),
    },
    project: {
      list: (workspaceId: string) => invoke('project:list', { workspaceId }),
      create: (payload: unknown) => invoke('project:create', payload),
      delete: (id: string) => invoke('project:delete', { id }),
      updateBranch: (id: string, gitBranch: string) =>
        invoke('project:update-branch', { id, gitBranch }),
      rename: (id: string, name: string) => invoke('project:rename', { id, name }),
      reorder: (workspaceId: string, ids: string[]) =>
        invoke('project:reorder', { workspaceId, ids }),
    },
    git: {
      isRepo: (path: string) => invoke('git:is-repo', { path }),
      currentBranch: (path: string) => invoke('git:current-branch', { path }),
      listBranches: (path: string) => invoke('git:list-branches', { path }),
      checkout: (path: string, branch: string) => invoke('git:checkout', { path, branch }),
      createBranch: (path: string, branch: string) => invoke('git:create-branch', { path, branch }),
      suggestWorktreePath: (repoRoot: string, branch: string, baseDir?: string) =>
        invoke('git:suggest-worktree-path', { repoRoot, branch, baseDir }),
      createWorktree: (payload: unknown) => invoke('git:create-worktree', payload),
      removeWorktree: (repoRoot: string, worktreePath: string) =>
        invoke('git:remove-worktree', { repoRoot, worktreePath }),
      listWorktrees: (path: string) => invoke('git:list-worktrees', { path }),
    },
    settings: {
      getGlobal: () => invoke('settings:get-global'),
      updateGlobal: (patch: unknown) => invoke('settings:update-global', { patch }),
      getWorkspace: (workspaceId: string) => invoke('settings:get-workspace', { workspaceId }),
      updateWorkspace: (workspaceId: string, patch: unknown) =>
        invoke('settings:update-workspace', { workspaceId, patch }),
    },
    dialog: {
      openDirectory: () => Promise.resolve({ cancelled: true }),
    },
    extension: {
      list: () => invoke('extension:list'),
      install: (directoryPath: string) => invoke('extension:install', { directoryPath }),
      toggle: (id: string, enabled: boolean) => invoke('extension:toggle', { id, enabled }),
      uninstall: (id: string) => invoke('extension:uninstall', { id }),
      reload: (id: string) => invoke('extension:reload', { id }),
      getSettingsSchemas: () => invoke('extension:get-settings-schemas'),
      getSettingsValues: () => invoke('extension:get-settings-values'),
      updateSetting: (key: string, value: unknown) =>
        invoke('extension:update-setting', { key, value }),
      getSidebarItems: () => invoke('extension:get-sidebar-items'),
      getContextMenuItems: (target: string) =>
        invoke('extension:get-context-menu-items', { target }),
      contextMenuClick: (target: string, itemId: string, targetId: string) =>
        fire('extension:context-menu-click', { target, itemId, targetId }),
      getCommands: () => invoke('extension:get-commands'),
      executeCommand: (key: string) => fire('extension:execute-command', { key }),
    },
    keyboard: {
      isReserved: () => false,
    },
    shell: {
      exec: (options: unknown) => invoke('shell:exec', options),
      openPath: (filePath: string) => invoke('shell:open-path', { filePath }),
      openExternal: (url: string) => {
        window.open(url, '_blank')
        return Promise.resolve()
      },
    },
    fs: {
      watchStart: (projectRoot: string) => invoke('fs:watch-start', { projectRoot }),
      watchStop: () => invoke('fs:watch-stop'),
      onChanged: makePushOn<unknown>('fs:changed', (args) => args[0]),
      readFile: (filePath: string) => invoke('fs:read-file', { filePath }),
    },
    extensionEvents: {
      onToast: makePushOn<{ type: string; message: string }>(
        'extension:toast',
        (args) => args[0] as { type: string; message: string }
      ),
      onTogglePanel: makePushOn<string>(
        'extension:toggle-panel',
        (args) => (args[0] as { panelId: string }).panelId
      ),
      onSelectProjectTab: makePushOn<string>(
        'extension:select-project-tab',
        (args) => (args[0] as { tabId: string }).tabId
      ),
      onMenuOpenSettings: makePushOn<void>('menu:open-settings', () => undefined),
      onMenuToggleSidebar: makePushOn<void>('menu:toggle-sidebar', () => undefined),
      onMenuCloseTab: makePushOn<void>('menu:close-tab', () => undefined),
      onMenuOpenAbout: makePushOn<void>('menu:open-about', () => undefined),
    },
    app: {
      getInfo: () => invoke('app:get-info'),
    },
    extensionBridge: {
      invoke: (channel: string, payload?: unknown) => invoke(channel, payload),
      on: (channel: string, handler: (data: unknown) => void) =>
        on(channel, (data) => handler(data)),
    },
    notification: {
      show: (title: string, body: string) => fire('notification:show', { title, body }),
    },
    notifications: {
      list: () => invoke('notifications:list'),
      dismiss: (id: string) => invoke('notifications:dismiss', { id }),
      triggerAction: (notifId: string, actionId: string) =>
        invoke('notifications:trigger-action', { notifId, actionId }),
      onPush: makePushOn<unknown>('notifications:push', (args) => args[0]),
    },
    metrics: {
      getSystem: () => invoke('metrics:system'),
      getProcesses: (pids: number[]) => invoke('metrics:processes', { pids }),
      getPids: (sessionIds: string[]) => invoke('metrics:pids', { sessionIds }),
    },
    logger: {
      write: (level: string, namespace: string, message: string) =>
        fire('log:write', { level, namespace, message }),
    },
  }
})()
