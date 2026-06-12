import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

class MockWebSocket {
  static instances: MockWebSocket[] = []
  url: string
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  sentMessages: string[] = []

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  send(data: string) {
    this.sentMessages.push(data)
  }

  close() {}
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type API = any

async function loadShim(): Promise<{ api: API; ws: MockWebSocket }> {
  vi.resetModules()
  MockWebSocket.instances = []
  await import('../../../src/renderer-remote/electron-api-shim')
  const ws = MockWebSocket.instances[0]
  ws.onopen?.()
  return { api: (window as API).electronAPI, ws }
}

beforeEach(() => {
  MockWebSocket.instances = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(global as any).WebSocket = MockWebSocket
  sessionStorage.clear()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).electronAPI
})

afterEach(() => {
  vi.resetModules()
})

function hasMsg(ws: MockWebSocket, substring: string) {
  return ws.sentMessages.some((m) => m.includes(substring))
}

describe('electron-api-shim bootstrap', () => {
  it('creates WebSocket to /api/bridge with token from sessionStorage', async () => {
    sessionStorage.setItem('remoteToken', 'my-token')
    await loadShim()
    expect(MockWebSocket.instances[0].url).toContain('/api/bridge')
    expect(MockWebSocket.instances[0].url).toContain('my-token')
  })

  it('sets window.electronAPI on import', async () => {
    await loadShim()
    expect((window as API).electronAPI).toBeDefined()
  })

  it('queues messages before ws is open and flushes on open', async () => {
    vi.resetModules()
    MockWebSocket.instances = []
    await import('../../../src/renderer-remote/electron-api-shim')
    const ws = MockWebSocket.instances[0]
    const api: API = (window as API).electronAPI
    void api.workspace.list()
    expect(ws.sentMessages.length).toBe(0)
    ws.onopen?.()
    expect(ws.sentMessages.length).toBeGreaterThan(0)
  })
})

describe('electron-api-shim message dispatch', () => {
  it('resolves pending invoke on result message', async () => {
    const { api, ws } = await loadShim()
    const p = api.workspace.list() as Promise<unknown>
    const id = (JSON.parse(ws.sentMessages[0]) as { id: string }).id
    ws.onmessage?.({ data: JSON.stringify({ type: 'result', id, result: ['ws1'] }) })
    await expect(p).resolves.toEqual(['ws1'])
  })

  it('rejects pending invoke on error message', async () => {
    const { api, ws } = await loadShim()
    const p = api.workspace.list() as Promise<unknown>
    const id = (JSON.parse(ws.sentMessages[0]) as { id: string }).id
    ws.onmessage?.({ data: JSON.stringify({ type: 'error', id, error: 'not found' }) })
    await expect(p).rejects.toThrow('not found')
  })

  it('uses default "bridge error" message when error field is missing', async () => {
    const { api, ws } = await loadShim()
    const p = api.workspace.list() as Promise<unknown>
    const id = (JSON.parse(ws.sentMessages[0]) as { id: string }).id
    ws.onmessage?.({ data: JSON.stringify({ type: 'error', id }) })
    await expect(p).rejects.toThrow('bridge error')
  })

  it('fires event channel listeners on event messages', async () => {
    const { api, ws } = await loadShim()
    const handler = vi.fn()
    api.terminal.onOutput(handler)
    ws.onmessage?.({
      data: JSON.stringify({
        type: 'event',
        channel: 'terminal:output',
        args: [{ sessionId: 's1', data: 'hello' }],
      }),
    })
    expect(handler).toHaveBeenCalledWith('s1', 'hello')
  })

  it('ignores event messages with unknown channel', async () => {
    const { ws } = await loadShim()
    expect(() =>
      ws.onmessage?.({
        data: JSON.stringify({ type: 'event', channel: 'unknown:channel', args: [] }),
      })
    ).not.toThrow()
  })

  it('ignores invalid JSON in onmessage', async () => {
    const { ws } = await loadShim()
    expect(() => ws.onmessage?.({ data: '{invalid json' })).not.toThrow()
  })

  it('re-subscribes active channels on reconnect (onopen)', async () => {
    const { api, ws } = await loadShim()
    api.terminal.onOutput(vi.fn())
    ws.sentMessages.length = 0
    ws.onopen?.()
    expect(ws.sentMessages.some((m) => m.includes('terminal:output'))).toBe(true)
  })
})

