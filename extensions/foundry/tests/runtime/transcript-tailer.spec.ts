import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'fs'
import { tmpdir } from 'os'
import * as path from 'path'
import { join } from 'path'
import {
  readTranscript,
  countTurns,
  rungExitCode,
  settledRungExitCode,
} from '../../src/runtime/transcript-tailer.js'

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
    expect(readTranscript(join(dir, 'missing.jsonl'))).toEqual([])
  })

  it('derives tool activity from assistant tool_use entries', () => {
    write([
      {
        type: 'assistant',
        timestamp: '2026-07-26T10:00:00.000Z',
        message: { content: [{ type: 'tool_use', id: 'c1', name: 'Read' }] },
      },
    ])
    const events = readTranscript(transcript)
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
    expect(readTranscript(transcript)[0]).toMatchObject({ isShell: true })
  })

  it('derives tool completion from user tool_result entries', () => {
    write([
      {
        type: 'user',
        timestamp: '2026-07-26T10:01:00.000Z',
        message: { content: [{ type: 'tool_result', tool_use_id: 'c1' }] },
      },
    ])
    expect(readTranscript(transcript)[0]).toMatchObject({
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
    expect(readTranscript(transcript)[0].at).toBe(Date.parse('2026-07-26T10:00:00.000Z'))
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
    expect(readTranscript(transcript).map((e) => (e as { callId: string }).callId)).toEqual([
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
    expect(readTranscript(transcript)).toHaveLength(2)
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
    expect(readTranscript(transcript)).toHaveLength(1)
  })

  it('ignores entry shapes it does not recognise rather than failing the session', () => {
    write([
      { type: 'summary', summary: 'compacted' },
      { type: 'system', subtype: 'init' },
      { completely: 'unexpected' },
    ])
    expect(readTranscript(transcript)).toEqual([])
  })

  it('ignores a tool_use with no id, which cannot be paired', () => {
    write([
      {
        type: 'assistant',
        timestamp: '2026-07-26T10:00:00.000Z',
        message: { content: [{ type: 'tool_use', name: 'Read' }] },
      },
    ])
    expect(readTranscript(transcript)).toEqual([])
  })

  it('ignores an entry with an unparseable timestamp', () => {
    write([
      {
        type: 'assistant',
        timestamp: 'not-a-date',
        message: { content: [{ type: 'tool_use', id: 'c1', name: 'Read' }] },
      },
    ])
    expect(readTranscript(transcript)).toEqual([])
  })

  it('never throws on a directory handed to it in place of a file', () => {
    expect(() => readTranscript(dir)).not.toThrow()
    expect(readTranscript(dir)).toEqual([])
  })
})

// The JSONL schema is not a published contract, so every field the tailer reads
// must be allowed to be missing or the wrong type without taking state
// reporting down (SC-007).

describe('reading a transcript whose lines are not the shape we expect', () => {
  function events(lines: unknown[]): ReturnType<typeof readTranscript> {
    writeFileSync(transcript, lines.map((line) => JSON.stringify(line)).join('\n'))
    return readTranscript(transcript)
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

describe('a transcript too big to read whole', () => {
  it('reads the tail rather than the file, and still finds recent calls', () => {
    // The stall detector asks what happened recently and never needed the
    // beginning; reading it all put an unbounded synchronous read on the main
    // thread every thirty seconds per run.
    const path = join(dir, 'huge.jsonl')
    const filler = JSON.stringify({
      type: 'assistant',
      timestamp: new Date(0).toISOString(),
      message: { content: [{ type: 'text', text: 'x'.repeat(4_000) }] },
    })
    const recent = JSON.stringify({
      type: 'assistant',
      timestamp: new Date(9_000).toISOString(),
      message: { content: [{ type: 'tool_use', id: 'late', name: 'Edit', input: {} }] },
    })
    writeFileSync(path, [...Array(200).fill(filler), recent].join('\n') + '\n')

    const events = readTranscript(path)
    expect(events.some((event) => event.callId === 'late')).toBe(true)
  })

  it('drops the fragment the offset landed in the middle of', () => {
    // Reading from a byte offset lands mid-line, and that partial is not a torn
    // write worth reporting.
    const path = join(dir, 'fragment.jsonl')
    const filler = 'x'.repeat(300_000)
    const good = JSON.stringify({
      type: 'assistant',
      timestamp: new Date(1_000).toISOString(),
      message: { content: [{ type: 'tool_use', id: 'ok', name: 'Read', input: {} }] },
    })
    writeFileSync(path, `${filler}\n${good}\n`)

    expect(readTranscript(path).map((event) => event.callId)).toEqual(['ok'])
  })
})

// A `run` rung is a command, and FR-037 says its verdict is the exit status.
// The agent runs it inside the supervised session — that is what makes its
// output visible and its tool calls hook-gated — so the exit status has to
// come back from the runtime's own record of that tool call, never from the
// agent's account of how it went (FR-033).
describe('rungExitCode', () => {
  function write(...entries: unknown[]): string {
    const file = path.join(dir, `rung-${Math.random().toString(36).slice(2)}.jsonl`)
    fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n'))
    return file
  }

  const call = (id: string, command: string) => ({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] },
  })
  const result = (id: string, isError: boolean) => ({
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: isError }] },
  })

  it('is zero when the command the rung asked for succeeded', () => {
    const file = write(call('t1', 'npm test'), result('t1', false))
    expect(rungExitCode(file, 'npm test')).toBe(0)
  })

  it('is non-zero when it failed', () => {
    const file = write(call('t1', 'npm test'), result('t1', true))
    expect(rungExitCode(file, 'npm test')).toBe(1)
  })

  it('is not measured when the agent never ran it — never a pass', () => {
    const file = write(call('t1', 'ls'), result('t1', false))
    expect(rungExitCode(file, 'npm test')).toBeNull()
  })

  // A lane is one conversation: the architect, the builder, the verifier and
  // every rung resume the same session and write to the same transcript. With
  // no mark, a rung answered with whoever ran the command last — on a live run
  // that was the architect's `npm test` while scouting, on the tree as it was
  // before the change existed, produced by the session whose work was under
  // test. FR-033, one layer below the verdicts.
  describe('a transcript shared with the nodes that came before', () => {
    const shared = () =>
      write(
        call('earlier', 'npm test'),
        result('earlier', false),
        call('mine', 'npm run lint'),
        result('mine', true)
      )

    it("reads an earlier node's run of the command when given no mark", () => {
      expect(rungExitCode(shared(), 'npm test')).toBe(0)
    })

    it('does not, once told where its own turn begins', () => {
      const file = shared()
      const beforeMine = fs
        .readFileSync(file, 'utf8')
        .indexOf('{"type":"assistant","message":{"content":[{"type":"tool_use","id":"mine"')
      expect(beforeMine).toBeGreaterThan(0)
      // The command it did not run is not measured, rather than another
      // session's pass.
      expect(rungExitCode(file, 'npm test', beforeMine)).toBeNull()
      // And the one it did run still reads.
      expect(rungExitCode(file, 'npm run lint', beforeMine)).toBe(1)
    })

    it('reads the whole file for a mark of zero, which is a fresh conversation', () => {
      expect(rungExitCode(shared(), 'npm test', 0)).toBe(0)
    })

    it('falls back to the whole file when the mark is past the end', () => {
      // The transcript was replaced; a mark from the old one describes a
      // different file, and trusting it would report "not measured" for
      // everything.
      const file = shared()
      expect(rungExitCode(file, 'npm test', 10_000_000)).toBe(0)
    })
  })

  it('is not measured when it was started and never came back', () => {
    const file = write(call('t1', 'npm test'))
    expect(rungExitCode(file, 'npm test')).toBeNull()
  })

  it('takes the attempt it finished with, when the agent retried', () => {
    const file = write(
      call('t1', 'npm test'),
      result('t1', true),
      call('t2', 'npm test'),
      result('t2', false)
    )
    expect(rungExitCode(file, 'npm test')).toBe(0)
  })

  it('matches a command the agent wrapped in something longer', () => {
    const file = write(call('t1', 'cd /repo && npm test 2>&1'), result('t1', false))
    expect(rungExitCode(file, 'npm test')).toBe(0)
  })

  it('ignores what the agent said about it', () => {
    const file = write(call('t1', 'npm test'), result('t1', true), {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'All tests pass!' }] },
    })
    expect(rungExitCode(file, 'npm test')).toBe(1)
  })

  it('is not measured for a transcript that is not there', () => {
    expect(rungExitCode(path.join(dir, 'nope.jsonl'), 'npm test')).toBeNull()
  })

  it('is not measured when the rung had no command to run', () => {
    const file = write(call('t1', 'npm test'), result('t1', false))
    expect(rungExitCode(file, '   ')).toBeNull()
  })

  it('survives a torn line rather than losing the answer', () => {
    const file = path.join(dir, 'torn.jsonl')
    fs.writeFileSync(
      file,
      [
        '{"type":"assistant","message":{"content":[{"broken',
        JSON.stringify(call('t1', 'npm test')),
        JSON.stringify(result('t1', false)),
      ].join('\n')
    )
    expect(rungExitCode(file, 'npm test')).toBe(0)
  })
})

