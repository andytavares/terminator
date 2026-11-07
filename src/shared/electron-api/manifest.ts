// The single declaration of the window.electronAPI surface.
//
// Every adapter is built from this manifest:
//   - src/main/preload.ts        (app renderer, native: ipcRenderer over Electron IPC)
//   - src/extension-frame/frame-shim.ts  (extension frames: the specs marked `extensionView`)
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
  AgentDescriptor,
  AgentPermissionAsk,
  AgentStarted,
  AgentTurnEnd,
  AgentUpdate,
  SettingsChange,
} from '@terminator/extension-sdk'
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
import type { FramePortRequest } from '../frame-wire'
import { OPEN_FRAME_PORT_CHANNEL } from '../frame-wire'
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
  AgentAnswerInputSchema,
  AgentPromptInputSchema,
  AgentQueueInputSchema,
  AgentSteerInputSchema,
  AgentSessionInputSchema,
  AgentSetConfigInputSchema,
  AgentStartInputSchema,
  KnownAgentStatus,
} from '../schemas/agents.schema'
import type { AgentUsageInputSchema, ThreadSummaryInputSchema } from '../schemas/agent-usage.schema'
import type { AgentUsage } from '../agents/agent-usage'
import type {
  ForgetInputSchema,
  SetDescriptionInputSchema,
  SetLinkInputSchema,
  TransferInputSchema,
} from '../schemas/session-records.schema'
import type {
  TaskArchiveInputSchema,
  TaskMergeInputSchema,
  TaskIdInputSchema,
  TaskCreateInputSchema,
  TaskLaneInputSchema,
  TaskUpdateInputSchema,
  Task,
} from '../schemas/tasks.schema'
import type { HomeFeedActionInputSchema, MergedHomeFeed } from '../schemas/home-feed.schema'
import type {
  BranchNameInputSchema,
  Schedule,
  DueSchedule,
  ScheduleIdInputSchema,
  ScheduleInputSchema,
  SchedulePauseInputSchema,
  ScheduleUpdateInputSchema,
} from '../schemas/schedules.schema'
import type { AgentAsk } from '../agent-sessions/ask'
import type { AttentionInterval, AttentionMeasures } from '../home/attention-measures'
import type { MeasuresInputSchema, RecordStateInputSchema } from '../schemas/attention.schema'
import type {
  UsageDeclareInputSchema,
  UsageRecordInputSchema,
  UsageReportInputSchema,
  Via,
} from '../schemas/usage.schema'
import type { UsageReport } from '../usage/usage-types'
import type { McpAnswer, McpCall } from '../mcp/renderer-tools'

type RemoteBehavior = 'same' | 'omit' | 'stub'

/** How an invoke method appears in the Terminator MCP server: a tool, or `false` for hidden.
 * `tool` is snake_case; `description` is one plain sentence for Claude. */
type McpExposure =
  | { tool: string; description: string; destructive?: true; readOnly?: true }
  | false

/** Whether extension views (WebContentsViews running an extension's renderer) receive the
 * method. 'shared': the app renderer and extension views both do. 'only': extension views do,
 * the app renderer and the remote client do not. Absent: the app renderer only. */
export type ExtensionViewBehavior = 'shared' | 'only'

export type BridgeMethod = (...args: never[]) => unknown

declare const signatureType: unique symbol

/** Carries a method's TypeScript signature on its spec; it holds nothing at run time. */
export interface Signature<Method extends BridgeMethod> {
  readonly [signatureType]?: Method
}

function signature<Method extends BridgeMethod>(): Signature<Method> {
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
  /** Whether an invoke method is a Terminator MCP server tool. Every invoke method decides. */
  mcp?: McpExposure
  /** Whether extension views receive the method. Default: they do not. */
  extensionView?: View
}

/** Declares one method; infers its path and signature so both reach the derived types. */
function method<
  const Path extends string,
  Method extends BridgeMethod,
  const View extends ExtensionViewBehavior | undefined = undefined,
>(spec: ChannelSpec<Path, Method, View>): ChannelSpec<Path, Method, View> {
  return spec
}

type Unsubscribe = () => void

/** An event pushed as `{ id }` about one extension, which the handler receives as the id. */
function extensionIdEvent<const Path extends string>(path: Path, channel: string) {
  return method({
    path,
    kind: 'event',
    channel,
    signature: signature<(handler: (id: string) => void) => Unsubscribe>(),
    toHandlerArgs: (args) => [(args[0] as { id: string }).id],
    remote: 'omit',
    extensionView: 'shared',
  })
}
type Failure = { error: string }
type DetailedFailure = { error: string; message?: string }
type SessionRecordResult<Data> = Promise<{ data: Data } | { error: string; message: string }>
type TaskResult = Promise<{ data: Task } | { error: string; message: string }>
type CommandContext = {
  projectId: string | null
  sessionId: string | null
  repoRoot: string | null
}

