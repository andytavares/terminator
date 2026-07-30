export interface Disposable {
  dispose(): void
}

export interface ExtensionSettingsSchema {
  label: string
  description?: string
  properties: Record<string, SettingDefinition>
}

export interface SettingDefinition {
  type: 'string' | 'number' | 'boolean' | 'enum' | 'folder' | 'action'
  label: string
  description?: string
  default: unknown
  options?: string[]
  min?: number
  max?: number
  workspaceScoped?: boolean
  secret?: boolean
  channel?: string
  confirmMessage?: string
  danger?: boolean
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
  /** When set to 'checkbox', renders as a checkable menu item. */
  type?: 'checkbox'
  /** Panel ID that this menu item toggles. Used to update the checked state when the panel opens/closes. */
  panelId?: string
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

// Canonical session-authority types live with the authority (pty-manager.ts);
// re-exported here so the ExtensionAPI contract exposes them.
import type { SessionOrigin, SpawnSessionOptions, SessionInfo } from '../terminal/pty-manager.js'
export type { SessionOrigin, SpawnSessionOptions, SessionInfo }

export interface PtyManagerAPI {
  /** @deprecated since v1.4.0 — use spawnSession() plus onData()/onExit(). */
  spawn(
    sessionId: string,
    cwd: string,
    shell: string,
    type: 'human' | 'agent',
    onData: (data: string) => void,
    onExit: (exitCode: number) => void
  ): string
  /** v1.4.0 — spawn with metadata; subscribe output/exit separately via onData/onExit. */
  spawnSession(opts: SpawnSessionOptions): SessionInfo
  /**
   * Spawns a terminal and puts it on screen as an ordinary tab.
   *
   * `spawnSession` gives an extension a process and a data stream, but nothing
   * the operator can see or type into — the renderer owns the tab list and does
   * not know the session exists. This creates both, and holds the process's
   * output until the tab is actually mounted, so the first thing it printed is
   * not delivered to nobody.
   *
   * Returns the terminal session id, or null when there is no window to show it
   * in.
   */
  openTerminalTab(input: OpenTerminalTabInput): string | null
  /** v1.4.0 — multi-subscriber output fan-out. Returns a disposer, or null if unknown. */
  onData(sessionId: string, listener: (data: string) => void): (() => void) | null
  /** v1.4.0 — multi-subscriber exit fan-out. Listeners fire after the session is removed. */
  onExit(sessionId: string, listener: (exitCode: number) => void): (() => void) | null
  /** v1.4.0 */
  getSession(sessionId: string): SessionInfo | undefined
  /** v1.4.0 — stamps workspace metadata on the session (null clears it). */
  setWorkspace(sessionId: string, workspaceId: string | null): boolean
  write(sessionId: string, data: string): void
  resize(sessionId: string, cols: number, rows: number): void
  kill(sessionId: string): void
  listSessions(): SessionInfo[]
  /** @deprecated since v1.4.0 — alias of onData(). */
  attachOnData(sessionId: string, onData: (data: string) => void): (() => void) | null
  /** @deprecated since v1.4.0 — alias of onExit(). */
  attachOnExit(sessionId: string, onExit: (exitCode: number) => void): (() => void) | null
}

export interface BridgeDeps {
  invokeRegistry: Map<string, import('../remote/ipc-registry.js').IpcRegistryEntry>
  sendRegistry: Map<string, (event: never, payload: unknown) => void>
  eventBus: import('events').EventEmitter
}

export type { ExtensionDB } from '../db/index.js'

export interface CreateProjectInput {
  workspaceId: string
  name: string
  /** The directory the project points at — a worktree, or any checkout. */
  worktreePath: string
  gitBranch?: string
  /** True when the directory is a git worktree rather than a plain folder. */
  isWorktree?: boolean
}

export interface OpenTerminalTabInput {
  /** Where the tab appears. From `workspace.createProject`, normally. */
  projectId: string
  cwd: string
  tabTitle: string
  /** Marks whose terminal it is. A person can still type in an agent's. */
  type?: 'human' | 'agent'
  shell?: string
  scrollbackLimit?: number
}

export interface ExtensionAPI {
  db: import('../db/index.js').ExtensionDB
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
    set(key: string, value: unknown): void
    /**
     * The resolved worktree base directory for a workspace, matching how the
     * core app decides where git worktrees go: a workspace-specific override
     * wins, then the global `git.worktreeBaseDir` setting, then the default
     * `<workspacePath>/.worktrees`. Always returns an absolute-style path.
     */
    resolveWorktreeBaseDir(workspacePath: string): string
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
    /**
     * Registers a directory as a project in a workspace, so it appears in the
     * sidebar and can hold terminals.
     *
     * An extension that provisions a git worktree has, until now, had nowhere
     * to put it: the checkout existed and nothing on screen ever showed it.
     * Returns the existing project when the workspace already has one for that
     * path, so provisioning the same branch twice lands in the project you were
     * already looking at rather than beside it.
     */
    createProject(input: CreateProjectInput): ProjectSnapshot | null
    deleteProject(projectId: string): void
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
    /**
     * `key` identifies this specific notification kind (unique within this
     * extension, e.g. 'taskCompleted') so the user can configure its delivery
     * target(s) independently of every other notification this extension
     * sends. Register matching settings via api.settings.register() —
     * `${extensionId}.notify.${key}.system` / `.center` / `.toast` (booleans)
     * — so they appear in this extension's own settings panel.
     */
    showToast(type: ToastType, message: string, key: string): void
    createNotification(opts: {
      type: ToastType
      title: string
      message?: string
      key: string
      actions?: Array<{ id: string; label: string; handler: () => void }>
    }): Disposable
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
    /**
     * Registers a main-process handler for an extension-owned channel.
     * Extension channels are dispatchable by the remote-control bridge by
     * default; pass `remoteAccessible: false` to keep a channel local-only.
     */
    registerHandler(
      channel: string,
      handler: (payload: unknown) => Promise<unknown> | unknown,
      opts?: { remoteAccessible?: boolean }
    ): Disposable
    invokeChannel(channel: string, payload: unknown): Promise<unknown>
    sendChannel(channel: string, payload: unknown): void
    onWindowEvent(channel: string, handler: (...args: unknown[]) => void): () => void
    isRemoteAccessible(channel: string): boolean
  }
  terminal: {
    onSessionCreate(handler: (session: Readonly<SessionSnapshot>) => void): Disposable
    onSessionClose(handler: (sessionId: string) => void): Disposable
  }
  pty: PtyManagerAPI
  window: {
    openAuxiliary(view: string, params?: Record<string, string>): void
    broadcast(channel: string, data: unknown): void
    focusSelf(viewParam?: string): void
  }
}

