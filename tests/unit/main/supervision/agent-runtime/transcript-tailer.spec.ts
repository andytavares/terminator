import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  readTranscript,
  countTurns,
} from '../../../../../src/main/supervision/agent-runtime/transcript-tailer.js'

// The tailer opens the path the runtime handed us (research.md R3) and never
// computes one. The per-line JSONL schema is NOT a published contract, so it
// reads defensively: take the few fields we need, tolerate everything else.

let dir: string
let transcript: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'transcript-'))
  transcript = join(dir, 's1.jsonl')
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

function write(lines: unknown[]): void {
  writeFileSync(transcript, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
}

describe('reading a transcript', () => {
  it('returns nothing for a transcript that does not exist yet', () => {
    expect(readTranscript('s1', join(dir, 'missing.jsonl'))).toEqual([])
  })

  it('derives tool activity from assistant tool_use entries', () => {
    write([
      {
        type: 'assistant',
        timestamp: '2026-07-26T10:00:00.000Z',
        message: { content: [{ type: 'tool_use', id: 'c1', name: 'Read' }] },
      },
    ])
    const events = readTranscript('s1', transcript)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'tool_started', toolName: 'Read', callId: 'c1' })
  })

  it('flags a shell tool so the long-command exemption still works from the transcript', () => {
    write([
      {
        type: 'assistant',
        timestamp: '2026-07-26T10:00:00.000Z',
        message: { content: [{ type: 'tool_use', id: 'c1', name: 'Bash' }] },
      },
    ])
    expect(readTranscript('s1', transcript)[0]).toMatchObject({ isShell: true })
  })

  it('derives tool completion from user tool_result entries', () => {
    write([
      {
        type: 'user',
        timestamp: '2026-07-26T10:01:00.000Z',
        message: { content: [{ type: 'tool_result', tool_use_id: 'c1' }] },
      },
    ])
    expect(readTranscript('s1', transcript)[0]).toMatchObject({
      kind: 'tool_finished',
      callId: 'c1',
    })
  })

  it('converts timestamps to epoch ms so consumers stay pure functions of (events, now)', () => {
    write([
      {
        type: 'assistant',
        timestamp: '2026-07-26T10:00:00.000Z',
        message: { content: [{ type: 'tool_use', id: 'c1', name: 'Read' }] },
      },
    ])
    expect(readTranscript('s1', transcript)[0].at).toBe(Date.parse('2026-07-26T10:00:00.000Z'))
  })

  it('reads several tool uses from one assistant entry', () => {
    write([
      {
        type: 'assistant',
        timestamp: '2026-07-26T10:00:00.000Z',
        message: {
          content: [
            { type: 'tool_use', id: 'c1', name: 'Read' },
            { type: 'tool_use', id: 'c2', name: 'Bash' },
          ],
        },
      },
    ])
    expect(readTranscript('s1', transcript).map((e) => (e as { callId: string }).callId)).toEqual([
      'c1',
      'c2',
    ])
  })
})

describe('defensive parsing (the line schema is not a contract)', () => {
  it('skips an unparseable line and keeps reading', () => {
    write([
      {
        type: 'assistant',
        timestamp: '2026-07-26T10:00:00.000Z',
        message: { content: [{ type: 'tool_use', id: 'c1', name: 'Read' }] },
      },
    ])
    appendFileSync(transcript, 'this is not json\n')
    appendFileSync(
      transcript,
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-07-26T10:02:00.000Z',
        message: { content: [{ type: 'tool_use', id: 'c2', name: 'Read' }] },
      }) + '\n'
    )
    expect(readTranscript('s1', transcript)).toHaveLength(2)
  })

  it('tolerates a torn final line', () => {
    write([
      {
        type: 'assistant',
        timestamp: '2026-07-26T10:00:00.000Z',
        message: { content: [{ type: 'tool_use', id: 'c1', name: 'Read' }] },
      },
    ])
    appendFileSync(transcript, '{"type":"assistant","timestamp"')
    expect(readTranscript('s1', transcript)).toHaveLength(1)
  })

  it('ignores entry shapes it does not recognise rather than failing the session', () => {
    write([
      { type: 'summary', summary: 'compacted' },
      { type: 'system', subtype: 'init' },
      { completely: 'unexpected' },
    ])
    expect(readTranscript('s1', transcript)).toEqual([])
  })

  it('ignores a tool_use with no id, which cannot be paired', () => {
    write([
      {
        type: 'assistant',
        timestamp: '2026-07-26T10:00:00.000Z',
        message: { content: [{ type: 'tool_use', name: 'Read' }] },
      },
    ])
    expect(readTranscript('s1', transcript)).toEqual([])
  })

  it('ignores an entry with an unparseable timestamp', () => {
    write([
      {
        type: 'assistant',
        timestamp: 'not-a-date',
        message: { content: [{ type: 'tool_use', id: 'c1', name: 'Read' }] },
      },
    ])
    expect(readTranscript('s1', transcript)).toEqual([])
  })

  it('never throws on a directory handed to it in place of a file', () => {
    expect(() => readTranscript('s1', dir)).not.toThrow()
    expect(readTranscript('s1', dir)).toEqual([])
  })
})

