// The single declaration of the window.electronAPI surface.
//
// Both adapters are generated from this manifest:
//   - src/main/preload.ts        (native: ipcRenderer over Electron IPC)
//   - src/renderer-remote/electron-api-shim.ts  (remote: WebSocket bridge)
//
// and the core remote allowlist (src/main/remote/remote-accessible-channels.ts)
// is derived from it: every spec whose `remote` behavior is 'same' is reachable
// through the remote bridge; 'stub' methods are replaced by a transport-local
// implementation in the remote adapter; 'omit' methods do not exist remotely.
//
// Adding a channel here is the ONLY step needed to expose it on both transports.
// This module must stay dependency-free (no electron, no DOM): it is bundled
// into the sandboxed preload, the browser shim, and the main process.

export type RemoteBehavior = 'same' | 'omit' | 'stub'

export interface ChannelSpec {
  /** Dot path on window.electronAPI, e.g. 'terminal.create' or 'getFilePath'. */
  path: string
  /**
   * invoke — request/response over transport.invoke
   * send   — fire-and-forget over transport.send
   * event  — main→renderer push; method subscribes a handler, returns unsubscribe
   * local  — no channel; implementation supplied per adapter (locals[path])
   */
  kind: 'invoke' | 'send' | 'event' | 'local'
  /** IPC channel name. Required unless kind is 'local'. */
  channel?: string
  /** Maps the method's arguments to the single wire payload. Default: first arg. */
  toPayload?: (...args: never[]) => unknown
  /** Maps the pushed wire args to the subscriber handler's arguments. Default: all args. */
  toHandlerArgs?: (args: unknown[]) => unknown[]
  /** Behavior on the remote transport. Default: 'same'. */
  remote?: RemoteBehavior
}