import { handleChannel, removeChannel } from '../ipc/channel-registrar.js'
import { BrowserWindow, globalShortcut as electronGlobalShortcut } from 'electron'
import { EXTENSION_BASE_CSS } from './extension-view-host.js'
import { join } from 'path'

import { execShell, assertCommandAllowed } from '../shell/shell-executor.js'
import { fsWatcherService } from '../fs/fs-watcher.js'
import {
  notificationManager,
  setExtensionNotificationSettingReader,
} from '../notifications/notification-manager.js'
import type { NotificationTarget } from '../notifications/notification-manager.js'
import { getExtensionSetting, setExtensionSetting } from '../storage/extension-settings-store.js'
import { getGlobalSettings, getWorkspaceSettings } from '../storage/settings-store.js'
import { basename } from 'path'
import { randomUUID } from 'crypto'
import { makeLogger } from '../logger.js'
import {
  listWorkspaces,
  listProjects as listProjectsFromStore,
  createProject as createProjectInStore,
  deleteProject as deleteProjectFromStore,
} from '../storage/workspace-store.js'
import { onWorkspaceDelete, onProjectDelete } from './workspace-events.js'
import { RESERVED_SHORTCUTS } from '../shared/reserved-shortcuts.js'
import { REMOTE_ACCESSIBLE_CHANNELS } from '../remote/remote-accessible-channels.js'

