import { readFileSync, statSync } from 'fs'
import type { SessionEvent } from '../events/session-event.js'

// Reads the agent's own durable activity record. This is what keeps a session's
// state current when the driver process is gone (FR-006) and what lets state be
// rebuilt after a console restart (FR-009).
//
// The path always comes from hook input and is never computed (research.md R3).
// The per-line JSONL schema is not a published contract, so every line is read
// defensively: pull the handful of fields we need, ignore everything else, and
// never fail a session because one line did not parse.

const SHELL_TOOLS = new Set(['Bash', 'BashOutput', 'KillShell'])

interface ToolUseBlock {
  type?: unknown
  id?: unknown
  name?: unknown
  tool_use_id?: unknown
}

function blocksOf(entry: Record<string, unknown>): ToolUseBlock[] {
  const message = entry.message
  if (typeof message !== 'object' || message === null) return []
  const content = (message as Record<string, unknown>).content
  return Array.isArray(content) ? (content as ToolUseBlock[]) : []
}

function epochOf(entry: Record<string, unknown>): number | null {
  const raw = entry.timestamp
  if (typeof raw !== 'string') return null
  const parsed = Date.parse(raw)
  return Number.isNaN(parsed) ? null : parsed
}

function eventsFromEntry(sessionId: string, entry: Record<string, unknown>): SessionEvent[] {
  const at = epochOf(entry)
  if (at === null) return []

  const events: SessionEvent[] = []
  for (const block of blocksOf(entry)) {
    if (block.type === 'tool_use') {
      const callId = typeof block.id === 'string' ? block.id : null
      // Without an id the call can never be paired with its result, so the
      // long-command exemption could not close it. Better to skip it.
      if (callId === null) continue
      const toolName = typeof block.name === 'string' ? block.name : 'unknown'
      events.push({
        kind: 'tool_started',
        sessionId,
        toolName,
        callId,
        isShell: SHELL_TOOLS.has(toolName),
        at,
      })
    } else if (block.type === 'tool_result') {
      const callId = typeof block.tool_use_id === 'string' ? block.tool_use_id : null
      if (callId === null) continue
      events.push({ kind: 'tool_finished', sessionId, callId, ok: true, at })
    }
  }
  return events
}

/**
 * Reads the whole transcript and returns the supervision-relevant events in it.
 * Cheap enough to re-read: a session's transcript is bounded by its own run.
 */
export function readTranscript(sessionId: string, transcriptPath: string): SessionEvent[] {
  let raw: string
  try {
    if (!statSync(transcriptPath).isFile()) return []
    raw = readFileSync(transcriptPath, 'utf-8')
  } catch {
    // Not written yet, removed, or not a file. None of those is an error the
    // operator needs to see — the session simply has no durable record yet.
    return []
  }

  const events: SessionEvent[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    let entry: unknown
    try {
      entry = JSON.parse(trimmed)
    } catch {
      // Torn or corrupt line — skip it, keep reading.
      continue
    }
    if (typeof entry !== 'object' || entry === null) continue
    events.push(...eventsFromEntry(sessionId, entry as Record<string, unknown>))
  }
  return events
}

/**
 * How many turns the agent has taken, counted from its own record.
 *
 * Under an in-process runtime this arrived in a `result` message along with
 * the cost and the context window. A terminal has no such message, and the
 * transcript carries neither cost nor context — so this is what is honestly
 * available, and the surfaces say nothing rather than showing a confident
 * $0.00 that means "not measured".
 */
export function countTurns(transcriptPath: string): number {
  let raw: string
  try {
    if (!statSync(transcriptPath).isFile()) return 0
    raw = readFileSync(transcriptPath, 'utf-8')
  } catch {
    return 0
  }

  let turns = 0
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    try {
      const entry = JSON.parse(trimmed) as { type?: unknown; isSidechain?: unknown }
      // A sidechain is a subagent's own conversation, not a turn of this one.
      if (entry.type === 'assistant' && entry.isSidechain !== true) turns += 1
    } catch {
      // Torn or corrupt line — skip it, keep counting.
    }
  }
  return turns
}
