import { describe, it, expect } from 'vitest'
import { ELECTRON_API_MANIFEST, remoteAccessibleCoreChannels } from '../manifest.js'

describe('ELECTRON_API_MANIFEST', () => {
  it('has a unique path per method', () => {
    const paths = ELECTRON_API_MANIFEST.map((s) => s.path)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('declares a channel on every non-local spec', () => {
    const missing = ELECTRON_API_MANIFEST.filter((s) => s.kind !== 'local' && !s.channel)
    expect(missing.map((s) => s.path)).toEqual([])
  })

  it('declares no channel on local specs', () => {
    const withChannel = ELECTRON_API_MANIFEST.filter((s) => s.kind === 'local' && s.channel)
    expect(withChannel.map((s) => s.path)).toEqual([])
  })

  it('never maps one channel to two different kinds', () => {
    const kindByChannel = new Map<string, string>()
    for (const spec of ELECTRON_API_MANIFEST) {
      if (!spec.channel) continue
      const seen = kindByChannel.get(spec.channel)
      if (seen) expect(`${spec.channel}: ${seen}`).toBe(`${spec.channel}: ${spec.kind}`)
      kindByChannel.set(spec.channel, spec.kind)
    }
  })
})

describe('remoteAccessibleCoreChannels()', () => {
  // The complete expected remote surface for core channels. Deliberately spelled
  // out: widening or shrinking what a browser client can reach must show up as a
  // diff in this test, even though the runtime set is derived from the manifest.
  const EXPECTED = [
    'app:get-info',
    'terminal:create',
    'terminal:attach',
    'terminal:close',
    'terminal:close-all',
    'terminal:cleanup-orphans',
    'terminal:input',
    'terminal:resize',
    'terminal:output',
    'terminal:process-exit',
    'workspace:list',
    'workspace:create',
    'workspace:update',
    'workspace:delete',
    'workspace:reorder',
    'project:list',
    'project:create',
    'project:delete',
    'project:rename',
    'project:reorder',
    'project:update-branch',
    'settings:get-global',
    'settings:get-workspace',
    'settings:update-global',
    'settings:update-workspace',
    'git:is-repo',
    'git:current-branch',
    'git:list-branches',
    'git:checkout',
    'git:create-branch',
    'git:create-worktree',
    'git:list-worktrees',
    'git:remove-worktree',
    'git:suggest-worktree-path',
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
    'extension:sidebar-item-click',
    'extension:context-menu-click',
    'extension:execute-command',
    'metrics:system',
    'metrics:processes',
    'metrics:pids',
    'notifications:list',
    'notifications:create',
    'notifications:dismiss',
    'notifications:trigger-action',
    'fs:read-file',
    'fs:watch-start',
    'fs:watch-stop',
    'shell:exec',
    'shell:open-path',
    'log:write',
    // Push-event channels the /app/ shim subscribes to. These were silently
    // rejected before the manifest existed (the old hand-written allowlist
    // missed them), so remote /app/ never received these pushes.
    'fs:changed',
    'notifications:push',
    'extension:toggle-panel',
    'extension:select-project-tab',
    'menu:open-settings',
    'menu:toggle-sidebar',
    'menu:close-tab',
    'menu:open-about',
    // Issue-tracker integrations. Everything the remote surface needs to read
    // and attach issues — but note connect/disconnect are deliberately absent
    // below, and asserted absent in their own test.
    'integrations:status',
    'integrations:set-mine',
    'integrations:issue-list-mine',
    'integrations:issue-search',
    'integrations:issue-get',
    'integrations:issue-comment',
    'integrations:link-set',
    'integrations:link-get',
    'integrations:link-clear',
    'integrations:context-preview',
    'integrations:set-inject-context',
    'integrations:status-changed',
    'integrations:link-changed',
    'integrations:context-injected',
  ]

  it('derives exactly the expected remote surface', () => {
    const derived = remoteAccessibleCoreChannels()
    expect([...derived].sort()).toEqual([...EXPECTED].sort())
  })

  it('never exposes credential writes to the remote bridge', () => {
    // A LAN-reachable surface has no business storing or destroying the
    // operator's tracker credentials, however well authenticated it is.
    const derived = remoteAccessibleCoreChannels()
    expect(derived.has('integrations:connect')).toBe(false)
    expect(derived.has('integrations:disconnect')).toBe(false)
  })

  it('keeps internal-only channels unreachable (default-deny holds)', () => {
    const derived = remoteAccessibleCoreChannels()
    for (const internal of [
      'dialog:open-directory',
      'shell:open-external',
      'extension:update-panel-bounds',
      'extension:set-bottom-inset',
      'workspace:get-active',
      'db:health',
      'menu:set-panel-checked',
      'workspace:project-added',
      'workspace:project-removed',
      'extension:panel-loaded',
      'extension:renderer-reload',
    ]) {
      expect(derived.has(internal), `${internal} must not be remote-accessible`).toBe(false)
    }
  })
})