describe('electron-api-shim terminal API', () => {
  it('terminal.create sends invoke terminal:create', async () => {
    const { api, ws } = await loadShim()
    void api.terminal.create({ sessionId: 's1', cwd: '/tmp' })
    expect(hasMsg(ws, 'terminal:create')).toBe(true)
  })

  it('terminal.close sends invoke terminal:close', async () => {
    const { api, ws } = await loadShim()
    void api.terminal.close('s1')
    expect(hasMsg(ws, 'terminal:close')).toBe(true)
  })

  it('terminal.input fires terminal:input', async () => {
    const { api, ws } = await loadShim()
    api.terminal.input('s1', 'hello')
    expect(hasMsg(ws, 'terminal:input')).toBe(true)
  })

  it('terminal.resize fires terminal:resize', async () => {
    const { api, ws } = await loadShim()
    api.terminal.resize('s1', 80, 24)
    expect(hasMsg(ws, 'terminal:resize')).toBe(true)
  })

  it('terminal.onOutput subscribes to terminal:output', async () => {
    const { api, ws } = await loadShim()
    api.terminal.onOutput(vi.fn())
    expect(hasMsg(ws, 'terminal:output')).toBe(true)
  })

  it('terminal.closeAll sends invoke terminal:close-all', async () => {
    const { api, ws } = await loadShim()
    void api.terminal.closeAll()
    expect(hasMsg(ws, 'terminal:close-all')).toBe(true)
  })

  it('terminal.cleanupOrphans sends invoke terminal:cleanup-orphans', async () => {
    const { api, ws } = await loadShim()
    void api.terminal.cleanupOrphans()
    expect(hasMsg(ws, 'terminal:cleanup-orphans')).toBe(true)
  })

  it('terminal.onProcessExit subscribes and dispatches', async () => {
    const { api, ws } = await loadShim()
    const handler = vi.fn()
    api.terminal.onProcessExit(handler)
    expect(hasMsg(ws, 'terminal:process-exit')).toBe(true)
    ws.onmessage?.({
      data: JSON.stringify({
        type: 'event',
        channel: 'terminal:process-exit',
        args: [{ sessionId: 's1', exitCode: 0 }],
      }),
    })
    expect(handler).toHaveBeenCalledWith('s1', 0)
  })
})

describe('electron-api-shim workspace API', () => {
  it('workspace.list invokes workspace:list', async () => {
    const { api, ws } = await loadShim()
    void api.workspace.list()
    expect(hasMsg(ws, 'workspace:list')).toBe(true)
  })

  it('workspace.create invokes workspace:create', async () => {
    const { api, ws } = await loadShim()
    void api.workspace.create({ name: 'x' })
    expect(hasMsg(ws, 'workspace:create')).toBe(true)
  })

  it('workspace.update invokes workspace:update', async () => {
    const { api, ws } = await loadShim()
    void api.workspace.update({ id: 'w1' })
    expect(hasMsg(ws, 'workspace:update')).toBe(true)
  })

  it('workspace.delete invokes workspace:delete', async () => {
    const { api, ws } = await loadShim()
    void api.workspace.delete('w1')
    expect(hasMsg(ws, 'workspace:delete')).toBe(true)
  })

  it('workspace.reorder invokes workspace:reorder', async () => {
    const { api, ws } = await loadShim()
    void api.workspace.reorder(['w1', 'w2'])
    expect(hasMsg(ws, 'workspace:reorder')).toBe(true)
  })
})

