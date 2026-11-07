import { describe, it, expect } from 'vitest'
import { ELECTRON_API_MANIFEST, mcpToolSpecs, remoteAccessibleCoreChannels } from '../manifest.js'

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
    const kindsByChannel = new Map<string, Set<string>>()
    for (const spec of ELECTRON_API_MANIFEST) {
      if (!spec.channel) continue
      kindsByChannel.set(
        spec.channel,
        (kindsByChannel.get(spec.channel) ?? new Set()).add(spec.kind)
      )
    }
    const mixed = [...kindsByChannel]
      .filter(([, kinds]) => kinds.size > 1)
      .map(([channel]) => channel)
    expect(mixed).toEqual([])
  })
})

// The complete expected remote surface for core channels. Deliberately spelled
// out: widening or shrinking what a browser client can reach must show up as a
// diff in this test, even though the runtime set is derived from the manifest.
const EXPECTED_REMOTE_CHANNELS = [
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
  'git:fetch',
  'git:change-stats',
  'git:checkout',
  'git:create-branch',
  'git:create-worktree',
  'git:list-worktrees',
  'git:remove-worktree',
  'git:suggest-worktree-path',
  'extension:list',
  'extension:list-changed',
  'extension:install',
  'extension:uninstall',
  'extension:toggle',
  'extension:reload',
  'extension:update-setting',
  'extension:update-workspace-setting',
  'extension:get-commands',
  'extension:get-settings-schemas',
  'extension:get-settings-values',
  'extension:execute-command',
  'metrics:system',
  'metrics:processes',
  'metrics:pids',
  'notifications:list',
  'notifications:create',
  'notifications:dismiss',
  'notifications:trigger-action',
  'fs:read-file',
  'shell:exec',
  'shell:open-path',
  'log:write',
  // Push-event channels the /app/ shim subscribes to. These were silently
  // rejected before the manifest existed (the old hand-written allowlist
  // missed them), so remote /app/ never received these pushes.
  'notifications:push',
  'extension:toggle-panel',
  'extension:select-project-tab',
  'menu:open-settings',
  'menu:open-home',
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
  // Session descriptions and session-level work items. The remote /app/ runs
  // the same Home and Overview, so it reads and writes the same records.
  'session-records:list',
  'session-records:set-description',
  'session-records:set-link',
  'session-records:transfer',
  'session-records:forget',
  'session-records:changed',
]

const INTERNAL_ONLY_CHANNELS = [
  // A file watch reports to the desktop view that asked for it (ADR 109).
  'fs:watch-start',
  'fs:watch-stop',
  'fs:changed',
  'dialog:open-directory',
  'shell:open-external',
  'extension:update-panel-bounds',
  'extension:set-bottom-inset',
  'workspace:get-active',
  'workspace:active-changed',
  'db:health',
  'menu:set-panel-checked',
  'menu:toggle-breakout',
  'menu:open-task-switcher',
  'menu:switch-lane',
  'breakout:closed',
  'workspace:project-added',
  'workspace:project-removed',
  'extension:panel-loaded',
  'extension:renderer-reload',
]

describe('remoteAccessibleCoreChannels()', () => {
  it('derives exactly the expected remote surface', () => {
    const derived = remoteAccessibleCoreChannels()
    expect([...derived].sort()).toEqual([...EXPECTED_REMOTE_CHANNELS].sort())
  })

  it('never exposes credential writes to the remote bridge', () => {
    // A LAN-reachable surface has no business storing or destroying the
    // operator's tracker credentials, however well authenticated it is.
    const derived = remoteAccessibleCoreChannels()
    expect(derived.has('integrations:connect')).toBe(false)
    expect(derived.has('integrations:disconnect')).toBe(false)
  })

  it('keeps the Claude Code registration off the remote bridge', () => {
    // A LAN-reachable surface must not change what every Claude session on this Mac can call.
    const channels = ELECTRON_API_MANIFEST.map((spec) => spec.channel)
    const derived = remoteAccessibleCoreChannels()
    for (const channel of ['claude-code:status', 'claude-code:connect', 'claude-code:disconnect']) {
      expect(channels).toContain(channel)
      expect(derived.has(channel)).toBe(false)
    }
  })

  it('keeps internal-only channels unreachable (default-deny holds)', () => {
    const derived = remoteAccessibleCoreChannels()
    for (const internal of INTERNAL_ONLY_CHANNELS) {
      expect(derived.has(internal), `${internal} must not be remote-accessible`).toBe(false)
    }
  })
})