interface Registry {
  settingsSections: Map<string, ExtensionSettingsSchema>
  settingsValues: Map<string, unknown>
  workspaceSettingsValues: Map<string, unknown>
  sidebarItems: Map<string, SidebarContribution>
  sidebarPanels: Map<string, { slot: PanelSlot; panel: PanelContribution }>
  globalTabs: Map<string, GlobalTabContribution>
  topBarItems: Map<string, TopBarMenuContribution>
  nativeMenuItems: Map<string, NativeMenuItemContribution>
  /** Maps panel ID → Electron menu item id for checkbox menu items registered by extensions. */
  panelMenuItemIds: Map<string, string>
  contextMenuItems: Map<string, { target: ContextMenuTarget; item: MenuItemContribution }>
  keyboardHandlers: Map<string, () => void>
  commandContributions: Map<string, CommandContribution>
  commandHandlers: Map<string, () => void>
  sessionCreateHandlers: Set<(session: Readonly<SessionSnapshot>) => void>
  sessionCloseHandlers: Set<(sessionId: string) => void>
}

// Internal to this module (and its tests). Other modules use the registry
// query functions below — never the raw collections, so the string-key
// conventions stay encapsulated here.
export const globalRegistry: Registry = {
  settingsSections: new Map(),
  settingsValues: new Map(),
  workspaceSettingsValues: new Map(),
  sidebarItems: new Map(),
  sidebarPanels: new Map(),
  globalTabs: new Map(),
  topBarItems: new Map(),
  nativeMenuItems: new Map(),
  panelMenuItemIds: new Map(),
  contextMenuItems: new Map(),
  keyboardHandlers: new Map(),
  commandContributions: new Map(),
  commandHandlers: new Map(),
  sessionCreateHandlers: new Set(),
  sessionCloseHandlers: new Set(),
}

// Resolves an extension's own per-notification-key delivery-target settings
// (3 booleans: `${extensionId}.notify.${key}.{system,center,toast}`), falling
// back to the extension's own registered schema default the same way
// settings.get<T>() does below. Injected into notification-manager.ts (rather
// than imported there) to avoid a circular dependency, since this module
// already imports notification-manager.ts for createNotification/showToast.
setExtensionNotificationSettingReader((extensionId, key) => {
  const prefix = `${extensionId}.notify.${key}`
  const schema = globalRegistry.settingsSections.get(`${extensionId}.settings`)
  const readBoolean = (suffix: 'system' | 'center' | 'toast'): boolean | undefined => {
    const fullKey = `${prefix}.${suffix}`
    const stored = getExtensionSetting(fullKey)
    if (stored !== undefined) return stored as boolean
    return schema?.properties[fullKey]?.default as boolean | undefined
  }
  const system = readBoolean('system')
  const center = readBoolean('center')
  const toast = readBoolean('toast')
  if (system === undefined && center === undefined && toast === undefined) return null
  const targets: NotificationTarget[] = []
  if (system) targets.push('system')
  if (center) targets.push('center')
  if (toast) targets.push('toast')
  return targets
})

// Callback set by the main process so api.ts can trigger a full menu rebuild
// without importing from index.ts (which would create a circular dependency).
let menuRebuildCallback: (() => void) | null = null

export function setMenuRebuildCallback(fn: () => void): void {
  menuRebuildCallback = fn
}

function rebuildViewMenu(): void {
  // Repopulate panelMenuItemIds from current contribution state so that
  // menu:set-panel-checked IPC can find the correct MenuItem by ID.
  globalRegistry.panelMenuItemIds.clear()
  for (const contrib of globalRegistry.nativeMenuItems.values()) {
    if (contrib.panelId) {
      globalRegistry.panelMenuItemIds.set(contrib.panelId, `ext-menu-${contrib.id}`)
    }
  }

  // Delegate the actual Electron menu rebuild to the main process so the full
  // application menu is always reconstructed from MenuItemConstructorOptions.
  // Rebuilding from live MenuItem objects (appMenu.items) loses accelerator and
  // click-handler bindings — the callback avoids that by using the original template.
  menuRebuildCallback?.()
}

// ── Registry queries ─────────────────────────────────────────────────────────
// The only supported registry access outside this module. The string-key
// conventions (`${extensionId}.settings`, `ext-menu-${id}`, …) are minted by
// the registration code above; these functions keep their decoding here too,
// so no other module re-derives key formats.

export function listExtensionSettingsSections(): Array<{
  extensionId: string
  label: string
  properties: ExtensionSettingsSchema['properties']
}> {
  return [...globalRegistry.settingsSections.entries()].map(([key, schema]) => ({
    extensionId: key.replace(/\.settings$/, ''),
    label: schema.label,
    properties: schema.properties,
  }))
}

