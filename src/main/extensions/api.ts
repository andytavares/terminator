import { dispatchChannel } from '@terminator/extension-sdk'
import type {
  ChannelSpec,
  CommandContext,
  CommandContribution,
  Disposable,
  ExtensionAPI,
  ExtensionDB,
  ExtensionSettingsSchema,
  Issue,
  IssueListResult,
  NativeMenuItemContribution,
  NewIssueInput,
  OpenTerminalTabInput,
  ProjectSnapshot,
  RegisterHandlerOptions,
  SessionSnapshot,
  ShellExecOptions,
  ToastType,
  TrackerConnection,
  TrackerId,
  TrackerStateOption,
  TerminalExit,
  TrackerTeam,
  TransitionIntent,
  WorkspaceSnapshot,
} from '@terminator/extension-sdk'
import type { PtyManager } from '../terminal/pty-manager.js'
import type { OutputRelay } from '../terminal/output-relay.js'
import { matchesBranchPattern } from '../git/branch-exclude.js'
import { branchExcludePatternsFor } from '../git/branch-exclude-settings.js'

/** Outcome of running a command by id: `reason` is 'not-registered' or 'invalid-args: …'. */
export type CommandRunResult = { ok: true } | { ok: false; reason: string }

export interface BridgeDeps {
  invokeRegistry: Map<string, import('../remote/ipc-registry.js').IpcRegistryEntry>
  sendRegistry: Map<string, (event: never, payload: unknown) => void>
  eventBus: import('events').EventEmitter
}

import { handleChannel, removeChannel } from '../ipc/channel-registrar.js'
import { BrowserWindow, dialog, globalShortcut as electronGlobalShortcut } from 'electron'
import { EXTENSION_BASE_CSS } from './extension-view-host.js'
import { sendToWindow } from '../safe-send.js'
import { join } from 'path'

import {
  execShell,
  assertCommandAllowed,
  assertCwdInScope,
  type ShellExecInput,
} from '../shell/shell-executor.js'
import { extensionShellRoots } from './shell-roots.js'
import { createGithubApi } from '../github/github-api.js'
import {
  notificationManager,
  setExtensionNotificationSettingReader,
} from '../notifications/notification-manager.js'
import type { NotificationTarget } from '../notifications/notification-manager.js'
import { getExtensionSetting, setExtensionSetting } from '../storage/extension-settings-store.js'
import { getGlobalSettings } from '../storage/settings-store.js'
import { basename } from 'path'
import { randomUUID } from 'crypto'
import { makeLogger } from '../logger.js'

const apiLog = makeLogger('extension-api')
import {
  listWorkspaces,
  listProjects as listProjectsFromStore,
  createProject as createProjectInStore,
  deleteProject as deleteProjectFromStore,
} from '../storage/workspace-store.js'
import { emitProjectDelete } from './workspace-events.js'
import { getIssueService } from '../integrations/index.js'
import { listConnections as listTrackerConnections } from '../integrations/tracker-store.js'
import { setLink as setIssueLink } from '../integrations/issue-link-store.js'
import { REMOTE_ACCESSIBLE_CHANNELS } from '../remote/remote-accessible-channels.js'
import { BatchedPtyStream } from './pty-stream.js'

// Extension bundles are plain JavaScript at run time; a handler without a
// schema would otherwise fail only when its first payload arrives (ADR 096).
function assertChannelSpec(spec: unknown): asserts spec is ChannelSpec {
  const candidate = spec as Partial<ChannelSpec> | null
  if (typeof candidate?.channel === 'string' && candidate.schema !== undefined) return
  throw new TypeError('registerHandler needs a ChannelSpec with a schema (ADR 096)')
}

/**
 * Attach the issue a caller said the project is for (v2.2.0).
 *
 * Best-effort and never fatal: an extension that provisioned a worktree has
 * done the expensive part, and failing the whole call because a link could not
 * be written would cost the operator the checkout.
 */
function attachIssueToProject(
  projectId: string,
  issue: { tracker: TrackerId; key: string } | undefined
): void {
  if (issue === undefined) return
  void setIssueLink({ projectId, tracker: issue.tracker, key: issue.key }).catch((error) => {
    apiLog.warn(`Could not attach ${issue.key} to project ${projectId}: ${String(error)}`)
  })
}