// The JSONL schema is not a published contract, so every field the tailer reads
// must be allowed to be missing or the wrong type without taking state
// reporting down (SC-007).

describe('reading a transcript whose lines are not the shape we expect', () => {
  function events(lines: unknown[]): ReturnType<typeof readTranscript> {
    writeFileSync(transcript, lines.map((line) => JSON.stringify(line)).join('\n'))
    return readTranscript('s1', transcript)
  }

  it('ignores an entry with no message at all', () => {
    expect(events([{ timestamp: '2026-07-27T14:00:00Z' }])).toEqual([])
  })

  it('ignores an entry whose message is not an object', () => {
    expect(events([{ timestamp: '2026-07-27T14:00:00Z', message: 'hello' }])).toEqual([])
  })

  it('ignores an entry whose content is not an array', () => {
    expect(
      events([{ timestamp: '2026-07-27T14:00:00Z', message: { content: 'plain text' } }])
    ).toEqual([])
  })

  it('ignores a line that parses to something other than an object', () => {
    expect(events([42])).toEqual([])
  })

  it('names an unnamed tool call rather than dropping it', () => {
    const [event] = events([
      {
        timestamp: '2026-07-27T14:00:00Z',
        message: { content: [{ type: 'tool_use', id: 'c1' }] },
      },
    ])
    expect(event).toMatchObject({ kind: 'tool_started', toolName: 'unknown', callId: 'c1' })
  })

  it('drops a tool result with no id, which could never be paired with its call', () => {
    expect(
      events([
        {
          timestamp: '2026-07-27T14:00:00Z',
          message: { content: [{ type: 'tool_result' }] },
        },
      ])
    ).toEqual([])
  })

  it('ignores a content block of an unrecognised type', () => {
    expect(
      events([
        {
          timestamp: '2026-07-27T14:00:00Z',
          message: { content: [{ type: 'text', text: 'thinking' }] },
        },
      ])
    ).toEqual([])
  })
})

describe('counting turns', () => {
  // Turns used to arrive in the runtime's own result message. A terminal
  // produces no such message, so they are counted from the record instead.
  it('counts nothing for a transcript that does not exist yet', () => {
    expect(countTurns(join(dir, 'missing.jsonl'))).toBe(0)
  })

  it('counts one per assistant entry', () => {
    write([
      { type: 'user', timestamp: '2026-07-27T10:00:00.000Z' },
      { type: 'assistant', timestamp: '2026-07-27T10:00:01.000Z' },
      { type: 'assistant', timestamp: '2026-07-27T10:00:02.000Z' },
    ])
    expect(countTurns(transcript)).toBe(2)
  })

  it('ignores everything that is not the agent speaking', () => {
    write([
      { type: 'user', timestamp: '2026-07-27T10:00:00.000Z' },
      { type: 'attachment', timestamp: '2026-07-27T10:00:01.000Z' },
      { type: 'queue-operation', timestamp: '2026-07-27T10:00:02.000Z' },
    ])
    expect(countTurns(transcript)).toBe(0)
  })

  it('does not count a subagent’s turns as this session’s', () => {
    write([
      { type: 'assistant', timestamp: '2026-07-27T10:00:01.000Z' },
      { type: 'assistant', isSidechain: true, timestamp: '2026-07-27T10:00:02.000Z' },
    ])
    expect(countTurns(transcript)).toBe(1)
  })

  it('keeps counting past a torn line rather than giving up on the session', () => {
    writeFileSync(
      transcript,
      ['{"type":"assistant"}', '{ this is not json', '{"type":"assistant"}'].join('\n')
    )
    expect(countTurns(transcript)).toBe(2)
  })

  it('counts nothing for a path that is a directory', () => {
    expect(countTurns(dir)).toBe(0)
  })
})
