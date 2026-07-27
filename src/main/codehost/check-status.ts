import type { CheckState } from '../supervision/review/risk-grader.js'

// Core's own view of automated check results.
//
// Core owns this rather than reading it from the git-integration extension:
// FR-065 forbids core depending on an extension, and FR-062 makes unattended
// merge safety turn on check state — a safety property must not be contingent
// on whether an extension happens to be installed (ADR 029).
//
// The whole module has one rule: when we cannot actually tell, the answer is
// `unavailable`. Never `passing`. Every failure path below leads there, and a
// test asserts that none of them can produce `passing`.

export interface CommandResult {
  ok: boolean
  stdout: string
  stderr: string
}

export type RunCommand = (
  command: string,
  args: readonly string[],
  cwd: string
) => Promise<CommandResult>

interface CheckRow {
  state?: unknown
}

const FAILING_STATES = new Set(['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED'])
const PENDING_STATES = new Set(['PENDING', 'QUEUED', 'IN_PROGRESS', 'WAITING', 'REQUESTED'])
const PASSING_STATES = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED'])

export async function resolveCheckState(
  repoPath: string,
  branch: string,
  run: RunCommand
): Promise<CheckState> {
  let result: CommandResult
  try {
    result = await run('gh', ['pr', 'checks', branch, '--json', 'state'], repoPath)
  } catch {
    // gh absent, host unreachable, process killed — all indistinguishable from
    // here, and all mean the same thing: we do not know.
    return 'unavailable'
  }

  // Covers "not authenticated", "no pull request for this branch", and any
  // other non-zero exit.
  if (!result.ok) return 'unavailable'

  let rows: unknown
  try {
    rows = JSON.parse(result.stdout)
  } catch {
    return 'unavailable'
  }

  if (!Array.isArray(rows)) return 'unavailable'
  // No checks configured tells us nothing about whether the change is safe, so
  // it must not read as success.
  if (rows.length === 0) return 'unavailable'

  const states = (rows as CheckRow[]).map((row) =>
    typeof row.state === 'string' ? row.state.toUpperCase() : ''
  )

  // Worst news first: a failure matters more than something still running.
  if (states.some((state) => FAILING_STATES.has(state))) return 'failing'
  if (states.some((state) => PENDING_STATES.has(state))) return 'pending'
  if (states.every((state) => PASSING_STATES.has(state))) return 'passing'

  // A state we do not recognise is not a state we may call green.
  return 'unavailable'
}