interface Registry {
  settingsSections: Map<string, ExtensionSettingsSchema>
  settingsValues: Map<string, unknown>
  workspaceSettingsValues: Map<string, unknown>
  nativeMenuItems: Map<string, NativeMenuItemContribution>
  /** Maps panel ID → Electron menu item id for checkbox menu items registered by extensions. */
  panelMenuItemIds: Map<string, string>
  commandContributions: Map<string, CommandContribution>
  commandHandlers: Map<string, (ctx: CommandContext, args?: unknown) => void | Promise<void>>
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
  nativeMenuItems: new Map(),
  panelMenuItemIds: new Map(),
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

export function listExtensionSettingsSections(): Array<
  ExtensionSettingsSchema & { extensionId: string }
> {
  return [...globalRegistry.settingsSections.entries()].map(([key, schema]) => ({
    extensionId: key.replace(/\.settings$/, ''),
    label: schema.label,
    description: schema.description,
    properties: schema.properties,
  }))
}

export function listExtensionCommands(): Array<{
  key: string
  extensionId: string
  id: string
  label: string
  description?: string
  shortcut?: string
  category?: string
  mnemonic?: string
  requires?: 'repo' | 'session'
}> {
  // A command that takes args needs a caller to supply them; it is not a quick action.
  return [...globalRegistry.commandContributions.entries()]
    .filter(([, cmd]) => !cmd.args)
    .map(([key, cmd]) => ({
      key,
      extensionId: key.slice(0, key.indexOf('.command.')),
      id: cmd.id,
      label: cmd.label,
      description: cmd.description,
      shortcut: cmd.shortcut,
      category: cmd.category,
      mnemonic: cmd.mnemonic,
      requires: cmd.requires,
    }))
}

export function isExtensionCommandRegistered(key: string): boolean {
  return globalRegistry.commandHandlers.has(key)
}

export async function executeExtensionCommand(
  key: string,
  ctx: CommandContext,
  args?: unknown
): Promise<CommandRunResult> {
  const handler = globalRegistry.commandHandlers.get(key)
  if (!handler) return { ok: false, reason: 'not-registered' }
  let validated: unknown
  const schema = globalRegistry.commandContributions.get(key)?.args
  if (schema) {
    const parsed = schema.safeParse(args)
    if (!parsed.success) return { ok: false, reason: `invalid-args: ${parsed.error.message}` }
    validated = parsed.data
  }
  try {
    if (schema) await handler(ctx, validated)
    else await handler(ctx)
    return { ok: true }
  } catch (error) {
    apiLog.error(`Command "${key}" threw: ${String(error)}`)
    return { ok: false, reason: `failed: ${String(error)}` }
  }
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
  ptyManager?: PtyManager
  /** Carries a terminal's output to the main window, batched and flow-controlled. */
  terminalRelay?: OutputRelay
  broadcastToWindows?: (channel: string, data: unknown) => void
  focusExtensionView?: (extensionId: string, viewParam: string) => void
  bridge?: BridgeDeps
  db?: ExtensionDB
  /** `api.paths`: the application's directory and the per-user data directory. */
  paths?: ExtensionAPI['paths']
  /** The manifest's `contributes.shellRoots`: settings naming directories git and gh may run in. */
  shellRootSettings?: readonly string[]
}

const ptyStreams = new WeakMap<PtyManager, BatchedPtyStream>()

/** One batched stream per PTY manager, shared by every extension's api. */
function ptyStreamOf(ptyManager: PtyManager): BatchedPtyStream {
  const existing = ptyStreams.get(ptyManager)
  if (existing) return existing
  const stream = new BatchedPtyStream(ptyManager)
  ptyStreams.set(ptyManager, stream)
  return stream
}

/** A tab's terminal: the program it runs, and that program's arguments if it is not a shell. */
type TabInput = Omit<OpenTerminalTabInput, 'shell'> & { shell: string; args?: string[] }

/**
 * Spawns a terminal and puts it on screen as an ordinary tab. Null, spawning
 * nothing, when there is no window to show it in.
 */
function openTab(
  ptyManager: PtyManager,
  deps: ExtensionAPIDeps | undefined,
  input: TabInput
): string | null {
  if (!deps?.broadcastToWindows || !deps.terminalRelay) return null
  const sessionId = randomUUID()
  ptyManager.spawnSession({
    sessionId,
    cwd: input.cwd,
    shell: input.shell,
    args: input.args,
    type: input.type ?? 'agent',
    origin: 'app',
    projectId: input.projectId,
    tabTitle: input.tabTitle,
    // The tab does not exist yet: the renderer has to be told, adopt it,
    // render, and mount an xterm before anything is listening.
    holdOutput: true,
  })
  deps.terminalRelay.start(sessionId)
  deps.broadcastToWindows('terminal:adopt', {
    sessionId,
    projectId: input.projectId,
    tabTitle: input.tabTitle,
    scrollbackLimit: input.scrollbackLimit ?? getGlobalSettings().terminal.scrollbackLimit,
  })
  return sessionId
}

/**
 * How the session's process ends. Subscribed in the tick that spawned it, so a
 * process that exits at once is not missed, as one subscribed across the
 * extension host's port could be.
 */
function exitOf(ptyManager: PtyManager, sessionId: string): Promise<TerminalExit> {
  return new Promise((resolve) => {
    ptyManager.onExit(sessionId, (exitCode) => resolve({ sessionId, exitCode }))
  })
}

function focusedOrFirstWindow(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
}

function raiseAllWindows(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
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
  const dbStub: ExtensionDB = {
    exec: notReady,
    query: notReady,
    get: notReady,
    run: notReady,
    transaction: notReady,
  }

  const requirePty = (): PtyManager => {
    if (!deps?.ptyManager) throw new Error('PTY access not available in this extension context')
    return deps.ptyManager
  }

  const paths = deps?.paths ?? { app: '', userData: '' }
  // Every git and gh this extension runs, through shell or github, starts inside a root (ADR 102).
  const execInScope = async (input: ShellExecInput) => {
    const roots = extensionShellRoots({
      userData: paths.userData,
      declaredKeys: deps?.shellRootSettings ?? [],
      schema: globalRegistry.settingsSections.get(`${extensionId}.settings`),
      readSetting: (key) => api.settings.get(key),
    })
    await assertCwdInScope(input.cwd, roots)
    return execShell(input)
  }

  const api: ExtensionAPI = {
    db: deps?.db ?? dbStub,
    paths,
    dialog: {
      async showOpenDialog(options) {
        const parent = focusedOrFirstWindow()
        const result = parent
          ? await dialog.showOpenDialog(parent, options)
          : await dialog.showOpenDialog(options)
        return { canceled: result.canceled, filePaths: result.filePaths }
      },
      async showSaveDialog(options) {
        const parent = focusedOrFirstWindow()
        const result = parent
          ? await dialog.showSaveDialog(parent, options)
          : await dialog.showSaveDialog(options)
        return { canceled: result.canceled, filePath: result.filePath }
      },
    },
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
      async isBranchExcluded(branch: string, repoPath?: string): Promise<boolean> {
        return branchExcludePatternsFor(repoPath).some((p) => matchesBranchPattern(p, branch))
      },
    },
    globalShortcut: {
      async register(accelerator: string, handler: () => void): Promise<Disposable> {
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
        return listProjectsFromStore(workspaceId).map(
          ({ id, workspaceId: wsId, name, worktreePath }) => ({
            id,
            workspaceId: wsId,
            name,
            worktreePath,
          })
        )
      },
      async addProject(input): Promise<ProjectSnapshot | null> {
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
          attachIssueToProject(existing.id, input.issue)
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
        attachIssueToProject(id, input.issue)
        deps?.broadcastToWindows?.('workspace:project-added', created.project)
        return { id, workspaceId, name }
      },
      deleteProject(projectId: string): void {
        deleteProjectFromStore(projectId)
        emitProjectDelete(projectId)
        deps?.broadcastToWindows?.('workspace:project-removed', { id: projectId })
      },
    },
    extensions: {
      // Exports live with the backends: the extension host answers this (host-runtime.ts).
      get(dependencyId: string): never {
        throw new Error(`"${dependencyId}" exports are only reachable in the extension host`)
      },
    },
    shell: {
      // One implementation for both overloads; the encoding decides which output type it is.
      exec: (async (options: ShellExecOptions) => {
        assertCommandAllowed(options.command)
        return execInScope({ ...options, timeoutMs: options.timeoutMs ?? 10000 })
      }) as ExtensionAPI['shell']['exec'],
    },
    github: createGithubApi(execInScope),
    issues: {
      async connections(): Promise<TrackerConnection[]> {
        return listTrackerConnections()
      },
      async listMine(opts = {}): Promise<IssueListResult> {
        return getIssueService().listMine(opts)
      },
      async search(term: string, opts = {}): Promise<IssueListResult> {
        return getIssueService().search(term, opts)
      },
      async get(
        tracker: TrackerId,
        key: string,
        opts: { refresh?: boolean } = {}
      ): Promise<Issue | null> {
        return getIssueService().get(tracker, key, opts)
      },
      async comment(tracker: TrackerId, key: string, body: string): Promise<void> {
        // Deliberately not caught here: an extension that swallows a failed
        // write is exactly the defect this feature exists to remove.
        await getIssueService().comment(tracker, key, body)
      },
      async states(tracker: TrackerId, key: string): Promise<TrackerStateOption[]> {
        return getIssueService().states(tracker, key)
      },
      async transition(
        tracker: TrackerId,
        key: string,
        intent: TransitionIntent,
        optionId?: string
      ): Promise<void> {
        // Uncaught for the same reason as comment: the caller decides whether
        // a refused move matters, and it cannot decide what it never hears.
        await getIssueService().transition(tracker, key, intent, optionId)
      },
      supportsTransitions(tracker: TrackerId): boolean {
        return getIssueService().supportsTransitions(tracker)
      },
      async teams(tracker: TrackerId): Promise<TrackerTeam[]> {
        return getIssueService().teams(tracker)
      },
      async create(tracker: TrackerId, input: NewIssueInput): Promise<Issue> {
        return getIssueService().create(tracker, input)
      },
      supportsCreate(tracker: TrackerId): boolean {
        return getIssueService().supportsCreate(tracker)
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
        onClick?: () => void
      }): Disposable {
        const id = notificationManager.create({
          type: opts.type,
          title: opts.title,
          message: opts.message,
          source: extensionId,
          key: opts.key,
          actions: opts.actions,
          onClick: opts.onClick,
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
    commands: {
      register(
        command: CommandContribution,
        handler: (ctx: CommandContext, args?: never) => void | Promise<void>
      ): Disposable {
        const key = `${extensionId}.command.${command.id}`
        globalRegistry.commandContributions.set(key, command)
        globalRegistry.commandHandlers.set(
          key,
          handler as (ctx: CommandContext, args?: unknown) => void | Promise<void>
        )
        // Quick Actions re-reads the list: a backend that activates after the
        // panel opened would otherwise stay missing from it.
        deps?.broadcastToWindows?.('extension:commands-changed', null)
        return disposable(() => {
          globalRegistry.commandContributions.delete(key)
          globalRegistry.commandHandlers.delete(key)
          deps?.broadcastToWindows?.('extension:commands-changed', null)
        })
      },
    },
    ipc: {
      registerHandler(spec: ChannelSpec, options?: RegisterHandlerOptions): Disposable {
        assertChannelSpec(spec)
        handleChannel(spec.channel, (_event, payload) => dispatchChannel(spec, payload), {
          remoteAccessible: options?.remoteAccessible ?? false,
        })
        return disposable(() => removeChannel(spec.channel))
      },
      async invokeChannel(channel: string, payload: unknown): Promise<unknown> {
        const entry = deps?.bridge?.invokeRegistry.get(channel)
        if (!entry) return undefined
        return entry.handler(null as never, payload)
      },
      async isRemoteAccessible(channel: string): Promise<boolean> {
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
      async spawnSession(opts) {
        return requirePty().spawnSession(opts)
      },
      async openTerminal(input): Promise<string | null> {
        const shell = input.shell ?? getGlobalSettings().terminal.defaultShell
        return openTab(requirePty(), deps, { ...input, shell })
      },
      async runInTerminal(input): Promise<TerminalExit | null> {
        const ptyManager = requirePty()
        const sessionId = openTab(ptyManager, deps, { ...input, shell: input.file })
        return sessionId === null ? null : exitOf(ptyManager, sessionId)
      },
      closeTerminalTab(sessionId): void {
        // The renderer owns the tab list; its close also ends the process
        // and marks the session record closed.
        if (deps?.broadcastToWindows) {
          deps.broadcastToWindows('terminal:close-tab', { sessionId })
          return
        }
        deps?.ptyManager?.kill(sessionId)
      },
      onData(sessionId, listener) {
        if (!deps?.ptyManager) return () => {}
        return ptyStreamOf(deps.ptyManager).onData(sessionId, listener)
      },
      onExit(sessionId, listener) {
        if (!deps?.ptyManager) return () => {}
        return ptyStreamOf(deps.ptyManager).onExit(sessionId, listener)
      },
      async getSession(sessionId) {
        return deps?.ptyManager?.getSession(sessionId)
      },
      async setWorkspace(sessionId, workspaceId) {
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
      async listSessions() {
        return deps?.ptyManager?.listSessions() ?? []
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
            sendToWindow(win, channel, data)
          }
        }
      },
      focusSelf(viewParam = 'main'): void {
        deps?.focusExtensionView?.(extensionId, viewParam)
      },
      showSelf(view = 'main'): void {
        api.window.broadcast('extension:show-surface', { extensionId, view })
      },
      raise(): void {
        raiseAllWindows()
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
