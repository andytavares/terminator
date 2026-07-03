import { describe, it, expect } from 'vitest'
import { textFromStreamJsonLine } from '../../src/runner/stream-json.js'

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
