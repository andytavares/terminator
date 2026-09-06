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

  it('summarises a tool call rather than printing all of its arguments', () => {
    // Both extremes are useless. The name alone gives fifteen consecutive
    // `[Bash]` rows, which cannot distinguish a run looping on one command
    // from one working through a test suite — the single question the
    // transcript exists to answer. The whole input buries the sentence that
    // says what went wrong, and a `Write` carries an entire file.
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
    const text = readTranscriptTail(file)[0].text
    expect(text.startsWith('checking\nBash: xxx')).toBe(true)
    expect(text.length).toBeLessThan(200)
    expect(text.endsWith('\u2026')).toBe(true)
  })

  it('picks the argument that identifies the call, whatever the tool calls it', () => {
    write(
      line({
        type: 'assistant',
        timestamp: '2026-07-27T10:00:06Z',
        message: {
          content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/repo/spec.md' } }],
        },
      })
    )
    expect(readTranscriptTail(file).at(-1)?.text).toBe('Read: /repo/spec.md')
  })

  it('falls back to the bare name when nothing in the input identifies the call', () => {
    write(
      line({
        type: 'assistant',
        timestamp: '2026-07-27T10:00:07Z',
        message: { content: [{ type: 'tool_use', name: 'TodoWrite', input: { todos: [] } }] },
      })
    )
    expect(readTranscriptTail(file).at(-1)?.text).toBe('TodoWrite')
  })

  it('flattens a multi-line command, so one call stays one line', () => {
    write(
      line({
        type: 'assistant',
        timestamp: '2026-07-27T10:00:08Z',
        message: {
          content: [{ type: 'tool_use', name: 'Bash', input: { command: 'a\n  b\n  c' } }],
        },
      })
    )
    expect(readTranscriptTail(file).at(-1)?.text).toBe('Bash: a b c')
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
