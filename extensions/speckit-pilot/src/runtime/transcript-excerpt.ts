import { readFileSync, statSync } from 'node:fs'

// The tail of a run's conversation, in the words it was written in.
//
// "Show me the transcript" is the first of the four things you want when a run
// stops making progress, and it is the one that decides the other three: you
// cannot tell whether to redirect it or discard it without reading what it was
// doing. Kept separate from the tailer, which reads the same file for tool
// timings and cares about nothing else.

export interface TranscriptLine {
  readonly role: 'user' | 'assistant'
  /** Flattened to text: a surface renders words, not content blocks. */
  readonly text: string
  readonly at: number
}

/** How many lines back. Enough to see the loop, short enough to read. */
const DEFAULT_LIMIT = 40

function textOf(message: Record<string, unknown>): string {
  const content = message.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => {
      if (typeof block !== 'object' || block === null) return ''
      const b = block as Record<string, unknown>
      if (b.type === 'text' && typeof b.text === 'string') return b.text
      // Named rather than rendered: a wall of arguments buries the sentence
      // that says what went wrong.
      if (b.type === 'tool_use' && typeof b.name === 'string') return `[${b.name}]`
      return ''
    })
    .filter((part) => part !== '')
    .join('\n')
}

/**
 * The last few things said in a run, oldest first.
 *
 * Every failure is tolerated as "nothing to show": the JSONL schema is not a
 * published contract, and a surface that throws because one line changed shape
 * is worse than one that is briefly empty.
 */
export function readTranscriptTail(
  transcriptPath: string,
  limit = DEFAULT_LIMIT
): TranscriptLine[] {
  let raw: string
  try {
    if (!statSync(transcriptPath).isFile()) return []
    raw = readFileSync(transcriptPath, 'utf8')
  } catch {
    return []
  }

  const lines: TranscriptLine[] = []
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue
    let entry: Record<string, unknown>
    try {
      entry = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
    const role = entry.type
    if (role !== 'user' && role !== 'assistant') continue
    const message = entry.message
    if (typeof message !== 'object' || message === null) continue
    const text = textOf(message as Record<string, unknown>)
    if (text.trim() === '') continue
    const at = Date.parse(String(entry.timestamp ?? ''))
    lines.push({ role, text, at: Number.isNaN(at) ? 0 : at })
  }
  return lines.slice(-Math.max(1, limit))
}
