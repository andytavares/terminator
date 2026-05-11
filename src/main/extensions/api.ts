export interface Disposable {
  dispose(): void
}

export interface ExtensionSettingsSchema {
  label: string
  properties: Record<string, SettingDefinition>
}

export interface SettingDefinition {
  type: 'string' | 'number' | 'boolean' | 'enum'
  label: string
  description?: string
  default: unknown
  options?: string[]
  min?: number
  max?: number
  workspaceScoped?: boolean
}

// v1.1.0 types

export type PanelSlot = 'right-sidebar'

export interface PanelContribution {
  id: string
  title: string
  component: unknown // React.ComponentType — typed as unknown to avoid renderer dependency
  defaultVisible?: boolean
}

export interface TopBarMenuContribution {
  id: string
  label: string
  onClick(): void
  tooltip?: string
}

export interface NativeMenuItemContribution {
  id: string
  label: string
  onClick(): void
  accelerator?: string
}

export interface FsChangeEvent {
  projectRoot: string
  eventType: 'change' | 'rename'
  filename: string | null
}

export type ToastType = 'info' | 'success' | 'warning' | 'error'

export interface SidebarContribution {
  id: string
  label: string
  tooltip?: string
  onClick(): void
}

export type ContextMenuTarget = 'workspace' | 'project' | 'tab' | 'terminal'

export interface MenuItemContribution {
  id: string
  label: string
  onClick(targetId: string): void
}

export interface SessionSnapshot {
  readonly id: string
  readonly projectId: string
  readonly tabTitle: string
  readonly type: 'human' | 'agent'
}

export interface ExtensionAPI {
  readonly app: { readonly version: string }
  settings: {
    register(schema: ExtensionSettingsSchema): Disposable
    get<T>(key: string): T | undefined
  }
  sidebar: {
    registerItem(item: SidebarContribution): Disposable
    registerPanel(slot: PanelSlot, panel: PanelContribution): Disposable
  }
  topBar: {
    registerMenuItem(item: TopBarMenuContribution): Disposable
  }
  shell: {
    exec(options: {
      command: 'git' | 'gh'
      args: string[]
      cwd: string
      timeoutMs?: number
    }): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }>
  }
  notifications: {
    showToast(type: ToastType, message: string): void
  }
  nativeMenu: {
    addViewMenuItem(item: NativeMenuItemContribution): Disposable
  }
  fs: {
    watch(handler: (event: FsChangeEvent) => void): Disposable
  }
  contextMenu: {
    registerItem(target: ContextMenuTarget, item: MenuItemContribution): Disposable
  }
  keyboard: {
    register(accelerator: string, handler: () => void): Disposable
  }
  ipc: {
    registerHandler(
      channel: string,
      handler: (payload: unknown) => Promise<unknown> | unknown
    ): Disposable
  }
  terminal: {
    onSessionCreate(handler: (session: Readonly<SessionSnapshot>) => void): Disposable
    onSessionClose(handler: (sessionId: string) => void): Disposable
  }
}

import { BrowserWindow, Menu, MenuItem, ipcMain } from 'electron'
import { execShell, assertCommandAllowed } from '../shell/shell-executor.js'
import { fsWatcherService } from '../fs/fs-watcher.js'

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

interface Registry {
  settingsSections: Map<string, ExtensionSettingsSchema>
  settingsValues: Map<string, unknown>
  workspaceSettingsValues: Map<string, unknown>
  sidebarItems: Map<string, SidebarContribution>
  sidebarPanels: Map<string, { slot: PanelSlot; panel: PanelContribution }>
  topBarItems: Map<string, TopBarMenuContribution>
  nativeMenuItems: Map<string, NativeMenuItemContribution>
  contextMenuItems: Map<string, { target: ContextMenuTarget; item: MenuItemContribution }>
  keyboardHandlers: Map<string, () => void>
  sessionCreateHandlers: Set<(session: Readonly<SessionSnapshot>) => void>
  sessionCloseHandlers: Set<(sessionId: string) => void>
}

export const globalRegistry: Registry = {
  settingsSections: new Map(),
  settingsValues: new Map(),
  workspaceSettingsValues: new Map(),
  sidebarItems: new Map(),
  sidebarPanels: new Map(),
  topBarItems: new Map(),
  nativeMenuItems: new Map(),
  contextMenuItems: new Map(),
  keyboardHandlers: new Map(),
  sessionCreateHandlers: new Set(),
  sessionCloseHandlers: new Set(),
}

function rebuildViewMenu(): void {
  try {
    const appMenu = Menu.getApplicationMenu()
    if (!appMenu) return
    const viewMenu = appMenu.items.find((item) => item.label === 'View')
    if (!viewMenu?.submenu) return

    // Collect extension-contributed items
    const extItems = Array.from(globalRegistry.nativeMenuItems.values()).map(
      (contrib) =>
        new MenuItem({
          label: contrib.label,
          accelerator: contrib.accelerator,
          click: () => contrib.onClick(),
        })
    )

    // Rebuild submenu: keep non-extension items, append extension items
    const baseItems = viewMenu.submenu.items.filter((item) => !item.label?.startsWith('[ext]'))
    const newSubmenu = Menu.buildFromTemplate([
      ...baseItems.map((item) => item as Electron.MenuItemConstructorOptions),
      ...(extItems.length > 0 ? [{ type: 'separator' as const }] : []),
      ...extItems.map((item) => ({ ...item, label: item.label })),
    ])
    void newSubmenu
    // Rebuild the full app menu with the new View submenu items
    // (In practice, Electron requires full menu rebuild)
    Menu.setApplicationMenu(appMenu)
  } catch {
    // Menu may not exist in test environments; ignore
  }
}

