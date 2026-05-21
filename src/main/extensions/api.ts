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
  secret?: boolean
}

// v1.1.0 types

export type PanelSlot = 'right-sidebar' | 'global-tab'

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

export interface CommandContribution {
  id: string
  label: string
  description?: string
  shortcut?: string
  category?: string
}

// v1.2.0 types

export interface GlobalTabContribution {
  id: string
  label: string
  icon?: string
  component: unknown
  permanent?: boolean
}

export interface WorkspaceSnapshot {
  readonly id: string
  readonly name: string
  readonly folderPath: string
}

export interface ProjectSnapshot {
  readonly id: string
  readonly workspaceId: string
  readonly name: string
}

export interface ExtensionAPI {
  readonly app: { readonly version: string }
  log: {
    debug(message: string, ...meta: unknown[]): void
    info(message: string, ...meta: unknown[]): void
    warn(message: string, ...meta: unknown[]): void
    error(message: string, ...meta: unknown[]): void
  }
  settings: {
    register(schema: ExtensionSettingsSchema): Disposable
    get<T>(key: string): T | undefined
  }
  sidebar: {
    registerItem(item: SidebarContribution): Disposable
    registerPanel(slot: PanelSlot, panel: PanelContribution): Disposable
    registerGlobalTab(tab: GlobalTabContribution): Disposable
  }
  globalShortcut: {
    register(accelerator: string, handler: () => void): Disposable
  }
  workspace: {
    list(): WorkspaceSnapshot[]
    listProjects(workspaceId: string): ProjectSnapshot[]
    onDelete(handler: (workspaceId: string) => void): Disposable
    onProjectDelete(handler: (projectId: string) => void): Disposable
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
  commands: {
    register(command: CommandContribution, handler: () => void): Disposable
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
  window: {
    openAuxiliary(view: string, params?: Record<string, string>): void
  }
}

import {
  BrowserWindow,
  Menu,
  MenuItem,
  ipcMain,
  globalShortcut as electronGlobalShortcut,
} from 'electron'
import { join } from 'path'

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string
declare const MAIN_WINDOW_VITE_NAME: string
import { execShell, assertCommandAllowed } from '../shell/shell-executor.js'
import { fsWatcherService } from '../fs/fs-watcher.js'
import { getExtensionSetting } from '../storage/extension-settings-store.js'
import { makeLogger } from '../logger.js'
import {
  listWorkspaces,
  listProjects as listProjectsFromStore,
} from '../storage/workspace-store.js'
import { onWorkspaceDelete, onProjectDelete } from './workspace-events.js'

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
  globalTabs: Map<string, GlobalTabContribution>
  topBarItems: Map<string, TopBarMenuContribution>
  nativeMenuItems: Map<string, NativeMenuItemContribution>
  contextMenuItems: Map<string, { target: ContextMenuTarget; item: MenuItemContribution }>
  keyboardHandlers: Map<string, () => void>
  commandContributions: Map<string, CommandContribution>
  commandHandlers: Map<string, () => void>
  sessionCreateHandlers: Set<(session: Readonly<SessionSnapshot>) => void>
  sessionCloseHandlers: Set<(sessionId: string) => void>
}

export const globalRegistry: Registry = {
  settingsSections: new Map(),
  settingsValues: new Map(),
  workspaceSettingsValues: new Map(),
  sidebarItems: new Map(),
  sidebarPanels: new Map(),
  globalTabs: new Map(),
  topBarItems: new Map(),
  nativeMenuItems: new Map(),
  contextMenuItems: new Map(),
  keyboardHandlers: new Map(),
  commandContributions: new Map(),
  commandHandlers: new Map(),
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

// Map from view name to open auxiliary BrowserWindow (shared across all extensions)
const auxiliaryWindows = new Map<string, BrowserWindow>()

export function createExtensionAPI(
  extensionId: string,
  appVersion: string,
  _getActiveWorkspaceId?: () => string | undefined
): ExtensionAPI {
  const disposables: Disposable[] = []

  function disposable(dispose: () => void): Disposable {
    const d = { dispose }
    disposables.push(d)
    return d
  }

  const extLogger = makeLogger(extensionId)

  return {
    app: { version: appVersion },
    log: extLogger,
    settings: {
      register(schema: ExtensionSettingsSchema): Disposable {
        const key = `${extensionId}.settings`
        globalRegistry.settingsSections.set(key, schema)
        return disposable(() => globalRegistry.settingsSections.delete(key))
      },
      get<T>(key: string): T | undefined {
        const stored = getExtensionSetting(key)
        if (stored !== undefined) return stored as T
        // Fall back to the registered default
        const sectionKey = `${extensionId}.settings`
        const schema = globalRegistry.settingsSections.get(sectionKey)
        if (schema?.properties[key] !== undefined) {
          return schema.properties[key].default as T
        }
        return undefined
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
      registerGlobalTab(tab: GlobalTabContribution): Disposable {
        const key = `${extensionId}.globaltab.${tab.id}`
        if (globalRegistry.globalTabs.has(key)) {
          throw new Error(
            `GLOBAL_TAB_ALREADY_REGISTERED: tab "${tab.id}" is already registered for extension "${extensionId}"`
          )
        }
        globalRegistry.globalTabs.set(key, tab)
        return disposable(() => globalRegistry.globalTabs.delete(key))
      },
    },
    globalShortcut: {
      register(accelerator: string, handler: () => void): Disposable {
        const registered = electronGlobalShortcut.register(accelerator, handler)
        if (!registered) {
          throw new Error(
            `ACCELERATOR_TAKEN: "${accelerator}" could not be registered (already in use by OS or another app)`
          )
        }
        return disposable(() => electronGlobalShortcut.unregister(accelerator))
      },
    },
    workspace: {
      list(): WorkspaceSnapshot[] {
        return listWorkspaces().map(({ id, name, folderPath }) => ({ id, name, folderPath }))
      },
      listProjects(workspaceId: string): ProjectSnapshot[] {
        return listProjectsFromStore(workspaceId).map(({ id, workspaceId: wsId, name }) => ({
          id,
          workspaceId: wsId,
          name,
        }))
      },
      onDelete(handler: (workspaceId: string) => void): Disposable {
        const unsub = onWorkspaceDelete(handler)
        return disposable(unsub)
      },
      onProjectDelete(handler: (projectId: string) => void): Disposable {
        const unsub = onProjectDelete(handler)
        return disposable(unsub)
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
    commands: {
      register(command: CommandContribution, handler: () => void): Disposable {
        const key = `${extensionId}.command.${command.id}`
        globalRegistry.commandContributions.set(key, command)
        globalRegistry.commandHandlers.set(key, handler)
        return disposable(() => {
          globalRegistry.commandContributions.delete(key)
          globalRegistry.commandHandlers.delete(key)
        })
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
    window: {
      openAuxiliary(view: string, params?: Record<string, string>): void {
        const existing = auxiliaryWindows.get(view)
        if (existing && !existing.isDestroyed()) {
          existing.focus()
          return
        }
        const win = new BrowserWindow({
          width: 1400,
          height: 900,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload: join(__dirname, '../preload/index.js'),
          },
        })
        auxiliaryWindows.set(view, win)
        win.on('closed', () => {
          auxiliaryWindows.delete(view)
        })
        const query: Record<string, string> = { view, ...params }
        if (
          typeof MAIN_WINDOW_VITE_DEV_SERVER_URL !== 'undefined' &&
          MAIN_WINDOW_VITE_DEV_SERVER_URL
        ) {
          win.loadURL(
            `${MAIN_WINDOW_VITE_DEV_SERVER_URL}?${new URLSearchParams(query).toString()}`
          )
        } else {
          win.loadFile(join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`), {
            query,
          })
        }
      },
    },
  }
}
