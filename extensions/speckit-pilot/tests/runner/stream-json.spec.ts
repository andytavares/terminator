import { describe, it, expect } from 'vitest'
import {
  textFromStreamJsonLine,
  sessionIdFromStreamJsonLine,
  noteFromStreamJsonLine,
} from '../../src/runner/stream-json.js'

// Event shapes below are copied from real Claude Code CLI v2.1.199
// `--output-format stream-json --include-partial-messages` output.

describe('textFromStreamJsonLine', () => {
  it('extracts text from a content_block_delta text_delta event', () => {
    const line = JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'ello world' },
      },
    })
    expect(textFromStreamJsonLine(line)).toBe('ello world')
  })

  it('returns empty string for the system init event', () => {
    const line = JSON.stringify({ type: 'system', subtype: 'init', session_id: 'x' })
    expect(textFromStreamJsonLine(line)).toBe('')
  })

  it('returns empty string for the final result event (avoids duplicating streamed text)', () => {
    const line = JSON.stringify({ type: 'result', subtype: 'success', result: 'hello world' })
    expect(textFromStreamJsonLine(line)).toBe('')
  })

  it('returns empty string for a non-text delta (e.g. input_json_delta from a tool call)', () => {
    const line = JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"a":' },
      },
    })
    expect(textFromStreamJsonLine(line)).toBe('')
  })

  it('returns empty string for a blank line', () => {
    expect(textFromStreamJsonLine('')).toBe('')
    expect(textFromStreamJsonLine('   ')).toBe('')
  })

  it('returns empty string for an unparseable (partial) JSON line', () => {
    expect(textFromStreamJsonLine('{"type":"stream_event","eve')).toBe('')
  })
})

describe('sessionIdFromStreamJsonLine', () => {
  it('extracts session_id from the system init event', () => {
    const line = JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-abc' })
    expect(sessionIdFromStreamJsonLine(line)).toBe('sess-abc')
  })

  it('extracts session_id from the final result event', () => {
    const line = JSON.stringify({ type: 'result', session_id: 'sess-xyz' })
    expect(sessionIdFromStreamJsonLine(line)).toBe('sess-xyz')
  })

  it('returns null for events without a session id and for unparseable lines', () => {
    expect(sessionIdFromStreamJsonLine(JSON.stringify({ type: 'stream_event' }))).toBeNull()
    expect(sessionIdFromStreamJsonLine('{"type":"resu')).toBeNull()
    expect(sessionIdFromStreamJsonLine('')).toBeNull()
  })
})

describe('noteFromStreamJsonLine', () => {
  it('surfaces a tool call as an activity note', () => {
    const line = JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        content_block: { type: 'tool_use', id: 'toolu_1', name: 'Bash' },
      },
    })
    expect(noteFromStreamJsonLine(line)).toBe('🔧 Bash')
  })

  it('surfaces a failed result', () => {
    const line = JSON.stringify({ type: 'result', is_error: true, result: 'rate limit exceeded' })
    expect(noteFromStreamJsonLine(line)).toBe('⚠ rate limit exceeded')
  })

  it('surfaces a non-success result subtype', () => {
    const line = JSON.stringify({ type: 'result', subtype: 'error_max_turns' })
    expect(noteFromStreamJsonLine(line)).toBe('⚠ error_max_turns')
  })

  it('returns null for a successful result and for text/session events', () => {
    expect(
      noteFromStreamJsonLine(JSON.stringify({ type: 'result', subtype: 'success' }))
    ).toBeNull()
    expect(
      noteFromStreamJsonLine(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'x' }))
    ).toBeNull()
    expect(noteFromStreamJsonLine('{"type":"resu')).toBeNull()
  })
})