export function listExtensionSidebarItems(): Array<{
  id: string
  label: string
  tooltip?: string
}> {
  return [...globalRegistry.sidebarItems.values()].map((item) => ({
    id: item.id,
    label: item.label,
    tooltip: item.tooltip,
  }))
}

export function listExtensionContextMenuItems(
  target: string
): Array<{ id: string; label: string }> {
  return [...globalRegistry.contextMenuItems.values()]
    .filter((entry) => entry.target === target)
    .map((entry) => ({ id: entry.item.id, label: entry.item.label }))
}

export function dispatchContextMenuClick(target: string, itemId: string, targetId: string): void {
  for (const entry of globalRegistry.contextMenuItems.values()) {
    if (entry.target === target && entry.item.id === itemId) {
      entry.item.onClick(targetId)
      break
    }
  }
}

export function listExtensionCommands(): Array<{
  key: string
  id: string
  label: string
  description?: string
  shortcut?: string
  category?: string
}> {
  return [...globalRegistry.commandContributions.entries()].map(([key, cmd]) => ({
    key,
    id: cmd.id,
    label: cmd.label,
    description: cmd.description,
    shortcut: cmd.shortcut,
    category: cmd.category,
  }))
}

export function executeExtensionCommand(key: string): void {
  globalRegistry.commandHandlers.get(key)?.()
}

/**
 * Extension entries for the native View menu. Also records the
 * panelId → menu-item-id mapping so getPanelMenuItemId() can resolve checkbox
 * items when panel state changes.
 */
export function listNativeViewMenuItems(): Array<{
  id: string
  label: string
  accelerator?: string
  type: 'checkbox' | 'normal'
  onClick: () => void
}> {
  return [...globalRegistry.nativeMenuItems.values()].map((contrib) => {
    const id = `ext-menu-${contrib.id}`
    if (contrib.panelId) globalRegistry.panelMenuItemIds.set(contrib.panelId, id)
    return {
      id,
      label: contrib.label,
      accelerator: contrib.accelerator,
      type: contrib.type === 'checkbox' ? ('checkbox' as const) : ('normal' as const),
      onClick: () => contrib.onClick(),
    }
  })
}

export function getPanelMenuItemId(panelId: string): string | undefined {
  return globalRegistry.panelMenuItemIds.get(panelId)
}

// Map from view name to open auxiliary BrowserWindow (shared across all extensions)
const auxiliaryWindows = new Map<string, BrowserWindow>()

export interface ExtensionAPIDeps {
  ptyManager?: PtyManagerAPI
  broadcastToWindows?: (channel: string, data: unknown) => void
  focusExtensionView?: (extensionId: string, viewParam: string) => void
  bridge?: BridgeDeps
  db?: import('../db/index.js').ExtensionDB
}