describe('electron-api-shim project API', () => {
  it('project.list invokes project:list', async () => {
    const { api, ws } = await loadShim()
    void api.project.list('w1')
    expect(hasMsg(ws, 'project:list')).toBe(true)
  })

  it('project.create invokes project:create', async () => {
    const { api, ws } = await loadShim()
    void api.project.create({ name: 'p' })
    expect(hasMsg(ws, 'project:create')).toBe(true)
  })

  it('project.delete invokes project:delete', async () => {
    const { api, ws } = await loadShim()
    void api.project.delete('p1')
    expect(hasMsg(ws, 'project:delete')).toBe(true)
  })

  it('project.updateBranch invokes project:update-branch', async () => {
    const { api, ws } = await loadShim()
    void api.project.updateBranch('p1', 'main')
    expect(hasMsg(ws, 'project:update-branch')).toBe(true)
  })

  it('project.rename invokes project:rename', async () => {
    const { api, ws } = await loadShim()
    void api.project.rename('p1', 'New')
    expect(hasMsg(ws, 'project:rename')).toBe(true)
  })

  it('project.reorder invokes project:reorder', async () => {
    const { api, ws } = await loadShim()
    void api.project.reorder('w1', ['p1'])
    expect(hasMsg(ws, 'project:reorder')).toBe(true)
  })
})

describe('electron-api-shim settings API', () => {
  it('settings.getGlobal invokes settings:get-global', async () => {
    const { api, ws } = await loadShim()
    void api.settings.getGlobal()
    expect(hasMsg(ws, 'settings:get-global')).toBe(true)
  })

  it('settings.updateGlobal invokes settings:update-global', async () => {
    const { api, ws } = await loadShim()
    void api.settings.updateGlobal({ theme: 'dark' })
    expect(hasMsg(ws, 'settings:update-global')).toBe(true)
  })

  it('settings.getWorkspace invokes settings:get-workspace', async () => {
    const { api, ws } = await loadShim()
    void api.settings.getWorkspace('w1')
    expect(hasMsg(ws, 'settings:get-workspace')).toBe(true)
  })

  it('settings.updateWorkspace invokes settings:update-workspace', async () => {
    const { api, ws } = await loadShim()
    void api.settings.updateWorkspace('w1', {})
    expect(hasMsg(ws, 'settings:update-workspace')).toBe(true)
  })
})

describe('electron-api-shim git API', () => {
  it('git.isRepo invokes git:is-repo', async () => {
    const { api, ws } = await loadShim()
    void api.git.isRepo('/tmp')
    expect(hasMsg(ws, 'git:is-repo')).toBe(true)
  })

  it('git.currentBranch invokes git:current-branch', async () => {
    const { api, ws } = await loadShim()
    void api.git.currentBranch('/tmp')
    expect(hasMsg(ws, 'git:current-branch')).toBe(true)
  })

  it('git.listBranches invokes git:list-branches', async () => {
    const { api, ws } = await loadShim()
    void api.git.listBranches('/tmp')
    expect(hasMsg(ws, 'git:list-branches')).toBe(true)
  })

  it('git.checkout invokes git:checkout', async () => {
    const { api, ws } = await loadShim()
    void api.git.checkout('/tmp', 'main')
    expect(hasMsg(ws, 'git:checkout')).toBe(true)
  })

  it('git.createBranch invokes git:create-branch', async () => {
    const { api, ws } = await loadShim()
    void api.git.createBranch('/tmp', 'feature')
    expect(hasMsg(ws, 'git:create-branch')).toBe(true)
  })

  it('git.suggestWorktreePath invokes git:suggest-worktree-path', async () => {
    const { api, ws } = await loadShim()
    void api.git.suggestWorktreePath('/tmp', 'feat')
    expect(hasMsg(ws, 'git:suggest-worktree-path')).toBe(true)
  })

  it('git.createWorktree invokes git:create-worktree', async () => {
    const { api, ws } = await loadShim()
    void api.git.createWorktree({})
    expect(hasMsg(ws, 'git:create-worktree')).toBe(true)
  })

  it('git.removeWorktree invokes git:remove-worktree', async () => {
    const { api, ws } = await loadShim()
    void api.git.removeWorktree('/tmp', '/tmp/wt')
    expect(hasMsg(ws, 'git:remove-worktree')).toBe(true)
  })

  it('git.listWorktrees invokes git:list-worktrees', async () => {
    const { api, ws } = await loadShim()
    void api.git.listWorktrees('/tmp')
    expect(hasMsg(ws, 'git:list-worktrees')).toBe(true)
  })
})