interface ExtensionSettingsSchema {
  extensionId: string
  label: string
  description?: string
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
      workspaceScoped?: boolean
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
    mcp: false,
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
    mcp: {
      tool: 'close_terminal',
      description: 'Closes one terminal session and ends its process.',
      destructive: true,
    },
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
    mcp: false,
    signature: signature<(sessionId: string) => Promise<{ released: boolean }>>(),
    toPayload: (sessionId) => ({ sessionId }),
  }),
  method({
    path: 'terminal.listSessions',
    kind: 'invoke',
    channel: 'terminal:list-sessions',
    mcp: {
      tool: 'list_terminal_sessions',
      description: 'Lists the terminal sessions that are running in Terminator.',
      readOnly: true,
    },
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
  }),
  method({
    path: 'terminal.closeAll',
    kind: 'invoke',
    channel: 'terminal:close-all',
    mcp: {
      tool: 'close_all_terminals',
      description: 'Closes every terminal session and ends their processes.',
      destructive: true,
    },
    signature: signature<() => Promise<{ terminatedCount: number }>>(),
    extensionView: 'shared',
  }),
  method({
    path: 'terminal.cleanupOrphans',
    kind: 'invoke',
    channel: 'terminal:cleanup-orphans',
    mcp: false,
    signature: signature<() => Promise<{ cleanedCount: number }>>(),
    extensionView: 'shared',
  }),
  method({
    path: 'terminal.onProcessExit',
    kind: 'event',
    channel: 'terminal:process-exit',
    signature:
      signature<(handler: (sessionId: string, exitCode: number | null) => void) => Unsubscribe>(),
    toHandlerArgs: (args) => {
      const p = args[0] as { sessionId: string; exitCode: number | null }
      return [p.sessionId, p.exitCode]
    },
    extensionView: 'shared',
  }),

  // ── workspace ─────────────────────────────────────────────────────────────
  method({
    path: 'workspace.list',
    kind: 'invoke',
    channel: 'workspace:list',
    mcp: {
      tool: 'list_workspaces',
      description: 'Lists the workspaces in the Terminator sidebar.',
      readOnly: true,
    },
    signature: signature<() => Promise<{ workspaces: Workspace[] }>>(),
    extensionView: 'shared',
  }),
  method({
    path: 'workspace.create',
    kind: 'invoke',
    channel: 'workspace:create',
    mcp: {
      tool: 'create_workspace',
      description: 'Creates a workspace in the Terminator sidebar.',
    },
    signature: signature<(payload: unknown) => Promise<{ workspace: Workspace } | Failure>>(),
    extensionView: 'shared',
  }),
  method({
    path: 'workspace.update',
    kind: 'invoke',
    channel: 'workspace:update',
    mcp: {
      tool: 'update_workspace',
      description: 'Changes the name, colour or other fields of a workspace.',
    },
    signature: signature<(payload: unknown) => Promise<{ workspace: Workspace } | Failure>>(),
    extensionView: 'shared',
  }),
  method({
    path: 'workspace.delete',
    kind: 'invoke',
    channel: 'workspace:delete',
    mcp: {
      tool: 'delete_workspace',
      description: 'Deletes a workspace and its projects from Terminator.',
      destructive: true,
    },
    signature: signature<
      (id: string) => Promise<{
        success: boolean
        worktreesKept?: Array<{ path: string; reason: string }>
      }>
    >(),
    toPayload: (id) => ({ id }),
    extensionView: 'shared',
  }),
  method({
    path: 'workspace.reorder',
    kind: 'invoke',
    channel: 'workspace:reorder',
    mcp: {
      tool: 'reorder_workspaces',
      description: 'Sets the order of the workspaces in the sidebar.',
    },
    signature: signature<(ids: string[]) => Promise<{ success: boolean }>>(),
    toPayload: (ids) => ({ ids }),
    extensionView: 'shared',
  }),
  method({
    path: 'workspace.getActive',
    kind: 'invoke',
    channel: 'workspace:get-active',
    mcp: false,
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
  method({
    // The app renderer says what is on screen; workspace.getActive answers from it.
    path: 'workspace.setActive',
    kind: 'send',
    channel: 'workspace:active-changed',
    signature:
      signature<
        (context: {
          workspaceId: string | null
          projectId: string | null
          repoRoot: string | null
        }) => void
      >(),
    remote: 'omit',
  }),

  // ── project ───────────────────────────────────────────────────────────────
  method({
    path: 'project.list',
    kind: 'invoke',
    channel: 'project:list',
    mcp: {
      tool: 'list_projects',
      description: 'Lists the projects of a workspace.',
      readOnly: true,
    },
    signature: signature<(workspaceId: string) => Promise<{ projects: Project[] }>>(),
    toPayload: (workspaceId) => ({ workspaceId }),
    extensionView: 'shared',
  }),
  method({
    path: 'project.create',
    kind: 'invoke',
    channel: 'project:create',
    mcp: { tool: 'create_project', description: 'Adds a project folder to a workspace.' },
    signature: signature<(payload: unknown) => Promise<{ project: Project } | Failure>>(),
    extensionView: 'shared',
  }),
  method({
    path: 'project.delete',
    kind: 'invoke',
    channel: 'project:delete',
    mcp: {
      tool: 'delete_project',
      description: 'Removes a project from its workspace.',
      destructive: true,
    },
    signature:
      signature<
        (
          id: string
        ) => Promise<{ success: boolean; worktreeKept?: { path: string; reason: string } }>
      >(),
    toPayload: (id) => ({ id }),
    extensionView: 'shared',
  }),
  method({
    path: 'project.updateBranch',
    kind: 'invoke',
    channel: 'project:update-branch',
    mcp: {
      tool: 'update_project_branch',
      description: 'Records the git branch that a project shows.',
    },
    signature:
      signature<(id: string, gitBranch: string) => Promise<{ project: Project } | Failure>>(),
    toPayload: (id, gitBranch) => ({ id, gitBranch }),
    extensionView: 'shared',
  }),
  method({
    path: 'project.rename',
    kind: 'invoke',
    channel: 'project:rename',
    mcp: { tool: 'rename_project', description: 'Renames a project.' },
    signature: signature<(id: string, name: string) => Promise<{ project: Project } | Failure>>(),
    toPayload: (id, name) => ({ id, name }),
    extensionView: 'shared',
  }),
  method({
    path: 'project.reorder',
    kind: 'invoke',
    channel: 'project:reorder',
    mcp: {
      tool: 'reorder_projects',
      description: 'Sets the order of the projects in a workspace.',
    },
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
    mcp: {
      tool: 'is_git_repo',
      description: 'Tells whether a folder is a git repository.',
      readOnly: true,
    },
    signature:
      signature<
        (path: string) => Promise<{ isRepo: boolean; root?: string } | { error: string }>
      >(),
    toPayload: (path) => ({ path }),
    extensionView: 'shared',
  }),
  method({
    path: 'git.currentBranch',
    kind: 'invoke',
    channel: 'git:current-branch',
    mcp: {
      tool: 'current_branch',
      description: 'Returns the checked-out branch of a repository.',
      readOnly: true,
    },
    signature: signature<(path: string) => Promise<{ branch: string } | Failure>>(),
    toPayload: (path) => ({ path }),
    extensionView: 'shared',
  }),
  method({
    path: 'git.changeStats',
    kind: 'invoke',
    channel: 'git:change-stats',
    mcp: {
      tool: 'git_change_stats',
      description: 'Counts the changed files and lines in a repository.',
      readOnly: true,
    },
    signature: signature<(path: string) => Promise<ChangeStats | Failure>>(),
    toPayload: (path) => ({ path }),
  }),
  method({
    path: 'git.listBranches',
    kind: 'invoke',
    channel: 'git:list-branches',
    mcp: {
      tool: 'list_branches',
      description: 'Lists the branches of a repository.',
      readOnly: true,
    },
    signature: signature<(path: string) => Promise<{ branches: Branch[] }>>(),
    toPayload: (path) => ({ path }),
    extensionView: 'shared',
  }),
  method({
    path: 'git.fetch',
    kind: 'invoke',
    channel: 'git:fetch',
    mcp: { tool: 'git_fetch', description: 'Fetches a repository from its remote.' },
    signature: signature<(path: string) => Promise<{ success: true } | Failure>>(),
    toPayload: (path) => ({ path }),
  }),
  method({
    path: 'git.checkout',
    kind: 'invoke',
    channel: 'git:checkout',
    mcp: {
      tool: 'git_checkout',
      description: 'Checks out a branch, which changes the files in the working tree.',
      destructive: true,
    },
    signature: signature<(path: string, branch: string) => Promise<{ success: true } | Failure>>(),
    toPayload: (path, branch) => ({ path, branch }),
    extensionView: 'shared',
  }),
  method({
    path: 'git.createBranch',
    kind: 'invoke',
    channel: 'git:create-branch',
    mcp: { tool: 'create_branch', description: 'Creates a git branch.' },
    signature: signature<(path: string, branch: string) => Promise<{ success: true } | Failure>>(),
    toPayload: (path, branch) => ({ path, branch }),
    extensionView: 'shared',
  }),
  method({
    path: 'git.suggestWorktreePath',
    kind: 'invoke',
    channel: 'git:suggest-worktree-path',
    mcp: {
      tool: 'suggest_worktree_path',
      description: 'Suggests a folder for a new worktree of a branch.',
      readOnly: true,
    },
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
    mcp: { tool: 'create_worktree', description: 'Creates a git worktree for a branch.' },
    signature: signature<(payload: unknown) => Promise<{ success: true } | Failure>>(),
    extensionView: 'shared',
  }),
  method({
    path: 'git.removeWorktree',
    kind: 'invoke',
    channel: 'git:remove-worktree',
    mcp: {
      tool: 'remove_worktree',
      description: 'Removes a git worktree and its folder.',
      destructive: true,
    },
    signature:
      signature<(repoRoot: string, worktreePath: string) => Promise<{ success: true } | Failure>>(),
    toPayload: (repoRoot, worktreePath) => ({ repoRoot, worktreePath }),
    extensionView: 'shared',
  }),
  method({
    path: 'git.listWorktrees',
    kind: 'invoke',
    channel: 'git:list-worktrees',
    mcp: {
      tool: 'list_worktrees',
      description: 'Lists the worktrees of a repository.',
      readOnly: true,
    },
    signature: signature<(path: string) => Promise<{ worktrees: WorktreeInfo[] }>>(),
    toPayload: (path) => ({ path }),
    extensionView: 'shared',
  }),

  // ── settings ──────────────────────────────────────────────────────────────
  method({
    path: 'settings.getGlobal',
    kind: 'invoke',
    channel: 'settings:get-global',
    mcp: {
      tool: 'get_global_settings',
      description: 'Returns the global Terminator settings.',
      readOnly: true,
    },
    signature: signature<() => Promise<{ settings: GlobalSettings }>>(),
    extensionView: 'shared',
  }),
  method({
    path: 'settings.updateGlobal',
    kind: 'invoke',
    channel: 'settings:update-global',
    mcp: { tool: 'update_global_settings', description: 'Changes global Terminator settings.' },
    signature: signature<(patch: unknown) => Promise<{ settings: GlobalSettings }>>(),
    toPayload: (patch) => ({ patch }),
    extensionView: 'shared',
  }),
  method({
    path: 'settings.getWorkspace',
    kind: 'invoke',
    channel: 'settings:get-workspace',
    mcp: {
      tool: 'get_workspace_settings',
      description: 'Returns the settings of a workspace.',
      readOnly: true,
    },
    signature: signature<(workspaceId: string) => Promise<{ settings: WorkspaceSettings }>>(),
    toPayload: (workspaceId) => ({ workspaceId }),
    extensionView: 'shared',
  }),
  method({
    path: 'settings.updateWorkspace',
    kind: 'invoke',
    channel: 'settings:update-workspace',
    mcp: { tool: 'update_workspace_settings', description: 'Changes the settings of a workspace.' },
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
    mcp: false,
    signature: signature<() => Promise<{ filePath: string } | { cancelled: true }>>(),
    remote: 'stub',
    extensionView: 'shared',
  }),

  // ── extension ─────────────────────────────────────────────────────────────
  method({
    path: 'extension.list',
    kind: 'invoke',
    channel: 'extension:list',
    mcp: {
      tool: 'list_extensions',
      description: 'Lists the installed Terminator extensions.',
      readOnly: true,
    },
    signature: signature<() => Promise<{ extensions: Extension[] }>>(),
    extensionView: 'shared',
  }),
  method({
    path: 'extension.install',
    kind: 'invoke',
    channel: 'extension:install',
    mcp: { tool: 'install_extension', description: 'Installs a Terminator extension.' },
    signature: signature<(directoryPath: string) => Promise<{ extension: Extension } | Failure>>(),
    toPayload: (directoryPath) => ({ directoryPath }),
    extensionView: 'shared',
  }),
  method({
    path: 'extension.toggle',
    kind: 'invoke',
    channel: 'extension:toggle',
    mcp: { tool: 'toggle_extension', description: 'Turns a Terminator extension on or off.' },
    signature:
      signature<(id: string, enabled: boolean) => Promise<{ extension: Extension } | Failure>>(),
    toPayload: (id, enabled) => ({ id, enabled }),
    extensionView: 'shared',
  }),
  method({
    path: 'extension.uninstall',
    kind: 'invoke',
    channel: 'extension:uninstall',
    mcp: {
      tool: 'uninstall_extension',
      description: 'Uninstalls a Terminator extension.',
      destructive: true,
    },
    signature: signature<(id: string) => Promise<{ ok: true } | Failure>>(),
    toPayload: (id) => ({ id }),
    extensionView: 'shared',
  }),
  method({
    path: 'extension.reload',
    kind: 'invoke',
    channel: 'extension:reload',
    mcp: { tool: 'reload_extension', description: 'Reloads a Terminator extension.' },
    signature: signature<(id: string) => Promise<{ extension: Extension } | Failure>>(),
    toPayload: (id) => ({ id }),
    extensionView: 'shared',
  }),
  method({
    path: 'extension.getSettingsSchemas',
    kind: 'invoke',
    channel: 'extension:get-settings-schemas',
    mcp: {
      tool: 'get_extension_settings_schemas',
      description: 'Lists the settings that each extension declares.',
      readOnly: true,
    },
    signature: signature<() => Promise<{ schemas: ExtensionSettingsSchema[] }>>(),
    extensionView: 'shared',
  }),
  method({
    path: 'extension.getSettingsValues',
    kind: 'invoke',
    channel: 'extension:get-settings-values',
    mcp: {
      tool: 'get_extension_settings',
      description: 'Returns the current values of the extension settings.',
      readOnly: true,
    },
    signature: signature<() => Promise<{ values: Record<string, unknown> }>>(),
    extensionView: 'shared',
  }),
  method({
    path: 'extension.updateSetting',
    kind: 'invoke',
    channel: 'extension:update-setting',
    mcp: { tool: 'update_extension_setting', description: 'Changes one global extension setting.' },
    signature: signature<(key: string, value: unknown) => Promise<{ ok: true }>>(),
    toPayload: (key, value) => ({ key, value }),
    extensionView: 'shared',
  }),
  // Workspace Settings: a `workspaceScoped` setting's value for one workspace;
  // no value hands it back to the global one ("Use global default").
  method({
    path: 'extension.updateWorkspaceSetting',
    kind: 'invoke',
    channel: 'extension:update-workspace-setting',
    mcp: {
      tool: 'update_extension_workspace_setting',
      description: 'Changes one extension setting for a workspace.',
    },
    signature:
      signature<
        (
          workspaceId: string,
          key: string,
          value?: unknown
        ) => Promise<{ settings: WorkspaceSettings } | Failure>
      >(),
    toPayload: (workspaceId, key, value) => ({ workspaceId, key, value }),
  }),
  method({
    path: 'extension.onCommandsChanged',
    kind: 'event',
    channel: 'extension:commands-changed',
    signature: signature<(handler: () => void) => Unsubscribe>(),
    toHandlerArgs: () => [],
    // The remote client re-reads the commands each time its panel opens.
    remote: 'omit',
  }),
  method({
    path: 'extension.onListChanged',
    kind: 'event',
    channel: 'extension:list-changed',
    signature: signature<(handler: () => void) => Unsubscribe>(),
    toHandlerArgs: () => [],
    // Remote like extension:list: the remote /app/ shows the same Settings ->
    // Extensions, which re-reads the list on this while it is open.
  }),
  method({
    path: 'extension.onSettingsChanged',
    kind: 'event',
    channel: 'extension:settings-changed',
    // The workspace whose own value changed, or null for a global value.
    signature: signature<(handler: (change: SettingsChange) => void) => Unsubscribe>(),
    toHandlerArgs: (args) => [args[0]],
    // A view re-reads the settings it applies; Settings itself writes them.
    // Shared: a pop-out window runs an extension view on the app preload.
    remote: 'omit',
    extensionView: 'shared',
  }),
  method({
    path: 'extension.getCommands',
    kind: 'invoke',
    channel: 'extension:get-commands',
    mcp: {
      tool: 'list_extension_commands',
      description: 'Lists the commands that the extensions declare.',
      readOnly: true,
    },
    signature: signature<() => Promise<{ commands: ExtensionCommand[] }>>(),
    extensionView: 'shared',
  }),
  method({
    path: 'extension.executeCommand',
    kind: 'send',
    channel: 'extension:execute-command',
    // `via` rides on the context and is split off, so a handler never sees it.
    signature:
      signature<(key: string, ctx: CommandContext & { via?: Via }, args?: unknown) => void>(),
    toPayload: (key, context, args) => {
      if (!context) return { key, ctx: context, args }
      const { via, ...ctx } = context
      return { key, ctx, args, via }
    },
    extensionView: 'shared',
  }),
  // Run another extension's command by full id, e.g.
  // 'terminator.git-integration.command.review-pull-request'. Extension views
  // only, and not on the remote allowlist.
  method({
    path: 'extension.runCommand',
    kind: 'invoke',
    channel: 'extension:run-command',
    mcp: false,
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
    mcp: false,
    signature: signature<(key: string) => Promise<boolean>>(),
    toPayload: (key) => ({ key }),
    // The app renderer too: a command that takes args is in no quick-action list.
    extensionView: 'shared',
    remote: 'omit',
  }),
  // Remote stub: WebContentsView positioning is an Electron-only concept.
  method({
    // The theme of the main window, told to every extension frame (they never see its `data-theme`).
    path: 'extension.setTheme',
    kind: 'send',
    channel: 'extension:set-theme',
    signature: signature<(theme: 'dark' | 'light') => void>(),
    toPayload: (theme) => ({ theme }),
    remote: 'omit',
  }),
  method({
    path: 'extension.openFramePort',
    kind: 'send',
    channel: OPEN_FRAME_PORT_CHANNEL,
    signature: signature<(request: FramePortRequest) => void>(),
    remote: 'omit',
  }),

  // ── shell ─────────────────────────────────────────────────────────────────
  method({
    path: 'shell.exec',
    kind: 'invoke',
    channel: 'shell:exec',
    mcp: false,
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
    mcp: { tool: 'open_path', description: 'Opens a file or folder with its default macOS app.' },
    signature: signature<(filePath: string) => Promise<{ ok: true } | Failure>>(),
    toPayload: (filePath) => ({ filePath }),
    extensionView: 'shared',
  }),
  // Remote stub: opens in a new browser tab instead of the host OS.
  method({
    path: 'shell.openExternal',
    kind: 'invoke',
    channel: 'shell:open-external',
    mcp: false,
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
    mcp: {
      tool: 'detect_editors',
      description: 'Lists the code editors installed on this Mac.',
      readOnly: true,
    },
    signature: signature<() => Promise<{ editor: { id: string; name: string } | null }>>(),
    remote: 'omit',
  }),
  method({
    path: 'editor.open',
    kind: 'invoke',
    channel: 'editor:open',
    mcp: { tool: 'open_in_editor', description: 'Opens a folder in a code editor.' },
    signature: signature<(folderPath: string) => Promise<{ ok: true; editor: string } | Failure>>(),
    toPayload: (folderPath) => ({ folderPath }),
    remote: 'omit',
  }),

  // ── fs ────────────────────────────────────────────────────────────────────
  // A watch belongs to the view that asked (ADR 109). A browser client has no view the desktop
  // can tell, so its three watch methods are stand-ins: watchStart answers WATCH_UNAVAILABLE.
  method({
    path: 'fs.watchStart',
    kind: 'invoke',
    channel: 'fs:watch-start',
    mcp: false,
    signature: signature<(projectRoot: string) => Promise<{ ok: true } | Failure>>(),
    toPayload: (projectRoot) => ({ projectRoot }),
    remote: 'stub',
    extensionView: 'shared',
  }),
  method({
    path: 'fs.watchStop',
    kind: 'invoke',
    channel: 'fs:watch-stop',
    mcp: false,
    signature: signature<() => Promise<{ ok: true }>>(),
    remote: 'stub',
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
    remote: 'stub',
    extensionView: 'shared',
  }),
  method({
    path: 'fs.readFile',
    kind: 'invoke',
    channel: 'fs:read-file',
    mcp: false,
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
    path: 'extensionEvents.onMenuOpenUsage',
    kind: 'event',
    channel: 'menu:open-usage',
    signature: signature<(handler: () => void) => Unsubscribe>(),
    toHandlerArgs: () => [],
    remote: 'omit',
  }),
  method({
    path: 'extensionEvents.onMenuOpenTaskSwitcher',
    kind: 'event',
    channel: 'menu:open-task-switcher',
    signature: signature<(handler: () => void) => Unsubscribe>(),
    toHandlerArgs: () => [],
    remote: 'omit',
  }),
  method({
    path: 'extensionEvents.onMenuSwitchLane',
    kind: 'event',
    channel: 'menu:switch-lane',
    signature: signature<(handler: (lane: number) => void) => Unsubscribe>(),
    toHandlerArgs: (args) => [(args[0] as { lane: number }).lane],
    remote: 'omit',
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
    signature: signature<(handler: (sessionId: string | null) => void) => Unsubscribe>(),
    toHandlerArgs: (args) => [
      (args[0] as { sessionId?: string | null } | undefined)?.sessionId ?? null,
    ],
  }),
  method({
    path: 'extensionEvents.onMenuToggleBreakout',
    kind: 'event',
    channel: 'menu:toggle-breakout',
    signature: signature<(handler: (sessionId: string | null) => void) => Unsubscribe>(),
    toHandlerArgs: (args) => [(args[0] as { sessionId: string | null }).sessionId],
    remote: 'omit',
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
  extensionIdEvent('extensionEvents.onExtensionRendererReload', 'extension:renderer-reload'),
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
    mcp: {
      tool: 'get_app_info',
      description: 'Returns the Terminator version and platform.',
      readOnly: true,
    },
    signature: signature<() => Promise<AppInfo>>(),
    extensionView: 'shared',
  }),

  // ── breakout ──────────────────────────────────────────────────────────────
  method({
    path: 'breakout.onClosed',
    kind: 'event',
    channel: 'breakout:closed',
    signature: signature<(handler: (sessionId: string) => void) => Unsubscribe>(),
    toHandlerArgs: (args) => [(args[0] as { sessionId: string }).sessionId],
    remote: 'omit',
  }),

  // The frame counts a use; main prefixes the extension id from the frame's own port, so a
  // view cannot count under another extension. Frame-only: the app renderer uses usage.recordUse.
  method({
    path: 'usage.record',
    kind: 'local',
    signature: signature<(feature: string, outcome?: { failed?: boolean }) => void>(),
    extensionView: 'only',
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
    mcp: false,
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
    mcp: {
      tool: 'list_notifications',
      description: 'Lists the Terminator notifications.',
      readOnly: true,
    },
    signature: signature<() => Promise<SerializedNotification[]>>(),
    extensionView: 'shared',
  }),
  method({
    path: 'notifications.dismiss',
    kind: 'invoke',
    channel: 'notifications:dismiss',
    mcp: { tool: 'dismiss_notification', description: 'Dismisses a Terminator notification.' },
    signature: signature<(id: string) => Promise<{ ok: true } | Failure>>(),
    toPayload: (id) => ({ id }),
    extensionView: 'shared',
  }),
  method({
    path: 'notifications.triggerAction',
    kind: 'invoke',
    channel: 'notifications:trigger-action',
    mcp: {
      tool: 'trigger_notification_action',
      description: 'Runs an action button of a notification.',
    },
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
    mcp: false,
    signature: signature<() => Promise<{ ok: boolean; message?: string }>>(),
    remote: 'omit',
    extensionView: 'shared',
  }),

  // ── metrics ───────────────────────────────────────────────────────────────
  method({
    path: 'metrics.getSystem',
    kind: 'invoke',
    channel: 'metrics:system',
    mcp: {
      tool: 'get_system_metrics',
      description: 'Returns CPU and memory use of this Mac.',
      readOnly: true,
    },
    signature: signature<() => Promise<{ data: SystemMetrics } | Failure>>(),
    extensionView: 'shared',
  }),
  method({
    path: 'metrics.getProcesses',
    kind: 'invoke',
    channel: 'metrics:processes',
    mcp: {
      tool: 'get_process_metrics',
      description: 'Returns CPU and memory use of the Terminator processes.',
      readOnly: true,
    },
    signature: signature<(pids: number[]) => Promise<{ data: ProcessMetrics[] } | Failure>>(),
    toPayload: (pids) => ({ pids }),
    extensionView: 'shared',
  }),
  method({
    path: 'metrics.getPids',
    kind: 'invoke',
    channel: 'metrics:pids',
    mcp: false,
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
    mcp: {
      tool: 'list_session_records',
      description: 'Lists the recorded sessions of a workspace.',
      readOnly: true,
    },
    signature: signature<() => Promise<{ data: SessionRecordListing[] }>>(),
  }),
  method({
    path: 'sessionRecords.setDescription',
    kind: 'invoke',
    channel: 'session-records:set-description',
    mcp: {
      tool: 'set_session_description',
      description: 'Sets the description of a recorded session.',
    },
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
    mcp: {
      tool: 'set_session_link',
      description: 'Links a recorded session to an issue or pull request.',
    },
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
    mcp: false,
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
    mcp: {
      tool: 'forget_session_record',
      description: 'Deletes a session record.',
      destructive: true,
    },
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

  // ── tasks (lanes across repositories, grouped as one piece of work) ───────
  method({
    path: 'tasks.list',
    kind: 'invoke',
    channel: 'task:list',
    mcp: { tool: 'list_tasks', description: 'Lists the tasks on Home.', readOnly: true },
    signature: signature<() => Promise<{ data: Task[] }>>(),
    remote: 'omit',
  }),
  method({
    path: 'tasks.create',
    kind: 'invoke',
    channel: 'task:create',
    mcp: { tool: 'create_task', description: 'Creates a task on Home.' },
    signature: signature<(input: z.input<typeof TaskCreateInputSchema>) => TaskResult>(),
    remote: 'omit',
  }),
  method({
    path: 'tasks.update',
    kind: 'invoke',
    channel: 'task:update',
    mcp: { tool: 'update_task', description: 'Changes the fields of a task.' },
    signature: signature<(input: z.input<typeof TaskUpdateInputSchema>) => TaskResult>(),
    remote: 'omit',
  }),
  method({
    path: 'tasks.addLane',
    kind: 'invoke',
    channel: 'task:add-lane',
    mcp: { tool: 'add_task_lane', description: 'Adds a lane to a task.' },
    signature: signature<(input: z.input<typeof TaskLaneInputSchema>) => TaskResult>(),
    remote: 'omit',
  }),
  method({
    path: 'tasks.removeLane',
    kind: 'invoke',
    channel: 'task:remove-lane',
    mcp: {
      tool: 'remove_task_lane',
      description: 'Removes a lane from a task.',
      destructive: true,
    },
    signature: signature<(input: z.input<typeof TaskLaneInputSchema>) => TaskResult>(),
    remote: 'omit',
  }),
  method({
    path: 'tasks.archive',
    kind: 'invoke',
    channel: 'task:archive',
    mcp: { tool: 'archive_task', description: 'Archives a task or brings it back.' },
    signature: signature<(input: z.input<typeof TaskArchiveInputSchema>) => TaskResult>(),
    remote: 'omit',
  }),
  method({
    path: 'tasks.delete',
    kind: 'invoke',
    channel: 'task:delete',
    mcp: { tool: 'delete_task', description: 'Deletes a task.', destructive: true },
    signature: signature<(input: z.input<typeof TaskIdInputSchema>) => TaskResult>(),
    remote: 'omit',
  }),
  method({
    path: 'tasks.merge',
    kind: 'invoke',
    channel: 'task:merge',
    mcp: { tool: 'merge_task', description: 'Merges one task into another.' },
    signature: signature<(input: z.input<typeof TaskMergeInputSchema>) => TaskResult>(),
    remote: 'omit',
  }),
  method({
    path: 'tasks.onChanged',
    kind: 'event',
    channel: 'task:changed',
    signature: signature<(handler: (tasks: Task[]) => void) => Unsubscribe>(),
    remote: 'omit',
  }),

  // ── agent usage and work-thread summaries (core only) ─────────────────────
  method({
    path: 'agentUsage.get',
    kind: 'invoke',
    channel: 'agents:usage',
    mcp: {
      tool: 'get_agent_usage',
      description: 'Returns the token use and cost of an agent session.',
      readOnly: true,
    },
    signature:
      signature<
        (
          input: z.input<typeof AgentUsageInputSchema>
        ) => Promise<{ data: AgentUsage } | { error: string; message: string }>
      >(),
    remote: 'omit',
  }),
  method({
    path: 'homeThreadSummary.get',
    kind: 'invoke',
    channel: 'home:thread-summary',
    mcp: {
      tool: 'get_thread_summary',
      description: 'Summarises the work of a task in one paragraph.',
      readOnly: true,
    },
    signature:
      signature<
        (
          input: z.input<typeof ThreadSummaryInputSchema>
        ) => Promise<{ text: string; generatedAt: string } | { error: string }>
      >(),
    remote: 'omit',
  }),

  // ── agent asks (a Claude Code Notification hook says the agent is waiting on you) ──
  method({
    path: 'agentAsk.list',
    kind: 'invoke',
    channel: 'agent-ask:list',
    mcp: {
      tool: 'list_agent_asks',
      description: 'Lists the questions that agent sessions wait on.',
      readOnly: true,
    },
    signature: signature<() => Promise<{ data: Array<{ sessionId: string; ask: AgentAsk }> }>>(),
    remote: 'omit',
  }),
  method({
    path: 'agentAsk.onChanged',
    kind: 'event',
    channel: 'agent-ask:changed',
    signature:
      signature<
        (handler: (payload: { sessionId: string; ask: AgentAsk | null }) => void) => Unsubscribe
      >(),
    remote: 'omit',
  }),

  // ── agent turns (Claude Code's UserPromptSubmit and Stop hooks say the agent is mid-turn) ──
  method({
    path: 'agentTurn.list',
    kind: 'invoke',
    channel: 'agent-turn:list',
    mcp: {
      tool: 'list_agent_turns',
      description: 'Tells which agent sessions are in a turn.',
      readOnly: true,
    },
    signature: signature<() => Promise<{ data: Array<{ sessionId: string; inTurn: boolean }> }>>(),
    remote: 'omit',
  }),
  method({
    path: 'agentTurn.onChanged',
    kind: 'event',
    channel: 'agent-turn:changed',
    signature:
      signature<
        (handler: (payload: { sessionId: string; inTurn: boolean }) => void) => Unsubscribe
      >(),
    remote: 'omit',
  }),

  // ── agents over ACP (the core's AgentService; extensions use api.agents) ──
  method({
    path: 'agents.list',
    kind: 'invoke',
    channel: 'agents:list',
    mcp: { tool: 'list_agents', description: 'Lists the running agent sessions.', readOnly: true },
    signature:
      signature<() => Promise<{ data: AgentDescriptor[] } | { error: string; message: string }>>(),
    remote: 'omit',
  }),
  method({
    path: 'agents.known',
    kind: 'invoke',
    channel: 'agents:known',
    mcp: {
      tool: 'list_known_agents',
      description: 'Lists the agents Terminator can start and whether each is installed.',
      readOnly: true,
    },
    signature:
      signature<() => Promise<{ data: KnownAgentStatus[] } | { error: string; message: string }>>(),
    remote: 'omit',
  }),
  method({
    path: 'agents.start',
    kind: 'invoke',
    channel: 'agents:start',
    mcp: { tool: 'start_agent', description: 'Starts an agent session.' },
    signature:
      signature<
        (
          input: z.input<typeof AgentStartInputSchema>
        ) => Promise<{ data: AgentStarted | null } | { error: string; message: string }>
      >(),
    remote: 'omit',
  }),
  method({
    path: 'agents.prompt',
    kind: 'invoke',
    channel: 'agents:prompt',
    mcp: { tool: 'prompt_agent', description: 'Sends a prompt to an agent session.' },
    signature:
      signature<
        (
          input: z.input<typeof AgentPromptInputSchema>
        ) => Promise<{ data: AgentTurnEnd } | { error: string; message: string }>
      >(),
    remote: 'omit',
  }),
  method({
    path: 'agents.steer',
    kind: 'invoke',
    channel: 'agents:steer',
    mcp: {
      tool: 'steer_agent',
      description: 'Sends a message to an agent session during its turn.',
    },
    signature:
      signature<
        (
          input: z.input<typeof AgentSteerInputSchema>
        ) => Promise<{ data: true } | { error: string; message: string }>
      >(),
    remote: 'omit',
  }),
  method({
    path: 'agents.queueSet',
    kind: 'invoke',
    channel: 'agents:queue-set',
    mcp: false,
    signature:
      signature<
        (
          input: z.input<typeof AgentQueueInputSchema>
        ) => Promise<{ data: true } | { error: string; message: string }>
      >(),
    remote: 'omit',
  }),
  method({
    path: 'agents.queueGet',
    kind: 'invoke',
    channel: 'agents:queue-get',
    mcp: false,
    signature:
      signature<
        (
          input: z.input<typeof AgentSessionInputSchema>
        ) => Promise<{ data: string[] } | { error: string; message: string }>
      >(),
    remote: 'omit',
  }),
  method({
    path: 'agents.cancel',
    kind: 'invoke',
    channel: 'agents:cancel',
    mcp: {
      tool: 'cancel_agent_turn',
      description: 'Cancels the current turn of an agent session.',
    },
    signature:
      signature<
        (
          input: z.input<typeof AgentSessionInputSchema>
        ) => Promise<{ data: true } | { error: string; message: string }>
      >(),
    remote: 'omit',
  }),
  method({
    path: 'agents.answer',
    kind: 'invoke',
    channel: 'agents:answer',
    mcp: {
      tool: 'answer_agent',
      description: 'Answers a permission question of an agent session.',
    },
    signature:
      signature<
        (
          input: z.input<typeof AgentAnswerInputSchema>
        ) => Promise<{ data: boolean } | { error: string; message: string }>
      >(),
    remote: 'omit',
  }),
  method({
    path: 'agents.setConfig',
    kind: 'invoke',
    channel: 'agents:set-config',
    mcp: false,
    signature:
      signature<
        (
          input: z.input<typeof AgentSetConfigInputSchema>
        ) => Promise<{ data: boolean } | { error: string; message: string }>
      >(),
    remote: 'omit',
  }),
  method({
    path: 'agents.close',
    kind: 'invoke',
    channel: 'agents:close',
    mcp: { tool: 'close_agent', description: 'Closes an agent session.', destructive: true },
    signature:
      signature<
        (
          input: z.input<typeof AgentSessionInputSchema>
        ) => Promise<{ data: true } | { error: string; message: string }>
      >(),
    remote: 'omit',
  }),
  method({
    path: 'agents.history',
    kind: 'invoke',
    channel: 'agents:history',
    mcp: {
      tool: 'agent_history',
      description: 'Returns the updates of an agent session.',
      readOnly: true,
    },
    signature:
      signature<
        (
          input: z.input<typeof AgentSessionInputSchema>
        ) => Promise<{ data: AgentUpdate[] } | { error: string; message: string }>
      >(),
    remote: 'omit',
  }),
  method({
    path: 'agents.openAsks',
    kind: 'invoke',
    channel: 'agents:open-asks',
    mcp: {
      tool: 'list_open_agent_asks',
      description: 'Lists the open permission questions of agent sessions.',
      readOnly: true,
    },
    signature:
      signature<
        () => Promise<{ data: AgentPermissionAsk[] } | { error: string; message: string }>
      >(),
    remote: 'omit',
  }),
  method({
    path: 'agents.onUpdate',
    kind: 'event',
    channel: 'agents:update',
    signature:
      signature<
        (handler: (payload: { sessionId: string; update: AgentUpdate }) => void) => Unsubscribe
      >(),
    remote: 'omit',
  }),
  method({
    path: 'agents.onPermission',
    kind: 'event',
    channel: 'agents:permission',
    signature:
      signature<
        (handler: (payload: { sessionId: string; ask: AgentPermissionAsk }) => void) => Unsubscribe
      >(),
    remote: 'omit',
  }),
  method({
    path: 'agents.onPermissionSettled',
    kind: 'event',
    channel: 'agents:permission-settled',
    signature:
      signature<
        (handler: (payload: { sessionId: string; requestId: string }) => void) => Unsubscribe
      >(),
    remote: 'omit',
  }),
  method({
    path: 'agents.onQueueChanged',
    kind: 'event',
    channel: 'agents:queue',
    signature:
      signature<
        (handler: (payload: { sessionId: string; messages: string[] }) => void) => Unsubscribe
      >(),
    remote: 'omit',
  }),
  method({
    path: 'agents.onEnd',
    kind: 'event',
    channel: 'agents:end',
    signature:
      signature<
        (handler: (payload: { sessionId: string; exitCode: number | null }) => void) => Unsubscribe
      >(),
    remote: 'omit',
  }),

  // ── attention log (when sessions worked and when they waited on you) ──────
  method({
    path: 'attention.record',
    kind: 'invoke',
    channel: 'attention:record',
    mcp: false,
    signature:
      signature<
        (
          input: z.input<typeof RecordStateInputSchema>
        ) => Promise<{ data: true } | { error: string; message: string }>
      >(),
    remote: 'omit',
  }),
  method({
    path: 'attention.measures',
    kind: 'invoke',
    channel: 'attention:measures',
    mcp: false,
    signature:
      signature<
        (input: z.input<typeof MeasuresInputSchema>) => Promise<{ data: AttentionMeasures }>
      >(),
    remote: 'omit',
  }),
  method({
    path: 'attention.intervals',
    kind: 'invoke',
    channel: 'attention:intervals',
    mcp: false,
    signature:
      signature<
        (input: z.input<typeof MeasuresInputSchema>) => Promise<{ data: AttentionInterval[] }>
      >(),
    remote: 'omit',
  }),

  // ── usage counts (every use of every feature on this Mac; core only) ──────
  // Stubbed remotely: a browser renders the same App, which counts, but counts only this Mac.
  method({
    path: 'usage.recordUse',
    kind: 'invoke',
    channel: 'usage:record',
    mcp: false,
    signature:
      signature<
        (
          input: z.input<typeof UsageRecordInputSchema>
        ) => Promise<{ data: true } | { error: string; message: string }>
      >(),
    remote: 'stub',
  }),
  method({
    path: 'usage.declare',
    kind: 'invoke',
    channel: 'usage:declare',
    mcp: false,
    signature:
      signature<
        (
          input: z.input<typeof UsageDeclareInputSchema>
        ) => Promise<{ data: true } | { error: string; message: string }>
      >(),
    remote: 'stub',
  }),
  method({
    path: 'usage.report',
    kind: 'invoke',
    channel: 'usage:report',
    mcp: false,
    signature:
      signature<
        (
          input: z.input<typeof UsageReportInputSchema>
        ) => Promise<{ data: UsageReport } | { error: string; message: string }>
      >(),
    remote: 'stub',
  }),

  // ── home feed (what extensions publish for Home to draw; core only) ───────
  method({
    path: 'homeFeed.get',
    kind: 'invoke',
    channel: 'home:feed-get',
    mcp: {
      tool: 'get_home_feed',
      description: 'Returns the items of the Home feed.',
      readOnly: true,
    },
    signature: signature<() => Promise<{ data: MergedHomeFeed }>>(),
    remote: 'omit',
  }),
  method({
    path: 'homeFeed.action',
    kind: 'invoke',
    channel: 'home:feed-action',
    mcp: { tool: 'run_home_feed_action', description: 'Runs an action of a Home feed item.' },
    signature:
      signature<
        (
          input: z.input<typeof HomeFeedActionInputSchema>
        ) => Promise<{ data: true } | { error: string; message: string }>
      >(),
    remote: 'omit',
  }),
  method({
    path: 'homeFeed.onChanged',
    kind: 'event',
    channel: 'home:feed-changed',
    signature: signature<(handler: (feed: MergedHomeFeed) => void) => Unsubscribe>(),
    remote: 'omit',
  }),

  // ── schedules (prompts that run later) and branch names (core only) ───────
  method({
    path: 'schedules.list',
    kind: 'invoke',
    channel: 'schedules:list',
    mcp: { tool: 'list_schedules', description: 'Lists the scheduled runs.', readOnly: true },
    signature:
      signature<() => Promise<{ data: Schedule[] } | { error: string; message: string }>>(),
    remote: 'omit',
  }),
  method({
    path: 'schedules.create',
    kind: 'invoke',
    channel: 'schedules:create',
    mcp: { tool: 'create_schedule', description: 'Creates a scheduled run.' },
    signature:
      signature<
        (
          input: z.input<typeof ScheduleInputSchema>
        ) => Promise<{ data: Schedule } | { error: string; message: string }>
      >(),
    remote: 'omit',
  }),
  method({
    path: 'schedules.delete',
    kind: 'invoke',
    channel: 'schedules:delete',
    mcp: { tool: 'delete_schedule', description: 'Deletes a scheduled run.', destructive: true },
    signature:
      signature<
        (
          input: z.input<typeof ScheduleIdInputSchema>
        ) => Promise<{ data: true } | { error: string; message: string }>
      >(),
    remote: 'omit',
  }),
  method({
    path: 'schedules.update',
    kind: 'invoke',
    channel: 'schedules:update',
    mcp: { tool: 'update_schedule', description: 'Changes a scheduled run.' },
    signature:
      signature<
        (
          input: z.input<typeof ScheduleUpdateInputSchema>
        ) => Promise<{ data: Schedule } | { error: string; message: string }>
      >(),
    remote: 'omit',
  }),
  method({
    path: 'schedules.pause',
    kind: 'invoke',
    channel: 'schedules:pause',
    mcp: { tool: 'pause_schedule', description: 'Pauses or resumes a scheduled run.' },
    signature:
      signature<
        (
          input: z.input<typeof SchedulePauseInputSchema>
        ) => Promise<{ data: true } | { error: string; message: string }>
      >(),
    remote: 'omit',
  }),
  method({
    path: 'schedules.runNow',
    kind: 'invoke',
    channel: 'schedules:run-now',
    mcp: { tool: 'run_schedule_now', description: 'Starts a scheduled run now.' },
    signature:
      signature<
        (
          input: z.input<typeof ScheduleIdInputSchema>
        ) => Promise<{ data: true } | { error: string; message: string }>
      >(),
    remote: 'omit',
  }),
  method({
    path: 'schedules.onRun',
    kind: 'event',
    channel: 'schedules:run',
    signature: signature<(handler: (schedule: DueSchedule) => void) => Unsubscribe>(),
    remote: 'omit',
  }),
  method({
    path: 'homeBranchName.get',
    kind: 'invoke',
    channel: 'home:branch-name',
    mcp: {
      tool: 'suggest_branch_name',
      description: 'Suggests a branch name for a prompt.',
      readOnly: true,
    },
    signature:
      signature<
        (
          input: z.input<typeof BranchNameInputSchema>
        ) => Promise<{ text: string } | { error: string }>
      >(),
    remote: 'omit',
  }),

  // ── integrations (issue trackers) ─────────────────────────────────────────
  method({
    path: 'integrations.status',
    kind: 'invoke',
    channel: 'integrations:status',
    mcp: {
      tool: 'get_integration_status',
      description: 'Returns the connection state of the issue trackers.',
      readOnly: true,
    },
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
    mcp: false,
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
    mcp: false,
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
    mcp: {
      tool: 'set_my_issues_filter',
      description: 'Sets which issues count as mine in a tracker.',
    },
    signature:
      signature<(input: z.input<typeof SetMineInputSchema>) => Promise<{ ok: true } | Failure>>(),
  }),
  method({
    path: 'integrations.listMine',
    kind: 'invoke',
    channel: 'integrations:issue-list-mine',
    mcp: {
      tool: 'list_my_issues',
      description: 'Lists the issues assigned to me.',
      readOnly: true,
    },
    signature:
      signature<
        (input: z.input<typeof ListMineInputSchema>) => Promise<IssueListResult | DetailedFailure>
      >(),
  }),
  method({
    path: 'integrations.search',
    kind: 'invoke',
    channel: 'integrations:issue-search',
    mcp: { tool: 'search_issues', description: 'Searches the issue tracker.', readOnly: true },
    signature:
      signature<
        (input: z.input<typeof SearchInputSchema>) => Promise<IssueListResult | DetailedFailure>
      >(),
  }),
  method({
    path: 'integrations.getIssue',
    kind: 'invoke',
    channel: 'integrations:issue-get',
    mcp: { tool: 'get_issue', description: 'Returns one issue from the tracker.', readOnly: true },
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
    mcp: { tool: 'comment_on_issue', description: 'Adds a comment to an issue.' },
    signature:
      signature<
        (input: z.input<typeof IssueCommentInputSchema>) => Promise<{ ok: true } | DetailedFailure>
      >(),
  }),
  method({
    path: 'integrations.linkSet',
    kind: 'invoke',
    channel: 'integrations:link-set',
    mcp: { tool: 'link_issue', description: 'Links an issue to a project.' },
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
    mcp: {
      tool: 'get_issue_link',
      description: 'Returns the issue linked to a project.',
      readOnly: true,
    },
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
    mcp: { tool: 'unlink_issue', description: 'Removes the issue link of a project.' },
    signature:
      signature<(input: z.input<typeof ProjectIdInputSchema>) => Promise<{ ok: true } | Failure>>(),
  }),
  method({
    path: 'integrations.contextPreview',
    kind: 'invoke',
    channel: 'integrations:context-preview',
    mcp: {
      tool: 'preview_issue_context',
      description: 'Shows the issue context that agents of a project get.',
      readOnly: true,
    },
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
    mcp: {
      tool: 'set_inject_issue_context',
      description: 'Turns issue context for the agents of a project on or off.',
    },
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

  // ── mcp ───────────────────────────────────────────────────────────────────
  // Terminator MCP server tools that only the renderer can run (renderer-tools.ts).
  method({
    path: 'mcp.onCall',
    kind: 'event',
    channel: 'mcp:call',
    signature: signature<(handler: (call: McpCall) => void) => Unsubscribe>(),
    remote: 'omit',
  }),
  method({
    path: 'mcp.answer',
    kind: 'invoke',
    channel: 'mcp:answer',
    mcp: false,
    signature: signature<(answer: McpAnswer) => Promise<void>>(),
    remote: 'omit',
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

/** One Terminator MCP server tool that calls an invoke channel. */
export interface McpToolSpec {
  channel: string
  tool: string
  description: string
  destructive: boolean
  readOnly: boolean
}

/** The Terminator MCP server's manifest tools: every invoke method with an `mcp` object. */
export function mcpToolSpecs(): McpToolSpec[] {
  const tools: McpToolSpec[] = []
  for (const spec of ELECTRON_API_MANIFEST as readonly ChannelSpec[]) {
    if (spec.kind !== 'invoke' || !spec.mcp) continue
    const { tool, description, destructive, readOnly } = spec.mcp
    tools.push({
      channel: spec.channel!,
      tool,
      description,
      destructive: destructive === true,
      readOnly: readOnly === true,
    })
  }
  return tools
}
