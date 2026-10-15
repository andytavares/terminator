import { describe, it, expect, vi } from 'vitest'
import { buildElectronApi, type ApiTransport } from '../build-api.js'
import { ELECTRON_API_MANIFEST } from '../manifest.js'
import type { ElectronAPI } from '../api-type.js'
import { methodAt } from './method-at'

function makeTransport() {
  const listeners = new Map<string, Set<(args: unknown[]) => void>>()
  // Typed vi.fn implementations so the object structurally satisfies ApiTransport.
  const invoke = vi.fn(async (_channel: string, _payload?: unknown): Promise<unknown> => undefined)
  const send = vi.fn((_channel: string, _payload?: unknown): void => {})
  const subscribe = vi.fn((channel: string, listener: (args: unknown[]) => void) => {
    if (!listeners.has(channel)) listeners.set(channel, new Set())
    listeners.get(channel)!.add(listener)
    return () => {
      listeners.get(channel)!.delete(listener)
    }
  })
  return {
    invoke,
    send,
    subscribe,
    push(channel: string, ...args: unknown[]) {
      listeners.get(channel)?.forEach((l) => l(args))
    },
  } satisfies ApiTransport & { push: (channel: string, ...args: unknown[]) => void }
}

const NATIVE_LOCALS = {
  getFilePath: () => '/tmp/file',
  'extensionBridge.invoke': vi.fn(),
  'extensionBridge.on': vi.fn(),
}

const REMOTE_LOCALS = {
  'dialog.openDirectory': () => Promise.resolve({ cancelled: true }),
  'shell.openExternal': vi.fn(),
  'extension.updatePanelBounds': () => {},
  'terminal.acknowledge': () => {},
  'fs.watchStart': () => Promise.resolve({ error: 'WATCH_UNAVAILABLE' }),
  'fs.watchStop': () => Promise.resolve({ ok: true }),
  'fs.onChanged': () => () => {},
  'extensionBridge.invoke': vi.fn(),
  'extensionBridge.on': vi.fn(),
}

function nativeBridge() {
  const t = makeTransport()
  return { t, api: buildElectronApi(t, { mode: 'native', locals: NATIVE_LOCALS }) as ElectronAPI }
}

function remoteBridge() {
  const t = makeTransport()
  return { t, api: buildElectronApi(t, { mode: 'remote', locals: REMOTE_LOCALS }) as ElectronAPI }
}

describe('buildElectronApi — native mode', () => {
  it('maps invoke methods with a payload mapper', async () => {
    const { t, api } = nativeBridge()
    await api.terminal.close('sess-1')
    expect(t.invoke).toHaveBeenCalledWith('terminal:close', { sessionId: 'sess-1' })
  })

  it('sends the folder as a payload when opening an editor', async () => {
    const { t, api } = nativeBridge()
    await api.editor.open('/repos/app')
    expect(t.invoke).toHaveBeenCalledWith('editor:open', { folderPath: '/repos/app' })
  })

  it('asks which editor is available with no payload at all', async () => {
    const { t, api } = nativeBridge()
    await api.editor.detect()
    expect(t.invoke).toHaveBeenCalledWith('editor:detect', undefined)
  })

  it('passes the first argument through when no mapper is declared', async () => {
    const { t, api } = nativeBridge()
    await api.terminal.create({ cwd: '/repo' })
    expect(t.invoke).toHaveBeenCalledWith('terminal:create', { cwd: '/repo' })
  })

  it('maps send methods', () => {
    const { t, api } = nativeBridge()
    api.terminal.input('sess-1', 'ls\n')
    expect(t.send).toHaveBeenCalledWith('terminal:input', { sessionId: 'sess-1', data: 'ls\n' })
  })
})