// The Terminator MCP server's manifest tools. Pinned like the remote surface: a new
// tool, or a tool that loses its destructive mark, is a deliberate change to this list.
const EXPECTED_MCP_TOOLS = [
  'add_task_lane',
  'agent_history',
  'answer_agent',
  'archive_task',
  'cancel_agent_turn',
  'close_agent',
  'close_all_terminals',
  'close_terminal',
  'comment_on_issue',
  'create_branch',
  'create_project',
  'create_schedule',
  'create_task',
  'create_workspace',
  'create_worktree',
  'current_branch',
  'delete_project',
  'delete_schedule',
  'delete_task',
  'delete_workspace',
  'detect_editors',
  'dismiss_notification',
  'forget_session_record',
  'get_agent_usage',
  'get_app_info',
  'get_extension_settings',
  'get_extension_settings_schemas',
  'get_global_settings',
  'get_home_feed',
  'get_integration_status',
  'get_issue',
  'get_issue_link',
  'get_process_metrics',
  'get_system_metrics',
  'get_thread_summary',
  'get_workspace_settings',
  'git_change_stats',
  'git_checkout',
  'git_fetch',
  'install_extension',
  'is_git_repo',
  'link_issue',
  'list_agent_asks',
  'list_agent_turns',
  'list_agents',
  'list_branches',
  'list_extension_commands',
  'list_extensions',
  'list_known_agents',
  'list_my_issues',
  'list_notifications',
  'list_open_agent_asks',
  'list_projects',
  'list_schedules',
  'list_session_records',
  'list_tasks',
  'list_terminal_sessions',
  'list_workspaces',
  'list_worktrees',
  'merge_task',
  'open_in_editor',
  'open_path',
  'pause_schedule',
  'preview_issue_context',
  'prompt_agent',
  'reload_extension',
  'remove_task_lane',
  'remove_worktree',
  'rename_project',
  'reorder_projects',
  'reorder_workspaces',
  'run_home_feed_action',
  'run_schedule_now',
  'search_issues',
  'set_inject_issue_context',
  'set_my_issues_filter',
  'set_session_description',
  'set_session_link',
  'start_agent',
  'steer_agent',
  'suggest_branch_name',
  'suggest_worktree_path',
  'toggle_extension',
  'trigger_notification_action',
  'uninstall_extension',
  'unlink_issue',
  'update_extension_setting',
  'update_extension_workspace_setting',
  'update_global_settings',
  'update_project_branch',
  'update_schedule',
  'update_task',
  'update_workspace',
  'update_workspace_settings',
]

const EXPECTED_DESTRUCTIVE_MCP_TOOLS = [
  'close_agent',
  'close_all_terminals',
  'close_terminal',
  'delete_project',
  'delete_schedule',
  'delete_task',
  'delete_workspace',
  'forget_session_record',
  'git_checkout',
  'remove_task_lane',
  'remove_worktree',
  'uninstall_extension',
]

describe('mcpToolSpecs()', () => {
  it('derives exactly the expected tool list', () => {
    const tools = mcpToolSpecs().map((spec) => spec.tool)
    expect(tools.sort()).toEqual(EXPECTED_MCP_TOOLS)
  })

  it('marks exactly the expected tools destructive', () => {
    const destructive = mcpToolSpecs().filter((spec) => spec.destructive)
    expect(destructive.map((spec) => spec.tool).sort()).toEqual(EXPECTED_DESTRUCTIVE_MCP_TOOLS)
  })

  it('never marks a tool both destructive and read-only', () => {
    const both = mcpToolSpecs().filter((spec) => spec.destructive && spec.readOnly)
    expect(both.map((spec) => spec.tool)).toEqual([])
  })

  it('gives every tool a unique snake_case name and a description', () => {
    const specs = mcpToolSpecs()
    expect(new Set(specs.map((spec) => spec.tool)).size).toBe(specs.length)
    for (const spec of specs) {
      expect(spec.tool).toMatch(/^[a-z]+(_[a-z]+)*$/)
      expect(spec.description).not.toBe('')
    }
  })
})

describe('mcpToolSpecs() — what reaches the tool list', () => {
  it('names the channel each tool calls', () => {
    const listWorkspaces = mcpToolSpecs().find((spec) => spec.tool === 'list_workspaces')
    expect(listWorkspaces).toMatchObject({ channel: 'workspace:list', readOnly: true })
  })

  it('makes every invoke method decide: a tool, or mcp: false', () => {
    const undecided = ELECTRON_API_MANIFEST.filter(
      (spec) => spec.kind === 'invoke' && !('mcp' in spec)
    )
    expect(undecided.map((spec) => spec.path)).toEqual([])
  })

  it('never exposes credential writes as tools', () => {
    const channels = new Set(mcpToolSpecs().map((spec) => spec.channel))
    expect(channels.has('integrations:connect')).toBe(false)
    expect(channels.has('integrations:disconnect')).toBe(false)
  })
})
