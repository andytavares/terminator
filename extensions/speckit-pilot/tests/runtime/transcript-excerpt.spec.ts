import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readTranscriptTail } from '../../src/runtime/transcript-excerpt.js'

// Reading a run's own record. The schema is not a published contract, so the
// question every case below asks is the same: does a line it did not expect
// cost you the ones it did.

let dir: string
let file: string

const line = (entry: unknown): string => JSON.stringify(entry)

function write(...entries: string[]): void {
  writeFileSync(file, entries.join('\n'))
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'transcript-'))
  file = join(dir, 'session.jsonl')
})

afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }))

describe('the tail of a conversation', () => {
  it('reads what was said, oldest first', () => {
    write(
      line({
        type: 'user',
        timestamp: '2026-07-27T10:00:00Z',
        message: { content: 'do the thing' },
      }),
      line({
        type: 'assistant',
        timestamp: '2026-07-27T10:00:05Z',
        message: { content: [{ type: 'text', text: 'on it' }] },
      })
    )
    expect(readTranscriptTail(file)).toEqual([
      { role: 'user', text: 'do the thing', at: Date.parse('2026-07-27T10:00:00Z') },
      { role: 'assistant', text: 'on it', at: Date.parse('2026-07-27T10:00:05Z') },
    ])
  })

  it('names a tool call rather than printing its arguments', () => {
    // The sentence that says what went wrong is what you came for; a wall of
    // arguments buries it.
    write(
      line({
        type: 'assistant',
        timestamp: '2026-07-27T10:00:05Z',
        message: {
          content: [
            { type: 'text', text: 'checking' },
            { type: 'tool_use', name: 'Bash', input: { command: 'x'.repeat(500) } },
          ],
        },
      })
    )
    expect(readTranscriptTail(file)[0].text).toBe('checking\n[Bash]')
  })

  it('keeps only the last few, since a long run is unreadable whole', () => {
    write(
      ...Array.from({ length: 10 }, (_, i) =>
        line({ type: 'user', timestamp: '2026-07-27T10:00:00Z', message: { content: `m${i}` } })
      )
    )
    expect(readTranscriptTail(file, 3).map((l) => l.text)).toEqual(['m7', 'm8', 'm9'])
  })

  it('skips a line it cannot parse without losing the rest', () => {
    write(
      'not json at all',
      line({ type: 'user', timestamp: '2026-07-27T10:00:00Z', message: { content: 'still here' } })
    )
    expect(readTranscriptTail(file)).toHaveLength(1)
  })

  it('skips entries that are neither side of the conversation', () => {
    write(
      line({ type: 'summary', summary: 'ignored' }),
      line({ type: 'user', timestamp: '2026-07-27T10:00:00Z', message: { content: 'kept' } })
    )
    expect(readTranscriptTail(file).map((l) => l.text)).toEqual(['kept'])
  })

  it('skips a turn that said nothing', () => {
    write(
      line({ type: 'assistant', timestamp: '2026-07-27T10:00:00Z', message: { content: [] } }),
      line({ type: 'user', timestamp: '2026-07-27T10:00:01Z', message: { content: 'kept' } })
    )
    expect(readTranscriptTail(file).map((l) => l.text)).toEqual(['kept'])
  })

  it('reports zero rather than throwing when there is no transcript yet', () => {
    // A run whose file has not been written is the normal first second of its
    // life, not an error worth a stack trace.
    expect(readTranscriptTail(join(dir, 'nothing.jsonl'))).toEqual([])
  })

  it('tolerates a timestamp it cannot read', () => {
    write(line({ type: 'user', timestamp: 'whenever', message: { content: 'kept' } }))
    expect(readTranscriptTail(file)[0].at).toBe(0)
  })
})
