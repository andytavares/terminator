// The single source of truth for which IPC channels the remote-control bridge
// (the browser `/app/` full-renderer surface) is permitted to reach.
//
// WHY a central set instead of per-call-site `{ remoteAccessible: true }` flags:
// the prior remediation scattered the opt-in across 50+ `ipcMain.handle` sites,
// none were actually applied, and the whole `/app/` feature silently broke with
// no single place to audit the remote attack surface. This set IS the remote
// attack surface — review it here, in one place. `remote-accessible-channels.spec.ts`
// asserts every channel the `electron-api-shim` actually uses is present, so the
// enforcement mechanism and the allowlist can never half-ship independently again.
//
// Default-deny: any channel NOT in this set is rejected by the bridge. Internal
// channels (e.g. `dialog:open-directory`, `remote:*` server controls) are absent
// by design and stay unreachable from the browser.
//
// SECURITY NOTE: `shell:exec` is intentionally included. The `/app/` surface is the
// full Electron renderer served behind password + single-use ticket + session cookie
// + failed-auth rate limiting, on a `0.0.0.0`-bound server (LAN/ngrok). `shell:exec`
// remains sandboxed (allowlist git/gh only, cwd-pinned, shell:false) — see ADR-006.
// The accepted residual risk (an authenticated remote client can run git/gh as the
// user) is documented in ADR-017.

export const REMOTE_ACCESSIBLE_CHANNELS: ReadonlySet<string> = new Set<string>([
  // App metadata
  'app:get-info',

  // Terminal lifecycle (invoke) + I/O (send) + output (subscribe)
  'terminal:create',
  'terminal:close',
  'terminal:close-all',
  'terminal:cleanup-orphans',
  'terminal:input',
  'terminal:resize',
  'terminal:output',
  'terminal:process-exit',

  // Workspaces
  'workspace:list',
  'workspace:create',
  'workspace:update',
  'workspace:delete',
  'workspace:reorder',

  // Projects
  'project:list',
  'project:create',
  'project:delete',
  'project:rename',
  'project:reorder',
  'project:update-branch',

  // Settings
  'settings:get-global',
  'settings:get-workspace',
  'settings:update-global',
  'settings:update-workspace',

  // Git (read + worktree/branch ops the git-integration extension drives)
  'git:is-repo',
  'git:current-branch',
  'git:list-branches',
  'git:checkout',
  'git:create-branch',
  'git:create-worktree',
  'git:list-worktrees',
  'git:remove-worktree',
  'git:suggest-worktree-path',

  // Extensions
  'extension:list',
  'extension:install',
  'extension:uninstall',
  'extension:toggle',
  'extension:reload',
  'extension:update-setting',
  'extension:get-commands',
  'extension:get-context-menu-items',
  'extension:get-settings-schemas',
  'extension:get-settings-values',
  'extension:get-sidebar-items',
  'extension:context-menu-click',
  'extension:execute-command',

  // Metrics
  'metrics:system',
  'metrics:processes',
  'metrics:pids',

  // Notifications
  'notifications:list',
  'notifications:create',
  'notifications:dismiss',
  'notifications:trigger-action',

  // Filesystem (scoped reads + watch)
  'fs:read-file',
  'fs:watch-start',
  'fs:watch-stop',

  // Shell (sandboxed git/gh executor + open-path) — see SECURITY NOTE above
  'shell:exec',
  'shell:open-path',

  // Logging (renderer → main forwarding)
  'log:write',
])
