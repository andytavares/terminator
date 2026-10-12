// The single declaration of the window.electronAPI surface.
//
// Every adapter is built from this manifest:
//   - src/main/preload.ts        (app renderer, native: ipcRenderer over Electron IPC)
//   - src/main/preload-webview.ts  (extension views: the specs marked `extensionView`)
//   - src/renderer-remote/electron-api-shim.ts  (remote: WebSocket bridge)
//
// and so are the renderer's `window.electronAPI` type (./api-type.ts, from each
// spec's `signature`) and the core remote allowlist
// (src/main/remote/remote-accessible-channels.ts): every spec whose `remote`
// behavior is 'same' is reachable through the remote bridge; 'stub' methods are
// replaced by a transport-local implementation in the remote adapter; 'omit'
// methods do not exist remotely.
//
// Adding a method here is the ONLY step needed to expose and type it.
// This module must stay dependency-free at run time (no electron, no DOM, no
// zod): it is bundled into the sandboxed preloads, the browser shim, and the
// main process. Type-only imports are erased and therefore allowed.

import type { z } from 'zod'
import type {
  AgentContext,
  Branch,
  Extension,
  GlobalSettings,
  Issue,
  IssueLink,
  IssueListResult,
  ProcessMetrics,
  Project,
  SerializedNotification,
  SessionRecordListing,
  SystemMetrics,
  TrackerConnection,
  Workspace,
  WorkspaceSettings,
  WorktreeInfo,
} from '../types/index'
import type { ChangeStats } from '../schemas/git.schema'
import type {
  ConnectInputSchema,
  DisconnectInputSchema,
  IssueCommentInputSchema,
  IssueGetInputSchema,
  LinkSetInputSchema,
  ListMineInputSchema,
  ProjectIdInputSchema,
  SearchInputSchema,
  SetMineInputSchema,
  StatusInputSchema,
} from '../schemas/integrations.schema'
import type {
  ForgetInputSchema,
  SetDescriptionInputSchema,
  SetLinkInputSchema,
  TransferInputSchema,
} from '../schemas/session-records.schema'

export type RemoteBehavior = 'same' | 'omit' | 'stub'

/**
 * Whether extension views (WebContentsViews running an extension's renderer)
 * receive the method. 'shared': the app renderer and extension views both do.
 * 'only': extension views do, the app renderer and the remote client do not.
 * Absent: the app renderer only.
 */
export type ExtensionViewBehavior = 'shared' | 'only'

export type BridgeMethod = (...args: never[]) => unknown

declare const signatureType: unique symbol

/** Carries a method's TypeScript signature on its spec; it holds nothing at run time. */
export interface Signature<Method extends BridgeMethod> {
  readonly [signatureType]?: Method
}

export function signature<Method extends BridgeMethod>(): Signature<Method> {
  return {}
}

export interface ChannelSpec<
  Path extends string = string,
  Method extends BridgeMethod = BridgeMethod,
  View extends ExtensionViewBehavior | undefined = ExtensionViewBehavior | undefined,
> {
  /** Dot path on window.electronAPI, e.g. 'terminal.create' or 'getFilePath'. */
  path: Path
  /**
   * invoke — request/response over transport.invoke
   * send   — fire-and-forget over transport.send
   * event  — main→renderer push; method subscribes a handler, returns unsubscribe
   * local  — no channel; implementation supplied per adapter (locals[path])
   */
  kind: 'invoke' | 'send' | 'event' | 'local'
  /** The method's TypeScript signature, which window.electronAPI is typed from. */
  signature: Signature<Method>
  /** IPC channel name. Required unless kind is 'local'. */
  channel?: string
  /** Maps the method's arguments to the single wire payload. Default: first arg. */
  toPayload?: (...args: Parameters<Method>) => unknown
  /** Maps the pushed wire args to the subscriber handler's arguments. Default: all args. */
  toHandlerArgs?: (args: unknown[]) => unknown[]
  /** Behavior on the remote transport. Default: 'same'. */
  remote?: RemoteBehavior
  /** Whether extension views receive the method. Default: they do not. */
  extensionView?: View
}

/** Declares one method; infers its path and signature so both reach the derived types. */
export function method<
  const Path extends string,
  Method extends BridgeMethod,
  const View extends ExtensionViewBehavior | undefined = undefined,
>(spec: ChannelSpec<Path, Method, View>): ChannelSpec<Path, Method, View> {
  return spec
}

type Unsubscribe = () => void
type Failure = { error: string }
type DetailedFailure = { error: string; message?: string }
type SessionRecordResult<Data> = Promise<{ data: Data } | { error: string; message: string }>
type CommandContext = {
  projectId: string | null
  sessionId: string | null
  repoRoot: string | null
}

interface ExtensionSettingsSchema {
  extensionId: string
  label: string
  properties: Record<
    string,
    {
      type: string
      label: string
      description?: string
      default: unknown
      secret?: boolean
      options?: string[]
      min?: number
      max?: number
      channel?: string
      confirmMessage?: string
      danger?: boolean
    }
  >
}

interface ExtensionCommand {
  key: string
  extensionId: string
  id: string
  label: string
  description?: string
  shortcut?: string
  category?: string
  mnemonic?: string
  requires?: 'repo' | 'session'
}