export function createExtensionAPI(
  extensionId: string,
  appVersion: string,
  deps?: ExtensionAPIDeps,
  rendererUrl?: string
): ExtensionAPI {
  const disposables: Disposable[] = []

  function disposable(dispose: () => void): Disposable {
    const d = { dispose }
    disposables.push(d)
    return d
  }

  const extLogger = makeLogger(extensionId)

  const notReady = (): never => {
    throw new Error(`Extension "${extensionId}": AppDB not initialized`)
  }
  const dbStub: import('../db/index.js').ExtensionDB = {
    exec: notReady,
    query: notReady,
    get: notReady,
    run: notReady,
    transaction: notReady,
  }

  const api: ExtensionAPI = {
    app: { version: appVersion },
    db: deps?.db ?? dbStub,
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
      set(key: string, value: unknown): void {
        setExtensionSetting(key, value)
      },
      resolveWorktreeBaseDir(workspacePath: string): string {
        const globalDir = getGlobalSettings().git?.worktreeBaseDir ?? ''
        const ws = listWorkspaces().find((w) => w.folderPath === workspacePath)
        const overrideDir = ws
          ? (getWorkspaceSettings(ws.id).overrides?.git?.worktreeBaseDir ?? '')
          : ''
        const base = (overrideDir || globalDir).trim()
        return base.length > 0 ? base : join(workspacePath, '.worktrees')
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
      createProject(input): ProjectSnapshot | null {
        // Reused rather than duplicated: provisioning the same worktree twice
        // should land in the project you were already looking at.
        //
        // By path only. Matching on the name as well meant two cards whose
        // branches happened to share a name got one project — pointing at
        // whichever worktree was registered first — and the snapshot returned
        // described a different directory than the caller had asked for.
        const existing = listProjectsFromStore(input.workspaceId).find(
          (project) => project.worktreePath === input.worktreePath
        )
        if (existing !== undefined) {
          return { id: existing.id, workspaceId: existing.workspaceId, name: existing.name }
        }
        const create = (name: string) =>
          createProjectInStore({
            workspaceId: input.workspaceId,
            name,
            worktreePath: input.worktreePath,
            gitBranch: input.gitBranch,
            isWorktree: input.isWorktree ?? true,
          })

        let created = create(input.name)
        if ('error' in created && created.error === 'DUPLICATE_NAME') {
          // A different worktree that happens to share a branch name. The store
          // keeps names unique per workspace, so disambiguate rather than
          // return null — the caller's alternative is running the agent with
          // nowhere to show it.
          created = create(`${input.name} (${basename(input.worktreePath)})`)
        }
        if (!('project' in created)) return null
        const { id, workspaceId, name } = created.project
        deps?.broadcastToWindows?.('workspace:project-added', created.project)
        return { id, workspaceId, name }
      },
      deleteProject(projectId: string): void {
        deleteProjectFromStore(projectId)
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
      showToast(type: ToastType, message: string, key: string): void {
        notificationManager.create({ type, title: message, source: extensionId, key })
      },
      createNotification(opts: {
        type: ToastType
        title: string
        message?: string
        key: string
        actions?: Array<{ id: string; label: string; handler: () => void }>
      }): Disposable {
        const id = notificationManager.create({
          type: opts.type,
          title: opts.title,
          message: opts.message,
          source: extensionId,
          key: opts.key,
          actions: opts.actions,
        })
        return disposable(() => notificationManager.dismiss(id))
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
        handler: (payload: unknown) => Promise<unknown> | unknown,
        opts?: { remoteAccessible?: boolean }
      ): Disposable {
        handleChannel(channel, (_event, payload) => handler(payload), {
          remoteAccessible: opts?.remoteAccessible ?? true,
        })
        return disposable(() => removeChannel(channel))
      },
      async invokeChannel(channel: string, payload: unknown): Promise<unknown> {
        const entry = deps?.bridge?.invokeRegistry.get(channel)
        if (!entry) return undefined
        return entry.handler(null as never, payload)
      },
      isRemoteAccessible(channel: string): boolean {
        // Core channels (invoke, send, and push/subscribe) are declared in the
        // channel manifest, which REMOTE_ACCESSIBLE_CHANNELS is derived from.
        if (REMOTE_ACCESSIBLE_CHANNELS.has(channel)) return true
        // Everything else is decided by what was declared at registration.
        // Registered-but-undeclared channels are NOT reachable: the old rule
        // ("any registered channel is extension-owned and safe") also exposed
        // every internal core invoke channel to authenticated remote clients.
        return deps?.bridge?.invokeRegistry.get(channel)?.remoteAccessible ?? false
      },
      sendChannel(channel: string, payload: unknown): void {
        const handler = deps?.bridge?.sendRegistry.get(channel)
        if (handler) handler(null as never, payload)
      },
      onWindowEvent(channel: string, handler: (...args: unknown[]) => void): () => void {
        deps?.bridge?.eventBus.on(channel, handler)
        return () => deps?.bridge?.eventBus.off(channel, handler)
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
    pty: {
      spawn(sessionId, cwd, shell, type, onData, onExit) {
        if (!deps?.ptyManager) throw new Error('PTY access not available in this extension context')
        return deps.ptyManager.spawn(sessionId, cwd, shell, type, onData, onExit)
      },
      spawnSession(opts) {
        if (!deps?.ptyManager) throw new Error('PTY access not available in this extension context')
        return deps.ptyManager.spawnSession(opts)
      },
      openTerminalTab(input): string | null {
        if (!deps?.ptyManager) throw new Error('PTY access not available in this extension context')
        if (!deps.broadcastToWindows) return null

        const sessionId = randomUUID()
        deps.ptyManager.spawnSession({
          sessionId,
          cwd: input.cwd,
          shell: input.shell ?? getGlobalSettings().terminal.defaultShell,
          type: input.type ?? 'agent',
          origin: 'app',
          projectId: input.projectId,
          tabTitle: input.tabTitle,
          // The tab does not exist yet: the renderer has to be told, adopt it,
          // render, and mount an xterm before anything is listening.
          holdOutput: true,
        })

        deps.ptyManager.onData(sessionId, (data) =>
          deps.broadcastToWindows?.('terminal:output', { sessionId, data })
        )
        deps.ptyManager.onExit(sessionId, (exitCode) =>
          deps.broadcastToWindows?.('terminal:process-exit', { sessionId, exitCode })
        )

        deps.broadcastToWindows('terminal:adopt', {
          sessionId,
          projectId: input.projectId,
          tabTitle: input.tabTitle,
          scrollbackLimit: input.scrollbackLimit ?? getGlobalSettings().terminal.scrollbackLimit,
        })
        return sessionId
      },
      onData(sessionId, listener) {
        return deps?.ptyManager?.onData(sessionId, listener) ?? null
      },
      onExit(sessionId, listener) {
        return deps?.ptyManager?.onExit(sessionId, listener) ?? null
      },
      getSession(sessionId) {
        return deps?.ptyManager?.getSession(sessionId)
      },
      setWorkspace(sessionId, workspaceId) {
        return deps?.ptyManager?.setWorkspace(sessionId, workspaceId) ?? false
      },
      write(sessionId, data) {
        deps?.ptyManager?.write(sessionId, data)
      },
      resize(sessionId, cols, rows) {
        deps?.ptyManager?.resize(sessionId, cols, rows)
      },
      kill(sessionId) {
        deps?.ptyManager?.kill(sessionId)
      },
      listSessions() {
        return deps?.ptyManager?.listSessions() ?? []
      },
      attachOnData(sessionId, onData) {
        return deps?.ptyManager?.attachOnData(sessionId, onData) ?? null
      },
      attachOnExit(sessionId, onExit) {
        return deps?.ptyManager?.attachOnExit(sessionId, onExit) ?? null
      },
    },
    window: {
      openAuxiliary(view: string, params?: Record<string, string>): void {
        const navigate = (win: BrowserWindow): void => {
          const query: Record<string, string> = { view, ...params }
          if (rendererUrl) {
            const url = new URL(rendererUrl)
            for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
            win.loadURL(url.toString())
          } else {
            const devUrl = process.env['ELECTRON_RENDERER_URL']
            if (devUrl) {
              win.loadURL(`${devUrl}?${new URLSearchParams(query).toString()}`)
            } else {
              win.loadFile(join(__dirname, '../renderer/index.html'), { query })
            }
          }
        }

        const existing = auxiliaryWindows.get(view)
        if (existing && !existing.isDestroyed()) {
          // Re-navigate an already-open auxiliary window when the caller hands
          // through specific context (e.g. the active PR being reviewed) —
          // otherwise a bare re-open (no params) just refocuses it as-is.
          if (params && Object.keys(params).length > 0) navigate(existing)
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
        if (rendererUrl) {
          // Load the extension's own renderer directly so it handles the view param natively,
          // without needing to create a WebContentsView inside the auxiliary window.
          win.webContents.on('did-finish-load', () => {
            win.webContents.insertCSS(EXTENSION_BASE_CSS).catch(() => {})
          })
        }
        navigate(win)
      },
      broadcast(channel: string, data: unknown): void {
        if (deps?.broadcastToWindows) {
          deps.broadcastToWindows(channel, data)
        } else {
          for (const win of BrowserWindow.getAllWindows()) {
            if (!win.isDestroyed()) win.webContents.send(channel, data)
          }
        }
      },
      focusSelf(viewParam = 'main'): void {
        deps?.focusExtensionView?.(extensionId, viewParam)
      },
    },
  }

  // The live disposables array (registrations keep pushing into it after
  // activate) is exposed to the ExtensionHost via getApiDisposables so
  // unload/reload/toggle can dispose everything the extension registered.
  apiDisposables.set(api, disposables)
  return api
}

const apiDisposables = new WeakMap<ExtensionAPI, Disposable[]>()

/**
 * The disposables collected by an api instance created with
 * createExtensionAPI. The array is live — registrations made after activate()
 * still land in it. Used by ExtensionHost to clean up on unload.
 */
export function getApiDisposables(api: ExtensionAPI): Disposable[] {
  return apiDisposables.get(api) ?? []
}
