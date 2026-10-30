import { tailLines } from './transcript-tailer.js'

// The tail of a run's conversation, in the words it was written in.
//
// "Show me the transcript" is the first of the four things you want when a run
// stops making progress, and it is the one that decides the other three: you
// cannot tell whether to redirect it or discard it without reading what it was
// doing. Kept separate from the tailer, which reads the same file for tool
// timings and cares about nothing else.

export interface TranscriptLine {
  readonly role: 'user' | 'assistant'
  /** A tool call is its own kind, so a surface can tell it from the agent's words. */
  readonly kind: 'text' | 'tool'
  /** Flattened to text: a surface renders words, not content blocks. */
  readonly text: string
  readonly at: number
}

/** How many lines back (a line is one content block). Enough to see the loop, short enough to read. */
const DEFAULT_LIMIT = 40

/** Longest a tool's arguments get before they stop being a summary. */
const ARGUMENT_BUDGET = 120

/**
 * The one field of a tool call worth reading at a glance.
 *
 * A tool call rendered as its name alone is what the transcript used to show,
 * and fifteen consecutive `[Bash]` rows say nothing at all — you cannot tell a
 * run stuck in a loop from one working steadily through a test suite, which is
 * the single question the transcript exists to answer. The whole input is the
 * other extreme: a `Write` carries the entire file.
 *
 * So: the argument that identifies the call, by the conventions the built-in
 * tools actually use, and nothing else.
 */
function argumentOf(input: unknown): string {
  if (typeof input !== 'object' || input === null) return ''
  const fields = input as Record<string, unknown>
  for (const key of ['command', 'file_path', 'path', 'pattern', 'query', 'url', 'description']) {
    const value = fields[key]
    if (typeof value === 'string' && value.trim() !== '') {
      const oneLine = value.replace(/\s+/g, ' ').trim()
      return oneLine.length > ARGUMENT_BUDGET
        ? `${oneLine.slice(0, ARGUMENT_BUDGET - 1)}…`
        : oneLine
    }
  }
  return ''
}

type Block = Pick<TranscriptLine, 'kind' | 'text'>

/** One entry per non-empty content block, in the order they were written. */
function blocksOf(message: Record<string, unknown>): Block[] {
  const content = message.content
  if (typeof content === 'string') return content === '' ? [] : [{ kind: 'text', text: content }]
  if (!Array.isArray(content)) return []
  return content.map(blockOf).filter((block): block is Block => block !== null && block.text !== '')
}

/** One content block as a line's kind and text; null for a block with nothing to show. */
function blockOf(block: unknown): Block | null {
  if (typeof block !== 'object' || block === null) return null
  const b = block as Record<string, unknown>
  if (b.type === 'text' && typeof b.text === 'string') return { kind: 'text', text: b.text }
  // Some models write their notes between tool calls as thinking blocks;
  // an empty one is thinking the runtime chose not to show.
  if (b.type === 'thinking' && typeof b.thinking === 'string') {
    return { kind: 'text', text: b.thinking }
  }
  if (b.type === 'tool_use' && typeof b.name === 'string') {
    const argument = argumentOf(b.input)
    return { kind: 'tool', text: argument === '' ? `${b.name}` : `${b.name}: ${argument}` }
  }
  return null
}

/**
 * The last few things said in a run, oldest first. `limit` counts lines —
 * one per content block — so it can cut a message part way through.
 *
 * Every failure is tolerated as "nothing to show": the JSONL schema is not a
 * published contract, and a surface that throws because one line changed shape
 * is worse than one that is briefly empty.
 */
export function readTranscriptTail(
  transcriptPath: string,
  limit = DEFAULT_LIMIT
): TranscriptLine[] {
  const raw = readTranscriptFile(transcriptPath)
  if (raw === null) return []
  const lines = raw.split('\n').flatMap(linesOfEntry)
  return lines.slice(-Math.max(1, limit))
}

/** The transcript's text, or null when there is no file to read. */
function readTranscriptFile(transcriptPath: string): string | null {
  return tailLines(transcriptPath)?.join('\n') ?? null
}

/** What one JSONL line said, a line per content block; none for anything but a message. */
function linesOfEntry(line: string): TranscriptLine[] {
  if (line.trim() === '') return []
  let entry: Record<string, unknown>
  try {
    entry = JSON.parse(line) as Record<string, unknown>
  } catch {
    return []
  }
  const role = entry.type
  if (role !== 'user' && role !== 'assistant') return []
  const message = entry.message
  if (typeof message !== 'object' || message === null) return []
  const parsed = Date.parse(String(entry.timestamp ?? ''))
  const at = Number.isNaN(parsed) ? 0 : parsed
  return blocksOf(message as Record<string, unknown>)
    .filter((block) => block.text.trim() !== '')
    .map((block) => ({ role, ...block, at }))
}