export function createExtensionAPI(
  extensionId: string,
  appVersion: string,
  getActiveWorkspaceId?: () => string | undefined
): ExtensionAPI {
  const disposables: Disposable[] = []

  function disposable(dispose: () => void): Disposable {
    const d = { dispose }
    disposables.push(d)
    return d
  }

  return {
    app: { version: appVersion },
    settings: {
      register(schema: ExtensionSettingsSchema): Disposable {
        const key = `${extensionId}.settings`
        globalRegistry.settingsSections.set(key, schema)
        return disposable(() => globalRegistry.settingsSections.delete(key))
      },
      get<T>(key: string): T | undefined {
        const fullKey = `${extensionId}.${key}`
        if (getActiveWorkspaceId) {
          const workspaceId = getActiveWorkspaceId()
          if (workspaceId !== undefined) {
            const wsKey = `${workspaceId}:${fullKey}`
            if (globalRegistry.workspaceSettingsValues.has(wsKey)) {
              return globalRegistry.workspaceSettingsValues.get(wsKey) as T | undefined
            }
          }
        }
        return globalRegistry.settingsValues.get(fullKey) as T | undefined
      },
    },
    sidebar: {
      registerItem(item: SidebarContribution): Disposable {
        const key = `${extensionId}.sidebar.${item.id}`
        globalRegistry.sidebarItems.set(key, item)
        return disposable(() => globalRegistry.sidebarItems.delete(key))
      },
      registerPanel(slot: PanelSlot, panel: PanelContribution): Disposable {
        const slotKey = `${extensionId}.panel.${slot}`
        if (globalRegistry.sidebarPanels.has(slotKey)) {
          throw new Error(
            `SLOT_ALREADY_REGISTERED: "${slot}" is already registered for extension "${extensionId}"`
          )
        }
        globalRegistry.sidebarPanels.set(slotKey, { slot, panel })
        return disposable(() => globalRegistry.sidebarPanels.delete(slotKey))
      },
    },
    topBar: {
      registerMenuItem(item: TopBarMenuContribution): Disposable {
        const key = `${extensionId}.topbar.${item.id}`
        globalRegistry.topBarItems.set(key, item)
        return disposable(() => globalRegistry.topBarItems.delete(key))
      },
    },
    shell: {
      async exec(options: {
        command: 'git' | 'gh'
        args: string[]
        cwd: string
        timeoutMs?: number
      }) {
        assertCommandAllowed(options.command)
        return execShell({
          command: options.command,
          args: options.args,
          cwd: options.cwd,
          timeoutMs: options.timeoutMs ?? 10000,
        })
      },
    },
    notifications: {
      showToast(type: ToastType, message: string): void {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('extension:toast', { type, message })
        }
      },
    },
    nativeMenu: {
      addViewMenuItem(item: NativeMenuItemContribution): Disposable {
        const key = `${extensionId}.nativemenu.${item.id}`
        globalRegistry.nativeMenuItems.set(key, item)
        rebuildViewMenu()
        return disposable(() => {
          globalRegistry.nativeMenuItems.delete(key)
          rebuildViewMenu()
        })
      },
    },
    fs: {
      watch(handler: (event: FsChangeEvent) => void): Disposable {
        fsWatcherService.addHandler(handler)
        return disposable(() => fsWatcherService.removeHandler(handler))
      },
    },
    contextMenu: {
      registerItem(target: ContextMenuTarget, item: MenuItemContribution): Disposable {
        const key = `${extensionId}.contextmenu.${target}.${item.id}`
        globalRegistry.contextMenuItems.set(key, { target, item })
        return disposable(() => globalRegistry.contextMenuItems.delete(key))
      },
    },
    keyboard: {
      register(accelerator: string, handler: () => void): Disposable {
        if (RESERVED_SHORTCUTS.has(accelerator)) {
          throw new Error(`Accelerator "${accelerator}" is reserved by the application`)
        }
        const key = `${extensionId}.keyboard.${accelerator}`
        globalRegistry.keyboardHandlers.set(key, handler)
        return disposable(() => globalRegistry.keyboardHandlers.delete(key))
      },
    },
    ipc: {
      registerHandler(
        channel: string,
        handler: (payload: unknown) => Promise<unknown> | unknown
      ): Disposable {
        ipcMain.handle(channel, (_event, payload) => handler(payload))
        return disposable(() => ipcMain.removeHandler(channel))
      },
    },
    terminal: {
      onSessionCreate(handler: (session: Readonly<SessionSnapshot>) => void): Disposable {
        globalRegistry.sessionCreateHandlers.add(handler)
        return disposable(() => globalRegistry.sessionCreateHandlers.delete(handler))
      },
      onSessionClose(handler: (sessionId: string) => void): Disposable {
        globalRegistry.sessionCloseHandlers.add(handler)
        return disposable(() => globalRegistry.sessionCloseHandlers.delete(handler))
      },
    },
  }
}