// The turn ending and the transcript being written are not the same instant:
// the end arrives on the `Stop` hook and the records it is about are flushed
// after it. Reading immediately raced them and lost — a live run whose rungs
// both ran and both exited 0 shipped saying "Not measured here: Lint, The
// unit's own tests", and `rungExitCode` answers 0 for both against the same
// file once it is finished.
describe('settledRungExitCode', () => {
  function write(file: string, ...entries: unknown[]): void {
    fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n'))
  }
  const call = (id: string, command: string) => ({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] },
  })
  const result = (id: string, isError: boolean) => ({
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: isError }] },
  })

  it('answers at once when the record is already there', async () => {
    const file = path.join(dir, 'settled-a.jsonl')
    write(file, call('t1', 'npm test'), result('t1', false))
    expect(await settledRungExitCode(file, 'npm test')).toBe(0)
  })

  it('waits for a record the runtime has not flushed yet', async () => {
    const file = path.join(dir, 'settled-b.jsonl')
    write(file, call('t1', 'ls'), result('t1', false))
    let polls = 0
    const measured = await settledRungExitCode(file, 'npm test', 0, {
      withinMs: 10_000,
      pollMs: 1,
      wait: async () => {
        polls += 1
        // The runtime catches up on the third look, as it does in the world.
        if (polls === 3) write(file, call('t2', 'npm test; echo done'), result('t2', true))
      },
    })
    expect(measured).toBe(1)
    expect(polls).toBeGreaterThan(0)
  })

  it('gives up and says not measured, rather than waiting for ever', async () => {
    const file = path.join(dir, 'settled-c.jsonl')
    write(file, call('t1', 'ls'), result('t1', false))
    let polls = 0
    const started = Date.now()
    const measured = await settledRungExitCode(file, 'npm test', 0, {
      withinMs: 60,
      pollMs: 10,
      wait: async (ms) => {
        polls += 1
        await new Promise((resolve) => setTimeout(resolve, ms))
      },
    })
    expect(measured).toBeNull()
    // It polled, and it stopped: a real clock, so a wrapper that never gave up
    // would hang this test rather than pass it.
    expect(polls).toBeGreaterThan(0)
    expect(Date.now() - started).toBeLessThan(5_000)
  })
})
