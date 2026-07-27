import type { SessionEvent } from '../events/session-event.js'

// Translation from the agent runtime's shapes into the neutral SessionEvent
// union. Together with driver.ts, hooks.ts and transcript-tailer.ts this is the
// whole of what a runtime upgrade may touch (FR-002 to FR-004, SC-007).
//
// Nothing here imports the SDK's types: the runtime ships as 0.x and its type
// surface moves, so the seam reads the fields it needs structurally and
// tolerates the rest. Fields consumed here are documented in research.md R1/R3.

/** Tools whose calls can block for minutes and must be excluded from silence (FR-015). */
const SHELL_TOOLS = new Set(['Bash', 'BashOutput', 'KillShell'])

interface ResultLike {
  session_id?: unknown
  subtype?: unknown
  num_turns?: unknown
  total_cost_usd?: unknown
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/**
 * A terminal result message becomes a turn_finished (carrying the run's
 * accumulated cost and turns) followed by a session_ended.
 */
export function resultToSessionEvent(message: ResultLike, at: number): SessionEvent[] {
  const sessionId = str(message.session_id)
  if (sessionId === null) return []

  const subtype = str(message.subtype) ?? 'error_during_execution'
  const succeeded = subtype === 'success'

  return [
    {
      kind: 'turn_finished',
      sessionId,
      turns: num(message.num_turns, 0),
      costUsd: num(message.total_cost_usd, 0),
      // The runtime does not report remaining context on the result message.
      // Null means unknown, which is not the same as zero.
      contextPct: null,
      at,
    },
    {
      kind: 'session_ended',
      sessionId,
      outcome: succeeded ? 'success' : 'error',
      ...(succeeded ? {} : { reason: subtype }),
      at,
    },
  ]
}

interface HookLike {
  hook_event_name?: unknown
  session_id?: unknown
  transcript_path?: unknown
  cwd?: unknown
  tool_name?: unknown
  tool_use_id?: unknown
}

let syntheticCallId = 0

export function hookToSessionEvent(input: unknown, at: number): SessionEvent | null {
  if (typeof input !== 'object' || input === null) return null
  const hook = input as HookLike

  const sessionId = str(hook.session_id)
  const eventName = str(hook.hook_event_name)
  if (sessionId === null || eventName === null) return null

  switch (eventName) {
    case 'SessionStart': {
      const transcriptPath = str(hook.transcript_path)
      const cwd = str(hook.cwd)
      if (transcriptPath === null || cwd === null) return null
      return { kind: 'session_started', sessionId, transcriptPath, cwd, at }
    }

    case 'PreToolUse': {
      const toolName = str(hook.tool_name) ?? 'unknown'
      return {
        kind: 'tool_started',
        sessionId,
        toolName,
        // Pairing is what makes the long-command exemption work, so a missing
        // id is synthesised rather than dropped.
        callId: str(hook.tool_use_id) ?? `synthetic-${++syntheticCallId}`,
        isShell: SHELL_TOOLS.has(toolName),
        at,
      }
    }

    case 'PostToolUse':
      return {
        kind: 'tool_finished',
        sessionId,
        callId: str(hook.tool_use_id) ?? `synthetic-${syntheticCallId}`,
        ok: true,
        at,
      }

    default:
      // Every other hook event is real, but carries no supervision meaning.
      return null
  }
}