export const ELECTRON_API_MANIFEST: readonly ChannelSpec[] = [
  // ── terminal ──────────────────────────────────────────────────────────────
  { path: 'terminal.create', kind: 'invoke', channel: 'terminal:create' },
  {
    path: 'terminal.close',
    kind: 'invoke',
    channel: 'terminal:close',
    toPayload: (sessionId: string) => ({ sessionId }),
  },
  {
    path: 'terminal.input',
    kind: 'send',
    channel: 'terminal:input',
    toPayload: (sessionId: string, data: string) => ({ sessionId, data }),
  },
  {
    path: 'terminal.resize',
    kind: 'send',
    channel: 'terminal:resize',
    toPayload: (sessionId: string, cols: number, rows: number) => ({ sessionId, cols, rows }),
  },
  {
    path: 'terminal.onOutput',
    kind: 'event',
    channel: 'terminal:output',
    toHandlerArgs: (args) => {
      const p = args[0] as { sessionId: string; data: string }
      return [p.sessionId, p.data]
    },
  },
  { path: 'terminal.closeAll', kind: 'invoke', channel: 'terminal:close-all' },
  { path: 'terminal.cleanupOrphans', kind: 'invoke', channel: 'terminal:cleanup-orphans' },
  {
    path: 'terminal.onProcessExit',
    kind: 'event',
    channel: 'terminal:process-exit',
    toHandlerArgs: (args) => {
      const p = args[0] as { sessionId: string; exitCode: number }
      return [p.sessionId, p.exitCode]
    },
  },

  // ── workspace ─────────────────────────────────────────────────────────────
  { path: 'workspace.list', kind: 'invoke', channel: 'workspace:list' },
  { path: 'workspace.create', kind: 'invoke', channel: 'workspace:create' },
  { path: 'workspace.update', kind: 'invoke', channel: 'workspace:update' },
  {
    path: 'workspace.delete',
    kind: 'invoke',
    channel: 'workspace:delete',
    toPayload: (id: string) => ({ id }),
  },
  {
    path: 'workspace.reorder',
    kind: 'invoke',
    channel: 'workspace:reorder',
    toPayload: (ids: string[]) => ({ ids }),
  },
  {
    path: 'workspace.getActive',
    kind: 'invoke',
    channel: 'workspace:get-active',
    remote: 'omit',
  },

  // ── project ───────────────────────────────────────────────────────────────
  {
    path: 'project.list',
    kind: 'invoke',
    channel: 'project:list',
    toPayload: (workspaceId: string) => ({ workspaceId }),
  },
  { path: 'project.create', kind: 'invoke', channel: 'project:create' },
  {
    path: 'project.delete',
    kind: 'invoke',
    channel: 'project:delete',
    toPayload: (id: string) => ({ id }),
  },
  {
    path: 'project.updateBranch',
    kind: 'invoke',
    channel: 'project:update-branch',
    toPayload: (id: string, gitBranch: string) => ({ id, gitBranch }),
  },
  {
    path: 'project.rename',
    kind: 'invoke',
    channel: 'project:rename',
    toPayload: (id: string, name: string) => ({ id, name }),
  },
  {
    path: 'project.reorder',
    kind: 'invoke',
    channel: 'project:reorder',
    toPayload: (workspaceId: string, ids: string[]) => ({ workspaceId, ids }),
  },
  {
    path: 'project.onAdded',
    kind: 'event',
    channel: 'workspace:project-added',
    toHandlerArgs: (args) => [args[0]],
    remote: 'omit',
  },
  {
    path: 'project.onRemoved',
    kind: 'event',
    channel: 'workspace:project-removed',
    toHandlerArgs: (args) => [(args[0] as { id: string }).id],
    remote: 'omit',
  },

  // ── git ───────────────────────────────────────────────────────────────────
  {
    path: 'git.isRepo',
    kind: 'invoke',
    channel: 'git:is-repo',
    toPayload: (path: string) => ({ path }),
  },
  {
    path: 'git.currentBranch',
    kind: 'invoke',
    channel: 'git:current-branch',
    toPayload: (path: string) => ({ path }),
  },
  {
    path: 'git.listBranches',
    kind: 'invoke',
    channel: 'git:list-branches',
    toPayload: (path: string) => ({ path }),
  },
  {
    path: 'git.checkout',
    kind: 'invoke',
    channel: 'git:checkout',
    toPayload: (path: string, branch: string) => ({ path, branch }),
  },
  {
    path: 'git.createBranch',
    kind: 'invoke',
    channel: 'git:create-branch',
    toPayload: (path: string, branch: string) => ({ path, branch }),
  },
  {
    path: 'git.suggestWorktreePath',
    kind: 'invoke',
    channel: 'git:suggest-worktree-path',
    toPayload: (repoRoot: string, branch: string, baseDir?: string) => ({
      repoRoot,
      branch,
      baseDir,
    }),
  },
  { path: 'git.createWorktree', kind: 'invoke', channel: 'git:create-worktree' },
  {
    path: 'git.removeWorktree',
    kind: 'invoke',
    channel: 'git:remove-worktree',
    toPayload: (repoRoot: string, worktreePath: string) => ({ repoRoot, worktreePath }),
  },
  {
    path: 'git.listWorktrees',
    kind: 'invoke',
    channel: 'git:list-worktrees',
    toPayload: (path: string) => ({ path }),
  },

  // ── settings ──────────────────────────────────────────────────────────────
  { path: 'settings.getGlobal', kind: 'invoke', channel: 'settings:get-global' },
  {
    path: 'settings.updateGlobal',
    kind: 'invoke',
    channel: 'settings:update-global',
    toPayload: (patch: unknown) => ({ patch }),
  },
  {
    path: 'settings.getWorkspace',
    kind: 'invoke',
    channel: 'settings:get-workspace',
    toPayload: (workspaceId: string) => ({ workspaceId }),
  },
  {
    path: 'settings.updateWorkspace',
    kind: 'invoke',
    channel: 'settings:update-workspace',
    toPayload: (workspaceId: string, patch: unknown) => ({ workspaceId, patch }),
  },

  // ── dialog ────────────────────────────────────────────────────────────────
  // Remote stub: a browser client cannot open a native directory picker.
  {
    path: 'dialog.openDirectory',
    kind: 'invoke',
    channel: 'dialog:open-directory',
    remote: 'stub',
  },

  // ── extension ─────────────────────────────────────────────────────────────
  { path: 'extension.list', kind: 'invoke', channel: 'extension:list' },
  {
    path: 'extension.install',
    kind: 'invoke',
    channel: 'extension:install',
    toPayload: (directoryPath: string) => ({ directoryPath }),
  },
  {
    path: 'extension.toggle',
    kind: 'invoke',
    channel: 'extension:toggle',
    toPayload: (id: string, enabled: boolean) => ({ id, enabled }),
  },
  {
    path: 'extension.uninstall',
    kind: 'invoke',
    channel: 'extension:uninstall',
    toPayload: (id: string) => ({ id }),
  },
  {
    path: 'extension.reload',
    kind: 'invoke',
    channel: 'extension:reload',
    toPayload: (id: string) => ({ id }),
  },
  {
    path: 'extension.getSettingsSchemas',
    kind: 'invoke',
    channel: 'extension:get-settings-schemas',
  },
  { path: 'extension.getSettingsValues', kind: 'invoke', channel: 'extension:get-settings-values' },
  {
    path: 'extension.updateSetting',
    kind: 'invoke',
    channel: 'extension:update-setting',
    toPayload: (key: string, value: unknown) => ({ key, value }),
  },
  { path: 'extension.getSidebarItems', kind: 'invoke', channel: 'extension:get-sidebar-items' },
  {
    path: 'extension.getContextMenuItems',
    kind: 'invoke',
    channel: 'extension:get-context-menu-items',
    toPayload: (target: string) => ({ target }),
  },
  {
    path: 'extension.contextMenuClick',
    kind: 'send',
    channel: 'extension:context-menu-click',
    toPayload: (target: string, itemId: string, targetId: string) => ({ target, itemId, targetId }),
  },
  { path: 'extension.getCommands', kind: 'invoke', channel: 'extension:get-commands' },
  {
    path: 'extension.executeCommand',
    kind: 'send',
    channel: 'extension:execute-command',
    toPayload: (key: string) => ({ key }),
  },
  // Remote stub: WebContentsView positioning is an Electron-only concept.
  {
    path: 'extension.updatePanelBounds',
    kind: 'invoke',
    channel: 'extension:update-panel-bounds',
    remote: 'stub',
  },
  {
    path: 'extension.setBottomInset',
    kind: 'send',
    channel: 'extension:set-bottom-inset',
    toPayload: (inset: number) => ({ inset }),
    remote: 'omit',
  },

  // ── keyboard ──────────────────────────────────────────────────────────────
  // Local on both transports: native checks the reserved-shortcut set, remote
  // has no Electron accelerators so nothing is reserved.
  { path: 'keyboard.isReserved', kind: 'local' },

  // ── shell ─────────────────────────────────────────────────────────────────
  { path: 'shell.exec', kind: 'invoke', channel: 'shell:exec' },
  {
    path: 'shell.openPath',
    kind: 'invoke',
    channel: 'shell:open-path',
    toPayload: (filePath: string) => ({ filePath }),
  },
  // Remote stub: opens in a new browser tab instead of the host OS.
  {
    path: 'shell.openExternal',
    kind: 'invoke',
    channel: 'shell:open-external',
    toPayload: (url: string) => ({ url }),
    remote: 'stub',
  },

  // ── fs ────────────────────────────────────────────────────────────────────
  {
    path: 'fs.watchStart',
    kind: 'invoke',
    channel: 'fs:watch-start',
    toPayload: (projectRoot: string) => ({ projectRoot }),
  },
  { path: 'fs.watchStop', kind: 'invoke', channel: 'fs:watch-stop' },
  {
    path: 'fs.onChanged',
    kind: 'event',
    channel: 'fs:changed',
    toHandlerArgs: (args) => [args[0]],
  },
  {
    path: 'fs.readFile',
    kind: 'invoke',
    channel: 'fs:read-file',
    toPayload: (filePath: string) => ({ filePath }),
  },

  // ── extensionEvents ───────────────────────────────────────────────────────
  {
    path: 'extensionEvents.onTogglePanel',
    kind: 'event',
    channel: 'extension:toggle-panel',
    // Payload is the bare panelId string (see api.window.broadcast call sites).
    toHandlerArgs: (args) => [args[0]],
  },
  {
    path: 'extensionEvents.onSelectProjectTab',
    kind: 'event',
    channel: 'extension:select-project-tab',
    toHandlerArgs: (args) => [(args[0] as { tabId: string }).tabId],
  },
  {
    path: 'extensionEvents.onMenuOpenSettings',
    kind: 'event',
    channel: 'menu:open-settings',
    toHandlerArgs: () => [],
  },
  {
    path: 'extensionEvents.onMenuToggleSidebar',
    kind: 'event',
    channel: 'menu:toggle-sidebar',
    toHandlerArgs: () => [],
  },
  {
    path: 'extensionEvents.onMenuCloseTab',
    kind: 'event',
    channel: 'menu:close-tab',
    toHandlerArgs: () => [],
  },
  {
    path: 'extensionEvents.onMenuOpenAbout',
    kind: 'event',
    channel: 'menu:open-about',
    toHandlerArgs: () => [],
  },
  {
    path: 'extensionEvents.notifyPanelState',
    kind: 'send',
    channel: 'menu:set-panel-checked',
    toPayload: (panelId: string, open: boolean) => ({ panelId, open }),
    remote: 'omit',
  },
  {
    path: 'extensionEvents.onExtensionPanelLoaded',
    kind: 'event',
    channel: 'extension:panel-loaded',
    toHandlerArgs: (args) => [(args[0] as { id: string }).id],
    remote: 'omit',
  },
  {
    path: 'extensionEvents.onExtensionRendererReload',
    kind: 'event',
    channel: 'extension:renderer-reload',
    toHandlerArgs: (args) => [(args[0] as { id: string }).id],
    remote: 'omit',
  },

  // ── app ───────────────────────────────────────────────────────────────────
  { path: 'app.getInfo', kind: 'invoke', channel: 'app:get-info' },

  // ── extensionBridge ───────────────────────────────────────────────────────
  // Dynamic channel passthrough for extension-owned channels; each adapter
  // supplies its own transport-backed implementation.
  { path: 'extensionBridge.invoke', kind: 'local' },
  { path: 'extensionBridge.on', kind: 'local' },

  // ── notifications ─────────────────────────────────────────────────────────
  { path: 'notifications.create', kind: 'invoke', channel: 'notifications:create' },
  { path: 'notifications.list', kind: 'invoke', channel: 'notifications:list' },
  {
    path: 'notifications.dismiss',
    kind: 'invoke',
    channel: 'notifications:dismiss',
    toPayload: (id: string) => ({ id }),
  },
  {
    path: 'notifications.triggerAction',
    kind: 'invoke',
    channel: 'notifications:trigger-action',
    toPayload: (notifId: string, actionId: string) => ({ notifId, actionId }),
  },
  {
    path: 'notifications.onPush',
    kind: 'event',
    channel: 'notifications:push',
    toHandlerArgs: (args) => [args[0]],
  },

  // ── db ────────────────────────────────────────────────────────────────────
  { path: 'db.health', kind: 'invoke', channel: 'db:health', remote: 'omit' },

  // ── metrics ───────────────────────────────────────────────────────────────
  { path: 'metrics.getSystem', kind: 'invoke', channel: 'metrics:system' },
  {
    path: 'metrics.getProcesses',
    kind: 'invoke',
    channel: 'metrics:processes',
    toPayload: (pids: number[]) => ({ pids }),
  },
  {
    path: 'metrics.getPids',
    kind: 'invoke',
    channel: 'metrics:pids',
    toPayload: (sessionIds: string[]) => ({ sessionIds }),
  },

  // ── logger ────────────────────────────────────────────────────────────────
  {
    path: 'logger.write',
    kind: 'send',
    channel: 'log:write',
    toPayload: (level: string, namespace: string, message: string) => ({
      level,
      namespace,
      message,
    }),
  },

  // ── top-level ─────────────────────────────────────────────────────────────
  // Native: webUtils.getPathForFile. No remote equivalent.
  { path: 'getFilePath', kind: 'local', remote: 'omit' },

  // ── supervision ───────────────────────────────────────────────────────────
  // Read-only: runtime state is derived from observed agent activity, so the
  // renderer never asserts it — surfaces render what the substrate observed.
  //
  // `remote: 'omit'` deliberately. Supervision state carries transcript paths,
  // accrued cost, and live permission prompts; putting that on the remote
  // bridge is a decision to take on purpose, not to inherit by default.
  {
    path: 'supervision.listSessions',
    kind: 'invoke',
    channel: 'supervision:listSessions',
    remote: 'omit',
  },
  {
    path: 'supervision.getSession',
    kind: 'invoke',
    channel: 'supervision:getSession',
    toPayload: (sessionId: string) => ({ sessionId }),
    remote: 'omit',
  },
  {
    path: 'supervision.onStateChanged',
    kind: 'event',
    channel: 'supervision:stateChanged',
    remote: 'omit',
  },
  {
    path: 'supervision.resolvePermission',
    kind: 'invoke',
    channel: 'supervision:resolvePermission',
    remote: 'omit',
  },
  { path: 'supervision.listFeed', kind: 'invoke', channel: 'supervision:listFeed', remote: 'omit' },
  {
    path: 'supervision.listFirings',
    kind: 'invoke',
    channel: 'supervision:listFirings',
    remote: 'omit',
  },
  {
    path: 'supervision.listReview',
    kind: 'invoke',
    channel: 'supervision:listReview',
    remote: 'omit',
  },
  {
    path: 'supervision.listUnattendedMerges',
    kind: 'invoke',
    channel: 'supervision:listUnattendedMerges',
    remote: 'omit',
  },
  {
    path: 'supervision.listWorkItems',
    kind: 'invoke',
    channel: 'supervision:listWorkItems',
    remote: 'omit',
  },
  {
    path: 'supervision.replyToSession',
    kind: 'invoke',
    channel: 'supervision:replyToSession',
    remote: 'omit',
  },
  {
    path: 'supervision.setShadowMode',
    kind: 'invoke',
    channel: 'supervision:setShadowMode',
    remote: 'omit',
  },
  {
    path: 'supervision.judgeFiring',
    kind: 'invoke',
    channel: 'supervision:judgeFiring',
    remote: 'omit',
  },
  {
    path: 'supervision.openInEditor',
    kind: 'invoke',
    channel: 'supervision:openInEditor',
    remote: 'omit',
  },
  { path: 'supervision.archive', kind: 'invoke', channel: 'supervision:archive', remote: 'omit' },
  {
    path: 'supervision.provision',
    kind: 'invoke',
    channel: 'supervision:provision',
    remote: 'omit',
  },
  {
    path: 'supervision.getReviewDetail',
    kind: 'invoke',
    channel: 'supervision:getReviewDetail',
    remote: 'omit',
  },
  {
    path: 'supervision.decideHunk',
    kind: 'invoke',
    channel: 'supervision:decideHunk',
    remote: 'omit',
  },
  {
    path: 'supervision.advanceReview',
    kind: 'invoke',
    channel: 'supervision:advanceReview',
    remote: 'omit',
  },
  { path: 'supervision.getLanes', kind: 'invoke', channel: 'supervision:getLanes', remote: 'omit' },
  {
    path: 'supervision.mergeLane',
    kind: 'invoke',
    channel: 'supervision:mergeLane',
    remote: 'omit',
  },
  {
    path: 'supervision.getProvisioning',
    kind: 'invoke',
    channel: 'supervision:getProvisioning',
    remote: 'omit',
  },
  {
    path: 'supervision.getSinceLastLooked',
    kind: 'invoke',
    channel: 'supervision:getSinceLastLooked',
    remote: 'omit',
  },
  {
    path: 'supervision.precheckBackpressure',
    kind: 'invoke',
    channel: 'supervision:precheckBackpressure',
    remote: 'omit',
  },
  {
    path: 'supervision.entityIndex',
    kind: 'invoke',
    channel: 'supervision:entityIndex',
    remote: 'omit',
  },
  { path: 'supervision.intake', kind: 'invoke', channel: 'supervision:intake', remote: 'omit' },
  { path: 'supervision.assign', kind: 'invoke', channel: 'supervision:assign', remote: 'omit' },
]

/**
 * Core channels reachable through the remote bridge, derived from the manifest:
 * every channel whose remote behavior is 'same'. 'stub' and 'omit' channels are
 * excluded — they are either replaced in the remote adapter or absent from it.
 */
export function remoteAccessibleCoreChannels(): ReadonlySet<string> {
  const channels = new Set<string>()
  for (const spec of ELECTRON_API_MANIFEST) {
    if (spec.kind === 'local') continue
    if ((spec.remote ?? 'same') === 'same') channels.add(spec.channel!)
  }
  return channels
}