interface AppInfo {
  appName: string
  version: string
  electronVersion: string
  nodeVersion: string
  chromeVersion: string
  platform: string
  homeDir: string
}

export const ELECTRON_API_MANIFEST = [
  // ── terminal ──────────────────────────────────────────────────────────────
  method({
    path: 'terminal.create',
    kind: 'invoke',
    channel: 'terminal:create',
    signature:
      signature<
        (
          payload: unknown
        ) => Promise<{ sessionId: string; shell?: string } | { error: string; message?: string }>
      >(),
    extensionView: 'shared',
  }),
  method({
    path: 'terminal.close',
    kind: 'invoke',
    channel: 'terminal:close',
    signature: signature<(sessionId: string) => Promise<{ success: boolean }>>(),
    toPayload: (sessionId) => ({ sessionId }),
    extensionView: 'shared',
  }),
  method({
    // Says a terminal is on screen and ready. Output produced before this is
    // held rather than dropped, so a terminal the application opened for you
    // shows what happened before you looked at it.
    path: 'terminal.attach',
    kind: 'invoke',
    channel: 'terminal:attach',
    signature: signature<(sessionId: string) => Promise<{ released: boolean }>>(),
    toPayload: (sessionId) => ({ sessionId }),
  }),
  method({
    path: 'terminal.listSessions',
    kind: 'invoke',
    channel: 'terminal:list-sessions',
    signature:
      signature<
        () => Promise<
          Array<{ sessionId: string; projectId: string; tabTitle: string; type: string }>
        >
      >(),
    extensionView: 'only',
  }),
  method({
    path: 'terminal.input',
    kind: 'send',
    channel: 'terminal:input',
    signature: signature<(sessionId: string, data: string) => void>(),
    toPayload: (sessionId, data) => ({ sessionId, data }),
    extensionView: 'shared',
  }),
  method({
    path: 'terminal.resize',
    kind: 'send',
    channel: 'terminal:resize',
    signature: signature<(sessionId: string, cols: number, rows: number) => void>(),
    toPayload: (sessionId, cols, rows) => ({ sessionId, cols, rows }),
    extensionView: 'shared',
  }),
  method({
    // Says the renderer has written this many characters of a session's output,
    // so main can pause the process while the renderer is behind. A browser
    // client is fed by its own path and does not take part in flow control.
    path: 'terminal.acknowledge',
    kind: 'send',
    channel: 'terminal:acknowledge',
    signature: signature<(sessionId: string, count: number) => void>(),
    toPayload: (sessionId, count) => ({ sessionId, count }),
    remote: 'stub',
  }),
  method({
    path: 'terminal.onOutput',
    kind: 'event',
    channel: 'terminal:output',
    signature: signature<(handler: (sessionId: string, data: string) => void) => Unsubscribe>(),
    toHandlerArgs: (args) => {
      const p = args[0] as { sessionId: string; data: string }
      return [p.sessionId, p.data]
    },
    extensionView: 'shared',
  }),
  method({
    path: 'terminal.closeAll',
    kind: 'invoke',
    channel: 'terminal:close-all',
    signature: signature<() => Promise<{ terminatedCount: number }>>(),
    extensionView: 'shared',
  }),
  method({
    path: 'terminal.cleanupOrphans',
    kind: 'invoke',
    channel: 'terminal:cleanup-orphans',
    signature: signature<() => Promise<{ cleanedCount: number }>>(),
    extensionView: 'shared',
  }),
  method({
    path: 'terminal.onProcessExit',
    kind: 'event',
    channel: 'terminal:process-exit',
    signature: signature<(handler: (sessionId: string, exitCode: number) => void) => Unsubscribe>(),
    toHandlerArgs: (args) => {
      const p = args[0] as { sessionId: string; exitCode: number }
      return [p.sessionId, p.exitCode]
    },
    extensionView: 'shared',
  }),

  // ── workspace ─────────────────────────────────────────────────────────────
  method({
    path: 'workspace.list',
    kind: 'invoke',
    channel: 'workspace:list',
    signature: signature<() => Promise<{ workspaces: Workspace[] }>>(),
    extensionView: 'shared',
  }),
  method({
    path: 'workspace.create',
    kind: 'invoke',
    channel: 'workspace:create',
    signature: signature<(payload: unknown) => Promise<{ workspace: Workspace } | Failure>>(),
    extensionView: 'shared',
  }),
  method({
    path: 'workspace.update',
    kind: 'invoke',
    channel: 'workspace:update',
    signature: signature<(payload: unknown) => Promise<{ workspace: Workspace } | Failure>>(),
    extensionView: 'shared',
  }),
  method({
    path: 'workspace.delete',
    kind: 'invoke',
    channel: 'workspace:delete',
    signature: signature<(id: string) => Promise<{ success: boolean }>>(),
    toPayload: (id) => ({ id }),
    extensionView: 'shared',
  }),
  method({
    path: 'workspace.reorder',
    kind: 'invoke',
    channel: 'workspace:reorder',
    signature: signature<(ids: string[]) => Promise<{ success: boolean }>>(),
    toPayload: (ids) => ({ ids }),
    extensionView: 'shared',
  }),
  method({
    path: 'workspace.getActive',
    kind: 'invoke',
    channel: 'workspace:get-active',
    signature: signature<
      () => Promise<{
        workspaceId: string | null
        projectId: string | null
        repoRoot: string | null
      }>
    >(),
    remote: 'omit',
    extensionView: 'shared',
  }),

  // ── project ───────────────────────────────────────────────────────────────
  method({
    path: 'project.list',
    kind: 'invoke',
    channel: 'project:list',
    signature: signature<(workspaceId: string) => Promise<{ projects: Project[] }>>(),
    toPayload: (workspaceId) => ({ workspaceId }),
    extensionView: 'shared',
  }),
  method({
    path: 'project.create',
    kind: 'invoke',
    channel: 'project:create',
    signature: signature<(payload: unknown) => Promise<{ project: Project } | Failure>>(),
    extensionView: 'shared',
  }),
  method({
    path: 'project.delete',
    kind: 'invoke',
    channel: 'project:delete',
    signature: signature<(id: string) => Promise<{ success: boolean }>>(),
    toPayload: (id) => ({ id }),
    extensionView: 'shared',
  }),
  method({
    path: 'project.updateBranch',
    kind: 'invoke',
    channel: 'project:update-branch',
    signature:
      signature<(id: string, gitBranch: string) => Promise<{ project: Project } | Failure>>(),
    toPayload: (id, gitBranch) => ({ id, gitBranch }),
    extensionView: 'shared',
  }),
  method({
    path: 'project.rename',
    kind: 'invoke',
    channel: 'project:rename',
    signature: signature<(id: string, name: string) => Promise<{ project: Project } | Failure>>(),
    toPayload: (id, name) => ({ id, name }),
    extensionView: 'shared',
  }),
  method({
    path: 'project.reorder',
    kind: 'invoke',
    channel: 'project:reorder',
    signature: signature<(workspaceId: string, ids: string[]) => Promise<{ success: boolean }>>(),
    toPayload: (workspaceId, ids) => ({ workspaceId, ids }),
    extensionView: 'shared',
  }),
  method({
    path: 'project.onAdded',
    kind: 'event',
    channel: 'workspace:project-added',
    signature: signature<(handler: (project: Project) => void) => Unsubscribe>(),
    toHandlerArgs: (args) => [args[0]],
    remote: 'omit',
  }),
  method({
    path: 'project.onRemoved',
    kind: 'event',
    channel: 'workspace:project-removed',
    signature: signature<(handler: (id: string) => void) => Unsubscribe>(),
    toHandlerArgs: (args) => [(args[0] as { id: string }).id],
    remote: 'omit',
  }),

  // ── git ───────────────────────────────────────────────────────────────────
  method({
    path: 'git.isRepo',
    kind: 'invoke',
    channel: 'git:is-repo',
    signature: signature<(path: string) => Promise<{ isRepo: boolean; root?: string }>>(),
    toPayload: (path) => ({ path }),
    extensionView: 'shared',
  }),
  method({
    path: 'git.currentBranch',
    kind: 'invoke',
    channel: 'git:current-branch',
    signature: signature<(path: string) => Promise<{ branch: string } | Failure>>(),
    toPayload: (path) => ({ path }),
    extensionView: 'shared',
  }),
  method({
    path: 'git.changeStats',
    kind: 'invoke',
    channel: 'git:change-stats',
    signature: signature<(path: string) => Promise<ChangeStats | Failure>>(),
    toPayload: (path) => ({ path }),
  }),
  method({
    path: 'git.listBranches',
    kind: 'invoke',
    channel: 'git:list-branches',
    signature: signature<(path: string) => Promise<{ branches: Branch[] }>>(),
    toPayload: (path) => ({ path }),
    extensionView: 'shared',
  }),
  method({
    path: 'git.fetch',
    kind: 'invoke',
    channel: 'git:fetch',
    signature: signature<(path: string) => Promise<{ success: true } | Failure>>(),
    toPayload: (path) => ({ path }),
  }),
  method({
    path: 'git.checkout',
    kind: 'invoke',
    channel: 'git:checkout',
    signature: signature<(path: string, branch: string) => Promise<{ success: true } | Failure>>(),
    toPayload: (path, branch) => ({ path, branch }),
    extensionView: 'shared',
  }),
  method({
    path: 'git.createBranch',
    kind: 'invoke',
    channel: 'git:create-branch',
    signature: signature<(path: string, branch: string) => Promise<{ success: true } | Failure>>(),
    toPayload: (path, branch) => ({ path, branch }),
    extensionView: 'shared',
  }),
  method({
    path: 'git.suggestWorktreePath',
    kind: 'invoke',
    channel: 'git:suggest-worktree-path',
    signature:
      signature<
        (repoRoot: string, branch: string, baseDir?: string) => Promise<{ path: string }>
      >(),
    toPayload: (repoRoot, branch, baseDir) => ({ repoRoot, branch, baseDir }),
    extensionView: 'shared',
  }),
  method({
    path: 'git.createWorktree',
    kind: 'invoke',
    channel: 'git:create-worktree',
    signature: signature<(payload: unknown) => Promise<{ success: true } | Failure>>(),
    extensionView: 'shared',
  }),
  method({
    path: 'git.removeWorktree',
    kind: 'invoke',
    channel: 'git:remove-worktree',
    signature:
      signature<(repoRoot: string, worktreePath: string) => Promise<{ success: true } | Failure>>(),
    toPayload: (repoRoot, worktreePath) => ({ repoRoot, worktreePath }),
    extensionView: 'shared',
  }),
  method({
    path: 'git.listWorktrees',
    kind: 'invoke',
    channel: 'git:list-worktrees',
    signature: signature<(path: string) => Promise<{ worktrees: WorktreeInfo[] }>>(),
    toPayload: (path) => ({ path }),
    extensionView: 'shared',
  }),

  // ── settings ──────────────────────────────────────────────────────────────
  method({
    path: 'settings.getGlobal',
    kind: 'invoke',
    channel: 'settings:get-global',
    signature: signature<() => Promise<{ settings: GlobalSettings }>>(),
    extensionView: 'shared',
  }),
  method({
    path: 'settings.updateGlobal',
    kind: 'invoke',
    channel: 'settings:update-global',
    signature: signature<(patch: unknown) => Promise<{ settings: GlobalSettings }>>(),
    toPayload: (patch) => ({ patch }),
    extensionView: 'shared',
  }),
  method({
    path: 'settings.getWorkspace',
    kind: 'invoke',
    channel: 'settings:get-workspace',
    signature: signature<(workspaceId: string) => Promise<{ settings: WorkspaceSettings }>>(),
    toPayload: (workspaceId) => ({ workspaceId }),
    extensionView: 'shared',
  }),
  method({
    path: 'settings.updateWorkspace',
    kind: 'invoke',
    channel: 'settings:update-workspace',
    signature:
      signature<
        (workspaceId: string, patch: unknown) => Promise<{ settings: WorkspaceSettings }>
      >(),
    toPayload: (workspaceId, patch) => ({ workspaceId, patch }),
    extensionView: 'shared',
  }),

  // ── dialog ────────────────────────────────────────────────────────────────
  // Remote stub: a browser client cannot open a native directory picker.
  method({
    path: 'dialog.openDirectory',
    kind: 'invoke',
    channel: 'dialog:open-directory',
    signature: signature<() => Promise<{ filePath: string } | { cancelled: true }>>(),
    remote: 'stub',
    extensionView: 'shared',
  }),

  // ── extension ─────────────────────────────────────────────────────────────
  method({
    path: 'extension.list',
    kind: 'invoke',
    channel: 'extension:list',
    signature: signature<() => Promise<{ extensions: Extension[] }>>(),
    extensionView: 'shared',
  }),
  method({
    path: 'extension.install',
    kind: 'invoke',
    channel: 'extension:install',
    signature: signature<(directoryPath: string) => Promise<{ extension: Extension } | Failure>>(),
    toPayload: (directoryPath) => ({ directoryPath }),
    extensionView: 'shared',
  }),
  method({
    path: 'extension.toggle',
    kind: 'invoke',
    channel: 'extension:toggle',
    signature:
      signature<(id: string, enabled: boolean) => Promise<{ extension: Extension } | Failure>>(),
    toPayload: (id, enabled) => ({ id, enabled }),
    extensionView: 'shared',
  }),
  method({
    path: 'extension.uninstall',
    kind: 'invoke',
    channel: 'extension:uninstall',
    signature: signature<(id: string) => Promise<{ ok: true } | Failure>>(),
    toPayload: (id) => ({ id }),
    extensionView: 'shared',
  }),
  method({
    path: 'extension.reload',
    kind: 'invoke',
    channel: 'extension:reload',
    signature: signature<(id: string) => Promise<{ extension: Extension } | Failure>>(),
    toPayload: (id) => ({ id }),
    extensionView: 'shared',
  }),
  method({
    path: 'extension.getSettingsSchemas',
    kind: 'invoke',
    channel: 'extension:get-settings-schemas',
    signature: signature<() => Promise<{ schemas: ExtensionSettingsSchema[] }>>(),
    extensionView: 'shared',
  }),
  method({
    path: 'extension.getSettingsValues',
    kind: 'invoke',
    channel: 'extension:get-settings-values',
    signature: signature<() => Promise<{ values: Record<string, unknown> }>>(),
    extensionView: 'shared',
  }),
  method({
    path: 'extension.updateSetting',
    kind: 'invoke',
    channel: 'extension:update-setting',
    signature: signature<(key: string, value: unknown) => Promise<{ ok: true }>>(),
    toPayload: (key, value) => ({ key, value }),
    extensionView: 'shared',
  }),
  method({
    path: 'extension.getCommands',
    kind: 'invoke',
    channel: 'extension:get-commands',
    signature: signature<() => Promise<{ commands: ExtensionCommand[] }>>(),
    extensionView: 'shared',
  }),
  method({
    path: 'extension.executeCommand',
    kind: 'send',
    channel: 'extension:execute-command',
    signature: signature<(key: string, ctx: CommandContext) => void>(),
    toPayload: (key, ctx) => ({ key, ctx }),
    extensionView: 'shared',
  }),
  // Run another extension's command by full id, e.g.
  // 'terminator.git-integration.command.review-pull-request'. Extension views
  // only, and not on the remote allowlist.
  method({
    path: 'extension.runCommand',
    kind: 'invoke',
    channel: 'extension:run-command',
    signature:
      signature<
        (key: string, args?: unknown) => Promise<{ ok: true } | { ok: false; reason: string }>
      >(),
    toPayload: (key, args) => ({ key, args }),
    extensionView: 'only',
  }),
  method({
    path: 'extension.hasCommand',
    kind: 'invoke',
    channel: 'extension:has-command',
    signature: signature<(key: string) => Promise<boolean>>(),
    toPayload: (key) => ({ key }),
    extensionView: 'only',
  }),
  // Remote stub: WebContentsView positioning is an Electron-only concept.
  method({
    path: 'extension.updatePanelBounds',
    kind: 'invoke',
    channel: 'extension:update-panel-bounds',
    signature:
      signature<
        (payload: {
          extensionId: string
          viewParam: string
          bounds: { x: number; y: number; width: number; height: number }
          visible: boolean
          repoRoot?: string | null
        }) => Promise<void>
      >(),
    remote: 'stub',
  }),
  method({
    path: 'extension.setBottomInset',
    kind: 'send',
    channel: 'extension:set-bottom-inset',
    signature: signature<(inset: number) => void>(),
    toPayload: (inset) => ({ inset }),
    remote: 'omit',
  }),
  method({
    path: 'extension.setLeftInset',
    kind: 'send',
    channel: 'extension:set-left-inset',
    signature: signature<(inset: number) => void>(),
    toPayload: (inset) => ({ inset }),
    remote: 'omit',
  }),
  method({
    // An extension view is its own document and never sees the renderer's
    // `data-theme`, so the renderer has to tell it.
    path: 'extension.setTheme',
    kind: 'send',
    channel: 'extension:set-theme',
    signature: signature<(theme: 'dark' | 'light') => void>(),
    toPayload: (theme) => ({ theme }),
    remote: 'omit',
  }),

  // ── shell ─────────────────────────────────────────────────────────────────
  method({
    path: 'shell.exec',
    kind: 'invoke',
    channel: 'shell:exec',
    signature:
      signature<
        (options: {
          command: 'git' | 'gh'
          args: string[]
          cwd: string
          timeoutMs?: number
          workspaceRoot?: string
        }) => Promise<
          { exitCode: number; stdout: string; stderr: string; timedOut: boolean } | Failure
        >
      >(),
    extensionView: 'shared',
  }),
  method({
    path: 'shell.openPath',
    kind: 'invoke',
    channel: 'shell:open-path',
    signature: signature<(filePath: string) => Promise<{ ok: true } | Failure>>(),
    toPayload: (filePath) => ({ filePath }),
    extensionView: 'shared',
  }),
  // Remote stub: opens in a new browser tab instead of the host OS.
  method({
    path: 'shell.openExternal',
    kind: 'invoke',
    channel: 'shell:open-external',
    signature: signature<(url: string) => Promise<{ ok: true } | Failure>>(),
    toPayload: (url) => ({ url }),
    remote: 'stub',
    extensionView: 'shared',
  }),

  // ── editor ────────────────────────────────────────────────────────────────
  // Opening a folder in the user's editor. Omitted remotely rather than
  // stubbed: a browser tab has no local editor, and the folder is on the host
  // machine anyway. Absent means the menu item hides itself, which is honest —
  // a stub that always errors is an item that looks available and is not.
  method({
    // Which editor this machine will use, or null if it has none we know.
    path: 'editor.detect',
    kind: 'invoke',
    channel: 'editor:detect',
    signature: signature<() => Promise<{ editor: { id: string; name: string } | null }>>(),
    remote: 'omit',
  }),
  method({
    path: 'editor.open',
    kind: 'invoke',
    channel: 'editor:open',
    signature: signature<(folderPath: string) => Promise<{ ok: true; editor: string } | Failure>>(),
    toPayload: (folderPath) => ({ folderPath }),
    remote: 'omit',
  }),

  // ── fs ────────────────────────────────────────────────────────────────────
  method({
    path: 'fs.watchStart',
    kind: 'invoke',
    channel: 'fs:watch-start',
    signature: signature<(projectRoot: string) => Promise<{ ok: true } | Failure>>(),
    toPayload: (projectRoot) => ({ projectRoot }),
    extensionView: 'shared',
  }),
  method({
    path: 'fs.watchStop',
    kind: 'invoke',
    channel: 'fs:watch-stop',
    signature: signature<() => Promise<{ ok: true }>>(),
    extensionView: 'shared',
  }),
  method({
    path: 'fs.onChanged',
    kind: 'event',
    channel: 'fs:changed',
    signature:
      signature<
        (
          handler: (event: {
            projectRoot: string
            eventType: string
            filename: string | null
          }) => void
        ) => Unsubscribe
      >(),
    toHandlerArgs: (args) => [args[0]],
    extensionView: 'shared',
  }),
  method({
    path: 'fs.readFile',
    kind: 'invoke',
    channel: 'fs:read-file',
    signature: signature<(filePath: string) => Promise<{ content: string } | Failure>>(),
    toPayload: (filePath) => ({ filePath }),
    extensionView: 'shared',
  }),

  // ── extensionEvents ───────────────────────────────────────────────────────
  method({
    path: 'extensionEvents.onTogglePanel',
    kind: 'event',
    channel: 'extension:toggle-panel',
    signature: signature<(handler: (panelId: string) => void) => Unsubscribe>(),
    // Payload is the bare panelId string (see api.window.broadcast call sites).
    toHandlerArgs: (args) => [args[0]],
    extensionView: 'shared',
  }),
  method({
    path: 'extensionEvents.onSelectProjectTab',
    kind: 'event',
    channel: 'extension:select-project-tab',
    signature: signature<(handler: (tabId: string) => void) => Unsubscribe>(),
    toHandlerArgs: (args) => [(args[0] as { tabId: string }).tabId],
  }),
  method({
    path: 'extensionEvents.onMenuOpenSettings',
    kind: 'event',
    channel: 'menu:open-settings',
    signature: signature<(handler: () => void) => Unsubscribe>(),
    toHandlerArgs: () => [],
    extensionView: 'shared',
  }),
  method({
    path: 'extensionEvents.onMenuOpenHome',
    kind: 'event',
    channel: 'menu:open-home',
    signature: signature<(handler: () => void) => Unsubscribe>(),
    toHandlerArgs: () => [],
  }),
  method({
    path: 'extensionEvents.onMenuToggleSidebar',
    kind: 'event',
    channel: 'menu:toggle-sidebar',
    signature: signature<(handler: () => void) => Unsubscribe>(),
    toHandlerArgs: () => [],
  }),
  method({
    path: 'extensionEvents.onMenuCloseTab',
    kind: 'event',
    channel: 'menu:close-tab',
    signature: signature<(handler: () => void) => Unsubscribe>(),
    toHandlerArgs: () => [],
  }),
  method({
    path: 'extensionEvents.onMenuOpenAbout',
    kind: 'event',
    channel: 'menu:open-about',
    signature: signature<(handler: () => void) => Unsubscribe>(),
    toHandlerArgs: () => [],
  }),
  method({
    path: 'extensionEvents.notifyPanelState',
    kind: 'send',
    channel: 'menu:set-panel-checked',
    signature: signature<(panelId: string, open: boolean) => void>(),
    toPayload: (panelId, open) => ({ panelId, open }),
    remote: 'omit',
    extensionView: 'shared',
  }),
  method({
    path: 'extensionEvents.onExtensionPanelLoaded',
    kind: 'event',
    channel: 'extension:panel-loaded',
    signature: signature<(handler: (id: string) => void) => Unsubscribe>(),
    toHandlerArgs: (args) => [(args[0] as { id: string }).id],
    remote: 'omit',
    extensionView: 'shared',
  }),
  method({
    path: 'extensionEvents.onExtensionRendererReload',
    kind: 'event',
    channel: 'extension:renderer-reload',
    signature: signature<(handler: (id: string) => void) => Unsubscribe>(),
    toHandlerArgs: (args) => [(args[0] as { id: string }).id],
    remote: 'omit',
    extensionView: 'shared',
  }),
  // Emitted when the double-Escape exit gesture fires inside an extension
  // WebContentsView. Native only: remote extension panels are iframes in the
  // host page, so their Escape never leaves the renderer.
  method({
    path: 'extensionEvents.onExtensionExitToTerminal',
    kind: 'event',
    channel: 'extension:exit-to-terminal',
    signature:
      signature<
        (
          handler: (payload: { extensionId: string; sidebarPanelId: string | null }) => void
        ) => Unsubscribe
      >(),
    toHandlerArgs: (args) => [args[0]],
    remote: 'omit',
  }),

  // ── quickActions ──────────────────────────────────────────────────────────
  // Sent from extension-view-host.ts when ⌘P is pressed inside an extension
  // WebContentsView. Native only: an extension view is a WebContentsView, a
  // concept the remote `/app/` surface (a plain iframe host page) has no
  // equivalent for.
  method({
    path: 'quickActions.onOpen',
    kind: 'event',
    channel: 'quick-actions:open',
    signature: signature<(handler: () => void) => Unsubscribe>(),
    toHandlerArgs: () => [],
    remote: 'omit',
  }),

  // ── app ───────────────────────────────────────────────────────────────────
  method({
    path: 'app.getInfo',
    kind: 'invoke',
    channel: 'app:get-info',
    signature: signature<() => Promise<AppInfo>>(),
    extensionView: 'shared',
  }),

  // ── extensionBridge ───────────────────────────────────────────────────────
  // Dynamic channel passthrough for extension-owned channels; each adapter
  // supplies its own transport-backed implementation.
  method({
    path: 'extensionBridge.invoke',
    kind: 'local',
    signature: signature<(channel: string, payload?: unknown) => Promise<unknown>>(),
    extensionView: 'shared',
  }),
  method({
    path: 'extensionBridge.on',
    kind: 'local',
    signature: signature<(channel: string, handler: (data: unknown) => void) => Unsubscribe>(),
    extensionView: 'shared',
  }),

  // ── notifications ─────────────────────────────────────────────────────────
  method({
    path: 'notifications.create',
    kind: 'invoke',
    channel: 'notifications:create',
    signature:
      signature<
        (payload: {
          type: 'info' | 'success' | 'warning' | 'error'
          title: string
          message?: string
          source?: string
          key: string
          sessionId?: string
        }) => Promise<{ id: string } | Failure>
      >(),
    extensionView: 'shared',
  }),
  method({
    path: 'notifications.list',
    kind: 'invoke',
    channel: 'notifications:list',
    signature: signature<() => Promise<SerializedNotification[]>>(),
    extensionView: 'shared',
  }),
  method({
    path: 'notifications.dismiss',
    kind: 'invoke',
    channel: 'notifications:dismiss',
    signature: signature<(id: string) => Promise<{ ok: true } | Failure>>(),
    toPayload: (id) => ({ id }),
    extensionView: 'shared',
  }),
  method({
    path: 'notifications.triggerAction',
    kind: 'invoke',
    channel: 'notifications:trigger-action',
    signature: signature<(notifId: string, actionId: string) => Promise<{ ok: true } | Failure>>(),
    toPayload: (notifId, actionId) => ({ notifId, actionId }),
    extensionView: 'shared',
  }),
  method({
    path: 'notifications.onPush',
    kind: 'event',
    channel: 'notifications:push',
    signature:
      signature<(handler: (notification: SerializedNotification) => void) => Unsubscribe>(),
    toHandlerArgs: (args) => [args[0]],
    extensionView: 'shared',
  }),

  // ── db ────────────────────────────────────────────────────────────────────
  method({
    path: 'db.health',
    kind: 'invoke',
    channel: 'db:health',
    signature: signature<() => Promise<{ ok: boolean; message?: string }>>(),
    remote: 'omit',
    extensionView: 'shared',
  }),

  // ── metrics ───────────────────────────────────────────────────────────────
  method({
    path: 'metrics.getSystem',
    kind: 'invoke',
    channel: 'metrics:system',
    signature: signature<() => Promise<{ data: SystemMetrics } | Failure>>(),
    extensionView: 'shared',
  }),
  method({
    path: 'metrics.getProcesses',
    kind: 'invoke',
    channel: 'metrics:processes',
    signature: signature<(pids: number[]) => Promise<{ data: ProcessMetrics[] } | Failure>>(),
    toPayload: (pids) => ({ pids }),
    extensionView: 'shared',
  }),
  method({
    path: 'metrics.getPids',
    kind: 'invoke',
    channel: 'metrics:pids',
    signature:
      signature<
        (
          sessionIds: string[]
        ) => Promise<{ data: Array<{ sessionId: string; pid: number }> } | Failure>
      >(),
    toPayload: (sessionIds) => ({ sessionIds }),
    extensionView: 'shared',
  }),

  // ── logger ────────────────────────────────────────────────────────────────
  method({
    path: 'logger.write',
    kind: 'send',
    channel: 'log:write',
    signature: signature<(level: string, namespace: string, message: string) => void>(),
    toPayload: (level, namespace, message) => ({ level, namespace, message }),
    extensionView: 'shared',
  }),

  // ── session records (descriptions and session-level work items) ───────────
  method({
    path: 'sessionRecords.list',
    kind: 'invoke',
    channel: 'session-records:list',
    signature: signature<() => Promise<{ data: SessionRecordListing[] }>>(),
  }),
  method({
    path: 'sessionRecords.setDescription',
    kind: 'invoke',
    channel: 'session-records:set-description',
    signature:
      signature<
        (
          input: z.input<typeof SetDescriptionInputSchema>
        ) => SessionRecordResult<SessionRecordListing | null>
      >(),
  }),
  method({
    path: 'sessionRecords.setLink',
    kind: 'invoke',
    channel: 'session-records:set-link',
    signature:
      signature<
        (
          input: z.input<typeof SetLinkInputSchema>
        ) => SessionRecordResult<SessionRecordListing | null>
      >(),
  }),
  method({
    // Moves one session's description, link and conversation onto another, resuming it.
    path: 'sessionRecords.transfer',
    kind: 'invoke',
    channel: 'session-records:transfer',
    signature:
      signature<
        (
          input: z.input<typeof TransferInputSchema>
        ) => SessionRecordResult<SessionRecordListing | null>
      >(),
  }),
  method({
    // Drops a closed session's record for good.
    path: 'sessionRecords.forget',
    kind: 'invoke',
    channel: 'session-records:forget',
    signature:
      signature<(input: z.input<typeof ForgetInputSchema>) => SessionRecordResult<boolean>>(),
  }),
  method({
    path: 'sessionRecords.onChanged',
    kind: 'event',
    channel: 'session-records:changed',
    signature:
      signature<
        (
          handler: (payload: { sessionId: string; record: SessionRecordListing | null }) => void
        ) => Unsubscribe
      >(),
  }),

  // ── integrations (issue trackers) ─────────────────────────────────────────
  method({
    path: 'integrations.status',
    kind: 'invoke',
    channel: 'integrations:status',
    signature:
      signature<
        (
          input: z.input<typeof StatusInputSchema>
        ) => Promise<{ connections: TrackerConnection[] } | DetailedFailure>
      >(),
  }),
  // Credential entry stays on the local renderer. The /app/ surface is
  // authenticated, but "authenticated" is not a reason to let a LAN client
  // write the operator's Linear key (ADR-023 default-deny).
  method({
    path: 'integrations.connect',
    kind: 'invoke',
    channel: 'integrations:connect',
    signature:
      signature<
        (
          input: z.input<typeof ConnectInputSchema>
        ) => Promise<{ connection: TrackerConnection } | DetailedFailure>
      >(),
    remote: 'omit',
  }),
  method({
    path: 'integrations.disconnect',
    kind: 'invoke',
    channel: 'integrations:disconnect',
    signature:
      signature<
        (input: z.input<typeof DisconnectInputSchema>) => Promise<{ ok: true } | Failure>
      >(),
    remote: 'omit',
  }),
  method({
    path: 'integrations.setMine',
    kind: 'invoke',
    channel: 'integrations:set-mine',
    signature:
      signature<(input: z.input<typeof SetMineInputSchema>) => Promise<{ ok: true } | Failure>>(),
  }),
  method({
    path: 'integrations.listMine',
    kind: 'invoke',
    channel: 'integrations:issue-list-mine',
    signature:
      signature<
        (input: z.input<typeof ListMineInputSchema>) => Promise<IssueListResult | DetailedFailure>
      >(),
  }),
  method({
    path: 'integrations.search',
    kind: 'invoke',
    channel: 'integrations:issue-search',
    signature:
      signature<
        (input: z.input<typeof SearchInputSchema>) => Promise<IssueListResult | DetailedFailure>
      >(),
  }),
  method({
    path: 'integrations.getIssue',
    kind: 'invoke',
    channel: 'integrations:issue-get',
    signature:
      signature<
        (
          input: z.input<typeof IssueGetInputSchema>
        ) => Promise<{ issue: Issue | null } | DetailedFailure>
      >(),
  }),
  method({
    path: 'integrations.comment',
    kind: 'invoke',
    channel: 'integrations:issue-comment',
    signature:
      signature<
        (input: z.input<typeof IssueCommentInputSchema>) => Promise<{ ok: true } | DetailedFailure>
      >(),
  }),
  method({
    path: 'integrations.linkSet',
    kind: 'invoke',
    channel: 'integrations:link-set',
    signature:
      signature<
        (
          input: z.input<typeof LinkSetInputSchema>
        ) => Promise<{ link: IssueLink } | DetailedFailure>
      >(),
  }),
  method({
    path: 'integrations.linkGet',
    kind: 'invoke',
    channel: 'integrations:link-get',
    signature:
      signature<
        (
          input: z.input<typeof ProjectIdInputSchema>
        ) => Promise<
          { link: IssueLink | null; issue: Issue | null; issueError?: string } | DetailedFailure
        >
      >(),
  }),
  method({
    path: 'integrations.linkClear',
    kind: 'invoke',
    channel: 'integrations:link-clear',
    signature:
      signature<(input: z.input<typeof ProjectIdInputSchema>) => Promise<{ ok: true } | Failure>>(),
  }),
  method({
    path: 'integrations.contextPreview',
    kind: 'invoke',
    channel: 'integrations:context-preview',
    signature:
      signature<
        (
          input: z.input<typeof ProjectIdInputSchema>
        ) => Promise<{ context: AgentContext } | DetailedFailure>
      >(),
  }),
  method({
    path: 'integrations.setInjectContext',
    kind: 'invoke',
    channel: 'integrations:set-inject-context',
    signature:
      signature<
        (input: {
          projectId: string
          injectContext: boolean
        }) => Promise<{ ok: true } | DetailedFailure>
      >(),
  }),
  method({
    path: 'integrations.onStatusChanged',
    kind: 'event',
    channel: 'integrations:status-changed',
    signature: signature<(handler: (payload: unknown) => void) => Unsubscribe>(),
  }),
  method({
    path: 'integrations.onLinkChanged',
    kind: 'event',
    channel: 'integrations:link-changed',
    signature: signature<(handler: (payload: unknown) => void) => Unsubscribe>(),
  }),
  method({
    path: 'integrations.onContextInjected',
    kind: 'event',
    channel: 'integrations:context-injected',
    signature: signature<(handler: (payload: unknown) => void) => Unsubscribe>(),
  }),

  // ── ui (extension views) ──────────────────────────────────────────────────
  // Reported by @terminator/extension-ui whenever a dialog opens or closes, so
  // the webview preload's Escape listener knows something else has claimed the key.
  method({
    path: 'ui.setModalDepth',
    kind: 'local',
    signature: signature<(depth: number) => void>(),
    extensionView: 'only',
  }),

  // ── top-level ─────────────────────────────────────────────────────────────
  // Native: webUtils.getPathForFile. No remote equivalent.
  method({
    path: 'getFilePath',
    kind: 'local',
    signature: signature<(file: File) => string>(),
    remote: 'omit',
  }),
] as const

/**
 * Core channels reachable through the remote bridge, derived from the manifest:
 * every channel whose remote behavior is 'same'. 'stub' and 'omit' channels are
 * excluded — they are either replaced in the remote adapter or absent from it —
 * and so are channels only extension views receive.
 */
export function remoteAccessibleCoreChannels(): ReadonlySet<string> {
  const channels = new Set<string>()
  for (const spec of ELECTRON_API_MANIFEST) {
    if (spec.kind === 'local' || spec.extensionView === 'only') continue
    if ((spec.remote ?? 'same') === 'same') channels.add(spec.channel!)
  }
  return channels
}
