import type { AutonomyLevel } from '../../../shared/types/supervision.js'
import type { PermissionDecision } from '../agent-runtime/permission-bridge.js'

// The autonomy ladder. Chosen once, when the agent is assigned, rather than
// renegotiated at every interrupt (FR-041) — the operator decides how much
// rope up front, not under time pressure with a prompt in front of them.
//
// Returning null means "abstain": the request goes to the operator. Only an
// explicit allow skips the prompt, so anything unrecognised is safe by default.

export interface AutonomyContext {
  readonly worktreePath: string
  readonly allowedHosts: readonly string[]
}

const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'NotebookRead', 'WebSearch'])
const WRITE_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit', 'MultiEdit'])
const SHELL_TOOLS = new Set(['Bash', 'BashOutput'])

/** Never auto-approved, at any level. */
const DESTRUCTIVE = [
  /\brm\s+-[rf]/i,
  /\bgit\s+push\s+.*--force/i,
  /--force-with-lease/i,
  /\bDROP\s+(TABLE|DATABASE|SCHEMA)/i,
  /\bTRUNCATE\b/i,
  /\bkubectl\s+delete/i,
  /\bterraform\s+(destroy|apply)/i,
  /\bmkfs\b|\bdd\s+if=/i,
]

/** Local build and test work — safe at `build` and above. */
const LOCAL_BUILD = [
  /^(npm|pnpm|yarn|bun)\s+(ci|install|i|add|run|test|exec)\b/i,
  /^npx\s+/i,
  /^(make|cargo|go|mvn|gradle|poetry|uv|pip)\s+/i,
  /^(vitest|jest|eslint|prettier|tsc)\b/i,
]

const PUSH = [/^git\s+push\b/i, /^gh\s+pr\s+create\b/i, /^gh\s+pr\s+/i]

const LEVEL_RANK: Record<AutonomyLevel, number> = { read: 0, edit: 1, build: 2, ship: 3 }

function stringField(input: unknown, keys: string[]): string | null {
  if (typeof input !== 'object' || input === null) return null
  const record = input as Record<string, unknown>
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return null
}

/** Any host the request reaches for, whether via a URL or a `-h` style flag. */
function targetHost(input: unknown): string | null {
  const url = stringField(input, ['url'])
  if (url !== null) {
    try {
      return new URL(url).hostname
    } catch {
      return null
    }
  }
  const command = stringField(input, ['command'])
  return command?.match(/-h\s+([A-Za-z0-9._-]+)/)?.[1] ?? null
}

const ALLOW: PermissionDecision = { allow: true }

export function decideAutonomy(
  level: AutonomyLevel,
  toolName: string,
  input: unknown,
  context: AutonomyContext
): PermissionDecision | null {
  const rank = LEVEL_RANK[level]

  // Checked before anything else, and it overrides every level: reaching a host
  // nobody declared is exactly the `redis-cli -h prod-cache-01` case (FR-042).
  const host = targetHost(input)
  if (host !== null && !context.allowedHosts.includes(host)) return null

  const command = stringField(input, ['command'])
  if (command !== null && DESTRUCTIVE.some((pattern) => pattern.test(command))) return null

  if (READ_TOOLS.has(toolName)) return ALLOW

  if (WRITE_TOOLS.has(toolName)) {
    if (rank < LEVEL_RANK.edit) return null
    const path = stringField(input, ['file_path', 'path', 'notebook_path'])
    // Confined to the working copy: editing the operator's primary checkout is
    // not what any level of this ladder authorises.
    return path !== null && path.startsWith(context.worktreePath) ? ALLOW : null
  }

  if (SHELL_TOOLS.has(toolName) && command !== null) {
    if (rank >= LEVEL_RANK.ship && PUSH.some((pattern) => pattern.test(command))) return ALLOW
    if (rank >= LEVEL_RANK.build && LOCAL_BUILD.some((pattern) => pattern.test(command))) {
      // A build command that reaches outside the working copy is not local work.
      return /\s\/(?!wt\b)[A-Za-z]/.test(command) ? null : ALLOW
    }
    return null
  }

  if (host !== null && context.allowedHosts.includes(host)) return ALLOW

  // Unrecognised tool: abstain. Safe by default beats clever by default.
  return null
}
