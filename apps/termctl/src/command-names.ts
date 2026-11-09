import type { JsonSchema } from './flags.js'

export interface ToolInfo {
  name: string
  description?: string
  inputSchema: JsonSchema
  annotations?: { destructiveHint?: boolean }
}

export interface CommandName {
  group: string
  /** Null for a tool the rule and the table cannot map: it runs under its raw name. */
  verb: string | null
}

export interface Command extends CommandName {
  tool: ToolInfo
}

// The tools whose names do not start with their verb, or whose noun reads badly in singular.
const OVERRIDES: Record<string, CommandName> = {
  is_git_repo: { group: 'git', verb: 'is-repo' },
  current_branch: { group: 'branch', verb: 'current' },
  git_checkout: { group: 'git', verb: 'checkout' },
  git_fetch: { group: 'git', verb: 'fetch' },
  git_change_stats: { group: 'git', verb: 'change-stats' },
  alert: { group: 'alert', verb: 'send' },
  agent_history: { group: 'agent', verb: 'history' },
  close_all_terminals: { group: 'terminal', verb: 'close-all' },
  open_in_editor: { group: 'editor', verb: 'open' },
  open_in_window: { group: 'window', verb: 'open' },
  comment_on_issue: { group: 'issue', verb: 'comment' },
  check_for_update: { group: 'update', verb: 'check' },
  run_schedule_now: { group: 'schedule', verb: 'run-now' },
  move_session_here: { group: 'session', verb: 'move-here' },
  run_destructive_quick_action: { group: 'quick-action', verb: 'run-destructive' },
  run_destructive_extension_command: { group: 'extension-command', verb: 'run-destructive' },
}

/** `list_tasks` → `task list`: the first word is the verb, the rest is the noun in singular. */
export function commandName(toolName: string): CommandName {
  const override = OVERRIDES[toolName]
  if (override) return override
  const [verb, ...noun] = toolName.split('_')
  if (noun.length === 0) return { group: toolName, verb: null }
  noun[noun.length - 1] = singular(noun[noun.length - 1])
  return { group: noun.join('-'), verb }
}

function singular(word: string): string {
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (/(ch|sh|ss|x)es$/.test(word)) return word.slice(0, -2)
  if (/(ss|us)$/.test(word)) return word
  return word.endsWith('s') ? word.slice(0, -1) : word
}

export function toCommands(tools: ToolInfo[]): Command[] {
  return tools.map((tool) => ({ ...commandName(tool.name), tool }))
}
