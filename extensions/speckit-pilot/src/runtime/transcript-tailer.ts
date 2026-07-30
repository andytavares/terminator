import { closeSync, openSync, readFileSync, readSync, statSync } from 'fs'

/**
 * What the agent has been doing, read from its own record.
 *
 * Declared here rather than shared with the application: the transcript's
 * per-line shape is not a published contract, so anything parsing it is
 * coupled to the runtime and belongs behind this boundary.
 */
export interface ToolActivity {
  readonly kind: 'tool_started' | 'tool_finished'
  readonly toolName: string
  readonly callId: string
  /** A shell call in flight is never silence, however long it runs. */
  readonly isShell: boolean
  /**
   * The file the call touched, when it names one.
   *
   * What the loop signal is made of: eight tool calls against one file is a
   * different failure from going quiet, and without this the signal had
   * nothing to count.
   */
  readonly path: string | null
  readonly at: number
}

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
  input?: unknown
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

function eventsFromEntry(entry: Record<string, unknown>): ToolActivity[] {
  const at = epochOf(entry)
  if (at === null) return []

  const events: ToolActivity[] = []
  for (const block of blocksOf(entry)) {
    if (block.type === 'tool_use') {
      const callId = typeof block.id === 'string' ? block.id : null
      // Without an id the call can never be paired with its result, so the
      // long-command exemption could not close it. Better to skip it.
      if (callId === null) continue
      const toolName = typeof block.name === 'string' ? block.name : 'unknown'
      const input = block.input
      const named =
        typeof input === 'object' && input !== null
          ? ((input as Record<string, unknown>).file_path ??
            (input as Record<string, unknown>).notebook_path)
          : null
      events.push({
        kind: 'tool_started',
        toolName,
        callId,
        isShell: SHELL_TOOLS.has(toolName),
        path: typeof named === 'string' ? named : null,
        at,
      })
    } else if (block.type === 'tool_result') {
      const callId = typeof block.tool_use_id === 'string' ? block.tool_use_id : null
      if (callId === null) continue
      events.push({ kind: 'tool_finished', toolName: '', callId, isShell: false, path: null, at })
    }
  }
  return events
}

/**
 * Reads the whole transcript and returns the supervision-relevant events in it.
 * Cheap enough to re-read: a session's transcript is bounded by its own run.
 */
/**
 * How much of the tail to read.
 *
 * The stall detector asks what happened recently; it has never needed the
 * beginning. Reading the whole file put an unbounded synchronous read on the
 * main thread every thirty seconds per run, and a multi-hour transcript is not
 * small.
 */
const MAX_TAIL_BYTES = 256 * 1024

/**
 * The tail of the file, as whole lines.
 *
 * Null when there is nothing to read. Reading from an offset lands mid-line, so
 * the first fragment is dropped — it is not JSON, and it is not a torn write
 * worth reporting.
 */
function tailLines(transcriptPath: string): string[] | null {
  try {
    const stat = statSync(transcriptPath)
    if (!stat.isFile()) return null
    if (stat.size <= MAX_TAIL_BYTES) return readFileSync(transcriptPath, 'utf-8').split('\n')

    const handle = openSync(transcriptPath, 'r')
    try {
      const buffer = Buffer.alloc(MAX_TAIL_BYTES)
      const read = readSync(handle, buffer, 0, MAX_TAIL_BYTES, stat.size - MAX_TAIL_BYTES)
      const lines = buffer.subarray(0, read).toString('utf-8').split('\n')
      lines.shift()
      return lines
    } finally {
      closeSync(handle)
    }
  } catch {
    // Not written yet, removed, or not a file. None of those is an error the
    // operator needs to see — the session simply has no durable record yet.
    return null
  }
}

export function readTranscript(transcriptPath: string): ToolActivity[] {
  const lines = tailLines(transcriptPath)
  if (lines === null) return []

  const events: ToolActivity[] = []
  for (const line of lines) {
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
    events.push(...eventsFromEntry(entry as Record<string, unknown>))
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
/**
 * How many turns the agent has taken.
 *
 * Counted over the tail, like everything else here: the number is shown on a
 * card and used to decide a turn ended, and neither is worth an unbounded
 * synchronous read of a multi-hour transcript on the main thread. A run past
 * the bound under-reports rather than freezing the window.
 */
export function countTurns(transcriptPath: string): number {
  const lines = tailLines(transcriptPath)
  if (lines === null) return 0

  let turns = 0
  for (const line of lines) {
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