describe('buildElectronApi — native mode events', () => {
  it('subscribes event methods and maps pushed args to handler args', () => {
    const { t, api } = nativeBridge()
    const handler = vi.fn()
    const unsubscribe = api.terminal.onOutput(handler)
    t.push('terminal:output', { sessionId: 'sess-1', data: 'hello' })
    expect(handler).toHaveBeenCalledWith('sess-1', 'hello')
    unsubscribe()
    t.push('terminal:output', { sessionId: 'sess-1', data: 'again' })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('maps zero-payload menu events to zero handler args', () => {
    const { t, api } = nativeBridge()
    const handler = vi.fn()
    api.extensionEvents.onMenuOpenSettings(handler)
    t.push('menu:open-settings')
    expect(handler).toHaveBeenCalledWith()
  })

  it('delivers menu:open-home to onMenuOpenHome with no args', () => {
    const { t, api } = nativeBridge()
    const handler = vi.fn()
    api.extensionEvents.onMenuOpenHome(handler)
    t.push('menu:open-home')
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith()
  })
})

const WIRE_CASES = [
  {
    path: 'terminal.attach',
    args: ['s1'],
    kind: 'invoke',
    channel: 'terminal:attach',
    payload: { sessionId: 's1' },
  },
  {
    path: 'git.changeStats',
    args: ['/repo'],
    kind: 'invoke',
    channel: 'git:change-stats',
    payload: { path: '/repo' },
  },
  {
    path: 'workspace.setActive',
    args: [{ workspaceId: 'w1', projectId: 'p1', repoRoot: '/repo' }],
    kind: 'send',
    channel: 'workspace:active-changed',
    payload: { workspaceId: 'w1', projectId: 'p1', repoRoot: '/repo' },
  },
  {
    path: 'extensionEvents.notifyPanelState',
    args: ['p1', true],
    kind: 'send',
    channel: 'menu:set-panel-checked',
    payload: { panelId: 'p1', open: true },
  },
] as const

describe('buildElectronApi — native mode payloads', () => {
  it.each(WIRE_CASES)(
    '$path puts its arguments on the wire',
    async ({ path, args, kind, channel, payload }) => {
      const { t, api } = nativeBridge()
      await methodAt(api, path)(...args)
      expect(t[kind]).toHaveBeenCalledWith(channel, payload)
    }
  )

  it('wraps the url when opening an external link natively', async () => {
    const { t, api } = nativeBridge()
    await api.shell.openExternal('https://example.com')
    expect(t.invoke).toHaveBeenCalledWith('shell:open-external', { url: 'https://example.com' })
  })
})

const HANDLER_CASES = [
  {
    path: 'project.onAdded',
    channel: 'workspace:project-added',
    pushed: [{ id: 'p1', name: 'app' }, 'extra'],
    expected: [{ id: 'p1', name: 'app' }],
  },
  {
    path: 'project.onRemoved',
    channel: 'workspace:project-removed',
    pushed: [{ id: 'p1' }],
    expected: ['p1'],
  },
  {
    path: 'extensionEvents.onExtensionPanelLoaded',
    channel: 'extension:panel-loaded',
    pushed: [{ id: 'ext.a', viewParam: 'main' }],
    expected: ['ext.a'],
  },
  {
    path: 'extensionEvents.onExtensionRendererReload',
    channel: 'extension:renderer-reload',
    pushed: [{ id: 'ext.a' }],
    expected: ['ext.a'],
  },
  {
    path: 'extensionEvents.onExtensionExitToTerminal',
    channel: 'extension:exit-to-terminal',
    pushed: ['panel-1', 'extra'],
    expected: ['panel-1'],
  },
  {
    path: 'quickActions.onOpen',
    channel: 'quick-actions:open',
    pushed: [{ ignored: true }],
    expected: [],
  },
] as const

describe('buildElectronApi — native mode handler arguments', () => {
  it.each(HANDLER_CASES)(
    '$path hands its handler only what it needs',
    ({ path, channel, pushed, expected }) => {
      const { t, api } = nativeBridge()
      const handler = vi.fn()
      methodAt(api, path)(handler)
      t.push(channel, ...pushed)
      expect(handler).toHaveBeenCalledWith(...expected)
    }
  )
})

describe('buildElectronApi — native mode surface', () => {
  it('uses the supplied local implementations', () => {
    const { api } = nativeBridge()
    expect(api.getFilePath(new File([], 'notes.md'))).toBe('/tmp/file')
  })

  it('includes native-only methods', () => {
    const { api } = nativeBridge()
    expect(typeof api.workspace.getActive).toBe('function')
    expect(typeof api.db.health).toBe('function')
    expect(typeof api.getFilePath).toBe('function')
    expect(typeof api.extension.setTheme).toBe('function')
  })

  it('throws at build time when a local implementation is missing', () => {
    const t = makeTransport()
    expect(() => buildElectronApi(t, { mode: 'native', locals: {} })).toThrow(
      /missing local implementation/
    )
  })
})

describe('buildElectronApi — extension theme', () => {
  // An extension view is its own document and never sees the renderer's
  // `data-theme`, so the theme has to travel over this channel. It is
  // native-only: the remote client renders its own chrome.
  it('sends the theme to the extension host', () => {
    const { t, api } = nativeBridge()
    api.extension.setTheme('light')
    expect(t.send).toHaveBeenCalledWith('extension:set-theme', { theme: 'light' })
    api.extension.setTheme('dark')
    expect(t.send).toHaveBeenCalledWith('extension:set-theme', { theme: 'dark' })
  })

  it('omits the theme channel from the remote client', () => {
    const { api } = remoteBridge()
    expect(api.extension.setTheme).toBeUndefined()
  })
})

describe('buildElectronApi — remote mode', () => {
  it('keeps flow-control acknowledgements off the wire, but sends them natively', () => {
    const remote = makeTransport()
    const native = makeTransport()
    const remoteApi = buildElectronApi(remote, {
      mode: 'remote',
      locals: REMOTE_LOCALS,
    }) as ElectronAPI
    const nativeApi = buildElectronApi(native, {
      mode: 'native',
      locals: NATIVE_LOCALS,
    }) as ElectronAPI

    remoteApi.terminal.acknowledge('s1', 5)
    nativeApi.terminal.acknowledge('s1', 5)

    expect(remote.send).not.toHaveBeenCalled()
    expect(native.send).toHaveBeenCalledWith('terminal:acknowledge', { sessionId: 's1', count: 5 })
  })

  it('omits native-only methods and their empty namespaces', () => {
    const { api } = remoteBridge()
    expect(api.workspace.getActive).toBeUndefined()
    expect(api.db).toBeUndefined()
    expect(api.getFilePath).toBeUndefined()
    expect(api.project.onAdded).toBeUndefined()
  })
})

describe('buildElectronApi — remote mode transport', () => {
  it('replaces stub methods with the supplied local implementation', async () => {
    const { t, api } = remoteBridge()
    await expect(api.dialog.openDirectory()).resolves.toEqual({ cancelled: true })
    expect(t.invoke).not.toHaveBeenCalled()
  })

  it('routes non-stub methods through the transport unchanged', async () => {
    const { t, api } = remoteBridge()
    await api.git.checkout('/repo', 'main')
    expect(t.invoke).toHaveBeenCalledWith('git:checkout', { path: '/repo', branch: 'main' })
  })

  it('builds the same event subscription surface as native for shared events', () => {
    const { t, api } = remoteBridge()
    const handler = vi.fn()
    api.extensionEvents.onTogglePanel(handler)
    t.push('extension:toggle-panel', 'terminator.git-integration')
    expect(handler).toHaveBeenCalledWith('terminator.git-integration')
  })
})

// Every method on a built bridge, as a dot path ('terminal.create', 'getFilePath').
function collectMethodPaths(api: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(api).flatMap(([name, value]) =>
    typeof value === 'function'
      ? [prefix + name]
      : collectMethodPaths(value as Record<string, unknown>, `${prefix}${name}.`)
  )
}

function manifestPathsWhere(keep: (spec: (typeof ELECTRON_API_MANIFEST)[number]) => boolean) {
  return ELECTRON_API_MANIFEST.filter(keep)
    .map((spec) => spec.path)
    .sort()
}

describe('buildElectronApi — the manifest is the whole surface', () => {
  it('gives the app renderer every manifest method not reserved for extension views', () => {
    const api = buildElectronApi(makeTransport(), { mode: 'native', locals: NATIVE_LOCALS })
    expect(collectMethodPaths(api).sort()).toEqual(
      manifestPathsWhere((spec) => spec.extensionView !== 'only')
    )
  })

  it('gives the remote client every renderer method except the omitted ones', () => {
    const api = buildElectronApi(makeTransport(), { mode: 'remote', locals: REMOTE_LOCALS })
    expect(collectMethodPaths(api).sort()).toEqual(
      manifestPathsWhere((spec) => spec.extensionView !== 'only' && spec.remote !== 'omit')
    )
  })

  it('keeps extension-view-only methods off the app renderer and the remote client', () => {
    const native = buildElectronApi(makeTransport(), { mode: 'native', locals: NATIVE_LOCALS })
    const remote = buildElectronApi(makeTransport(), { mode: 'remote', locals: REMOTE_LOCALS })
    for (const api of [native, remote]) {
      expect(methodAt(api, 'extension.runCommand')).toBeUndefined()
      expect(methodAt(api, 'terminal.listSessions')).toBeUndefined()
      expect(api.ui).toBeUndefined()
    }
  })
})

const FRAME_LOCALS = {
  'ui.setModalDepth': () => {},
  'extensionBridge.invoke': vi.fn(),
  'extensionBridge.on': vi.fn(),
}

/** Every path src/main/preload-webview.ts exposes by hand — the frame surface. */
const PRELOAD_WEBVIEW_PATHS = [
  'app.getInfo',
  'db.health',
  'dialog.openDirectory',
  'extension.executeCommand',
  'extension.getCommands',
  'extension.getSettingsSchemas',
  'extension.getSettingsValues',
  'extension.hasCommand',
  'extension.install',
  'extension.list',
  'extension.onSettingsChanged',
  'extension.reload',
  'extension.runCommand',
  'extension.toggle',
  'extension.uninstall',
  'extension.updateSetting',
  'extensionBridge.invoke',
  'extensionBridge.on',
  'extensionEvents.notifyPanelState',
  'extensionEvents.onExtensionPanelLoaded',
  'extensionEvents.onExtensionRendererReload',
  'extensionEvents.onMenuOpenSettings',
  'extensionEvents.onTogglePanel',
  'fs.onChanged',
  'fs.readFile',
  'fs.watchStart',
  'fs.watchStop',
  'git.checkout',
  'git.createBranch',
  'git.createWorktree',
  'git.currentBranch',
  'git.isRepo',
  'git.listBranches',
  'git.listWorktrees',
  'git.removeWorktree',
  'git.suggestWorktreePath',
  'logger.write',
  'metrics.getPids',
  'metrics.getProcesses',
  'metrics.getSystem',
  'notifications.create',
  'notifications.dismiss',
  'notifications.list',
  'notifications.onPush',
  'notifications.triggerAction',
  'project.create',
  'project.delete',
  'project.list',
  'project.rename',
  'project.reorder',
  'project.updateBranch',
  'settings.getGlobal',
  'settings.getWorkspace',
  'settings.updateGlobal',
  'settings.updateWorkspace',
  'shell.exec',
  'shell.openExternal',
  'shell.openPath',
  'terminal.cleanupOrphans',
  'terminal.close',
  'terminal.closeAll',
  'terminal.create',
  'terminal.input',
  'terminal.listSessions',
  'terminal.onProcessExit',
  'terminal.resize',
  'ui.setModalDepth',
  'workspace.create',
  'workspace.delete',
  'workspace.getActive',
  'workspace.list',
  'workspace.reorder',
  'workspace.update',
]

function frameBridge() {
  const t = makeTransport()
  return { t, api: buildElectronApi(t, { mode: 'frame', locals: FRAME_LOCALS }) as ElectronAPI }
}

describe('buildElectronApi — frame mode', () => {
  it('exposes exactly the paths preload-webview.ts exposes, and no others', () => {
    const { api } = frameBridge()
    expect(collectMethodPaths(api).sort()).toEqual([...PRELOAD_WEBVIEW_PATHS].sort())
  })

  it('routes a shared method through the transport', async () => {
    const { t, api } = frameBridge()
    await api.terminal.close('sess-1')
    expect(t.invoke).toHaveBeenCalledWith('terminal:close', { sessionId: 'sess-1' })
  })

  it('throws at build time when a local implementation is missing', () => {
    const t = makeTransport()
    expect(() => buildElectronApi(t, { mode: 'frame', locals: {} })).toThrow(
      /missing local implementation/
    )
  })

  it('keeps app-renderer-only methods out of the frame', () => {
    const { api } = frameBridge()
    expect(api.getFilePath).toBeUndefined()
    expect(api.editor).toBeUndefined()
    expect(methodAt(api, 'terminal.onOutput')).toBeUndefined()
    expect(methodAt(api, 'extension.setTheme')).toBeUndefined()
  })
})