describe('electron-api-shim other APIs', () => {
  it('dialog.openDirectory resolves with cancelled:true', async () => {
    const { api } = await loadShim()
    await expect(api.dialog.openDirectory()).resolves.toEqual({ cancelled: true })
  })

  it('shell.exec invokes shell:exec', async () => {
    const { api, ws } = await loadShim()
    void api.shell.exec({ cmd: 'ls' })
    expect(hasMsg(ws, 'shell:exec')).toBe(true)
  })

  it('shell.openPath invokes shell:open-path', async () => {
    const { api, ws } = await loadShim()
    void api.shell.openPath('/tmp/file.txt')
    expect(hasMsg(ws, 'shell:open-path')).toBe(true)
  })

  it('shell.openExternal calls window.open and resolves', async () => {
    const { api } = await loadShim()
    const spy = vi.spyOn(window, 'open').mockReturnValueOnce(null)
    await expect(api.shell.openExternal('https://example.com')).resolves.toBeUndefined()
    spy.mockRestore()
  })

  it('fs.watchStart invokes fs:watch-start', async () => {
    const { api, ws } = await loadShim()
    void api.fs.watchStart('/tmp')
    expect(hasMsg(ws, 'fs:watch-start')).toBe(true)
  })

  it('fs.watchStop invokes fs:watch-stop', async () => {
    const { api, ws } = await loadShim()
    void api.fs.watchStop()
    expect(hasMsg(ws, 'fs:watch-stop')).toBe(true)
  })

  it('fs.readFile invokes fs:read-file', async () => {
    const { api, ws } = await loadShim()
    void api.fs.readFile('/tmp/f')
    expect(hasMsg(ws, 'fs:read-file')).toBe(true)
  })

  it('fs.onChanged subscribes to fs:changed', async () => {
    const { api, ws } = await loadShim()
    api.fs.onChanged(vi.fn())
    expect(hasMsg(ws, 'fs:changed')).toBe(true)
  })

  it('app.getInfo invokes app:get-info', async () => {
    const { api, ws } = await loadShim()
    void api.app.getInfo()
    expect(hasMsg(ws, 'app:get-info')).toBe(true)
  })

  it('notification.show fires notification:show', async () => {
    const { api, ws } = await loadShim()
    api.notification.show('title', 'body')
    expect(hasMsg(ws, 'notification:show')).toBe(true)
  })

  it('notifications.list invokes notifications:list', async () => {
    const { api, ws } = await loadShim()
    void api.notifications.list()
    expect(hasMsg(ws, 'notifications:list')).toBe(true)
  })

  it('notifications.dismiss invokes notifications:dismiss', async () => {
    const { api, ws } = await loadShim()
    void api.notifications.dismiss('n1')
    expect(hasMsg(ws, 'notifications:dismiss')).toBe(true)
  })

  it('notifications.triggerAction invokes notifications:trigger-action', async () => {
    const { api, ws } = await loadShim()
    void api.notifications.triggerAction('n1', 'a1')
    expect(hasMsg(ws, 'notifications:trigger-action')).toBe(true)
  })

  it('notifications.onPush subscribes to notifications:push', async () => {
    const { api, ws } = await loadShim()
    api.notifications.onPush(vi.fn())
    expect(hasMsg(ws, 'notifications:push')).toBe(true)
  })

  it('metrics.getSystem invokes metrics:system', async () => {
    const { api, ws } = await loadShim()
    void api.metrics.getSystem()
    expect(hasMsg(ws, 'metrics:system')).toBe(true)
  })

  it('metrics.getProcesses invokes metrics:processes', async () => {
    const { api, ws } = await loadShim()
    void api.metrics.getProcesses([1, 2])
    expect(hasMsg(ws, 'metrics:processes')).toBe(true)
  })

  it('metrics.getPids invokes metrics:pids', async () => {
    const { api, ws } = await loadShim()
    void api.metrics.getPids(['s1'])
    expect(hasMsg(ws, 'metrics:pids')).toBe(true)
  })

  it('logger.write fires log:write', async () => {
    const { api, ws } = await loadShim()
    api.logger.write('info', 'ns', 'msg')
    expect(hasMsg(ws, 'log:write')).toBe(true)
  })

  it('keyboard.isReserved always returns false', async () => {
    const { api } = await loadShim()
    expect(api.keyboard.isReserved()).toBe(false)
  })

  it('extension.list invokes extension:list', async () => {
    const { api, ws } = await loadShim()
    void api.extension.list()
    expect(hasMsg(ws, 'extension:list')).toBe(true)
  })

  it('extension.install invokes extension:install', async () => {
    const { api, ws } = await loadShim()
    void api.extension.install('/path/to/ext')
    expect(hasMsg(ws, 'extension:install')).toBe(true)
  })

  it('extension.toggle invokes extension:toggle', async () => {
    const { api, ws } = await loadShim()
    void api.extension.toggle('ext1', true)
    expect(hasMsg(ws, 'extension:toggle')).toBe(true)
  })

  it('extension.uninstall invokes extension:uninstall', async () => {
    const { api, ws } = await loadShim()
    void api.extension.uninstall('ext1')
    expect(hasMsg(ws, 'extension:uninstall')).toBe(true)
  })

  it('extension.reload invokes extension:reload', async () => {
    const { api, ws } = await loadShim()
    void api.extension.reload('ext1')
    expect(hasMsg(ws, 'extension:reload')).toBe(true)
  })

  it('extension.getSettingsSchemas invokes extension:get-settings-schemas', async () => {
    const { api, ws } = await loadShim()
    void api.extension.getSettingsSchemas()
    expect(hasMsg(ws, 'extension:get-settings-schemas')).toBe(true)
  })

  it('extension.getSettingsValues invokes extension:get-settings-values', async () => {
    const { api, ws } = await loadShim()
    void api.extension.getSettingsValues()
    expect(hasMsg(ws, 'extension:get-settings-values')).toBe(true)
  })

  it('extension.updateSetting invokes extension:update-setting', async () => {
    const { api, ws } = await loadShim()
    void api.extension.updateSetting('key', 'val')
    expect(hasMsg(ws, 'extension:update-setting')).toBe(true)
  })

  it('extension.getSidebarItems invokes extension:get-sidebar-items', async () => {
    const { api, ws } = await loadShim()
    void api.extension.getSidebarItems()
    expect(hasMsg(ws, 'extension:get-sidebar-items')).toBe(true)
  })

  it('extension.getContextMenuItems invokes extension:get-context-menu-items', async () => {
    const { api, ws } = await loadShim()
    void api.extension.getContextMenuItems('terminal')
    expect(hasMsg(ws, 'extension:get-context-menu-items')).toBe(true)
  })

  it('extension.contextMenuClick fires extension:context-menu-click', async () => {
    const { api, ws } = await loadShim()
    api.extension.contextMenuClick('terminal', 'item1', 'target1')
    expect(hasMsg(ws, 'extension:context-menu-click')).toBe(true)
  })

  it('extension.getCommands invokes extension:get-commands', async () => {
    const { api, ws } = await loadShim()
    void api.extension.getCommands()
    expect(hasMsg(ws, 'extension:get-commands')).toBe(true)
  })

  it('extension.executeCommand fires extension:execute-command', async () => {
    const { api, ws } = await loadShim()
    api.extension.executeCommand('cmd.key')
    expect(hasMsg(ws, 'extension:execute-command')).toBe(true)
  })

  it('extensionEvents.onToast subscribes to extension:toast', async () => {
    const { api, ws } = await loadShim()
    api.extensionEvents.onToast(vi.fn())
    expect(hasMsg(ws, 'extension:toast')).toBe(true)
  })

  it('extensionEvents.onTogglePanel subscribes to extension:toggle-panel', async () => {
    const { api, ws } = await loadShim()
    api.extensionEvents.onTogglePanel(vi.fn())
    expect(hasMsg(ws, 'extension:toggle-panel')).toBe(true)
  })

  it('extensionEvents.onSelectProjectTab subscribes to extension:select-project-tab', async () => {
    const { api, ws } = await loadShim()
    api.extensionEvents.onSelectProjectTab(vi.fn())
    expect(hasMsg(ws, 'extension:select-project-tab')).toBe(true)
  })

  it('extensionEvents.onMenuOpenSettings subscribes to menu:open-settings', async () => {
    const { api, ws } = await loadShim()
    api.extensionEvents.onMenuOpenSettings(vi.fn())
    expect(hasMsg(ws, 'menu:open-settings')).toBe(true)
  })

  it('extensionEvents.onMenuToggleSidebar subscribes to menu:toggle-sidebar', async () => {
    const { api, ws } = await loadShim()
    api.extensionEvents.onMenuToggleSidebar(vi.fn())
    expect(hasMsg(ws, 'menu:toggle-sidebar')).toBe(true)
  })

  it('extensionEvents.onMenuCloseTab subscribes to menu:close-tab', async () => {
    const { api, ws } = await loadShim()
    api.extensionEvents.onMenuCloseTab(vi.fn())
    expect(hasMsg(ws, 'menu:close-tab')).toBe(true)
  })

  it('extensionEvents.onMenuOpenAbout subscribes to menu:open-about', async () => {
    const { api, ws } = await loadShim()
    api.extensionEvents.onMenuOpenAbout(vi.fn())
    expect(hasMsg(ws, 'menu:open-about')).toBe(true)
  })

  it('extensionBridge.invoke calls invoke with channel', async () => {
    const { api, ws } = await loadShim()
    void api.extensionBridge.invoke('custom:channel', { data: 1 })
    expect(hasMsg(ws, 'custom:channel')).toBe(true)
  })

  it('extensionBridge.on subscribes to channel', async () => {
    const { api, ws } = await loadShim()
    const handler = vi.fn()
    api.extensionBridge.on('custom:event', handler)
    expect(hasMsg(ws, 'custom:event')).toBe(true)
    ws.onmessage?.({
      data: JSON.stringify({ type: 'event', channel: 'custom:event', args: [{ payload: 'x' }] }),
    })
    expect(handler).toHaveBeenCalledWith({ payload: 'x' })
  })

  it('extensionEvents.onTogglePanel dispatches panelId from args', async () => {
    const { api, ws } = await loadShim()
    const handler = vi.fn()
    api.extensionEvents.onTogglePanel(handler)
    ws.onmessage?.({
      data: JSON.stringify({
        type: 'event',
        channel: 'extension:toggle-panel',
        args: [{ panelId: 'sidebar' }],
      }),
    })
    expect(handler).toHaveBeenCalledWith('sidebar')
  })

  it('extensionEvents.onSelectProjectTab dispatches tabId from args', async () => {
    const { api, ws } = await loadShim()
    const handler = vi.fn()
    api.extensionEvents.onSelectProjectTab(handler)
    ws.onmessage?.({
      data: JSON.stringify({
        type: 'event',
        channel: 'extension:select-project-tab',
        args: [{ tabId: 'tab1' }],
      }),
    })
    expect(handler).toHaveBeenCalledWith('tab1')
  })

  it('unsubscribe function removes handler from channel listeners', async () => {
    const { api, ws } = await loadShim()
    const handler = vi.fn()
    const unsub = api.terminal.onOutput(handler) as () => void
    unsub()
    ws.onmessage?.({
      data: JSON.stringify({
        type: 'event',
        channel: 'terminal:output',
        args: [{ sessionId: 's1', data: 'data' }],
      }),
    })
    expect(handler).not.toHaveBeenCalled()
  })
})
