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
}

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
  }
  contextMenu: {
    registerItem(target: ContextMenuTarget, item: MenuItemContribution): Disposable
  }
  keyboard: {
    register(accelerator: string, handler: () => void): Disposable
  }
  terminal: {
    onSessionCreate(handler: (session: Readonly<SessionSnapshot>) => void): Disposable
    onSessionClose(handler: (sessionId: string) => void): Disposable
  }
}

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
  sidebarItems: Map<string, SidebarContribution>
  contextMenuItems: Map<string, { target: ContextMenuTarget; item: MenuItemContribution }>
  keyboardHandlers: Map<string, () => void>
  sessionCreateHandlers: Set<(session: Readonly<SessionSnapshot>) => void>
  sessionCloseHandlers: Set<(sessionId: string) => void>
}

export const globalRegistry: Registry = {
  settingsSections: new Map(),
  settingsValues: new Map(),
  sidebarItems: new Map(),
  contextMenuItems: new Map(),
  keyboardHandlers: new Map(),
  sessionCreateHandlers: new Set(),
  sessionCloseHandlers: new Set(),
}

export function createExtensionAPI(extensionId: string, appVersion: string): ExtensionAPI {
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
        return globalRegistry.settingsValues.get(`${extensionId}.${key}`) as T | undefined
      },
    },
    sidebar: {
      registerItem(item: SidebarContribution): Disposable {
        const key = `${extensionId}.sidebar.${item.id}`
        globalRegistry.sidebarItems.set(key, item)
        return disposable(() => globalRegistry.sidebarItems.delete(key))
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
