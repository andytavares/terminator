import { describe, it, expect } from 'vitest'
import {
  tokenize,
  wordSpans,
  pairReplacedLines,
} from '../../src/components/pr-review/diff-pane/word-diff'
import type { DiffLine } from '../../src/schemas/git.schema'

const joined = (spans: Array<{ text: string }>) => spans.map((s) => s.text).join('')
const changedText = (spans: Array<{ text: string; changed: boolean }>) =>
  spans.filter((s) => s.changed).map((s) => s.text)

function line(type: DiffLine['type'], content = ''): DiffLine {
  return { type, content, oldLineNumber: null, newLineNumber: null }
}

describe('tokenize', () => {
  it.each(['bounce_time=0.05', '  Button(pin, pull_up=True)', 'a  b\t\tc', '', 'x.y->z[0]'])(
    'joins back to the input for %j',
    (sample) => {
      expect(tokenize(sample).join('')).toBe(sample)
    }
  )

  it('splits identifiers, whitespace runs and single punctuation characters', () => {
    expect(tokenize('foo  (bar_1)')).toEqual(['foo', '  ', '(', 'bar_1', ')'])
  })
})

describe('wordSpans', () => {
  it('marks only the changed tokens inside a call', () => {
    const { old, new: next } = wordSpans(
      'button = Button(pin, bounce_time=0.05)',
      'button = Button(pin, pull_up=True)'
    )
    expect(changedText(old)).toEqual(['bounce_time', '0.05'])
    expect(changedText(next)).toEqual(['pull_up', 'True'])
    expect(joined(old)).toBe('button = Button(pin, bounce_time=0.05)')
    expect(joined(next)).toBe('button = Button(pin, pull_up=True)')
  })

  it('returns whole-line unmarked spans when the lines share little', () => {
    const oldText = 'level == GPIO.LOW'
    const newText = 'self._triggered(level)'
    const result = wordSpans(oldText, newText)
    expect(result.old).toEqual([{ text: oldText, changed: false }])
    expect(result.new).toEqual([{ text: newText, changed: false }])
  })

  it('marks nothing for identical lines', () => {
    const { old, new: next } = wordSpans('return value', 'return value')
    expect(changedText(old)).toEqual([])
    expect(changedText(next)).toEqual([])
    expect(joined(old)).toBe('return value')
  })
})

describe('wordSpans limits', () => {
  it('returns whole-line unmarked spans for a line over 1,000 characters', () => {
    const long = 'word '.repeat(400)
    const result = wordSpans(long, `${long}x`)
    expect(result.old).toEqual([{ text: long, changed: false }])
    expect(result.new).toEqual([{ text: `${long}x`, changed: false }])
  })
})

describe('pairReplacedLines', () => {
  it('pairs the i-th removed line with the i-th added line', () => {
    const lines = [line('remove'), line('remove'), line('add'), line('add'), line('add')]
    expect([...pairReplacedLines(lines)]).toEqual([
      [0, 2],
      [1, 3],
    ])
  })

  it('pairs nothing when a context line separates the runs', () => {
    expect(pairReplacedLines([line('remove'), line('context', ' '), line('add')]).size).toBe(0)
  })
})
