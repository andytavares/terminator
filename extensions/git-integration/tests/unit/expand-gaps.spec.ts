import { describe, it, expect } from 'vitest'
import { EXPAND_STEP, gapsFor, reveal, splitLines } from '../../src/review/expand-gaps'
import type { DiffHunk } from '../../src/schemas/git.schema'

const hunk = (header: string): DiffHunk => ({ header, lines: [] })

describe('gapsFor', () => {
  it('returns no gaps for no hunks', () => {
    expect(gapsFor([])).toEqual([])
  })

  it('has no top gap when the first hunk starts at line 1', () => {
    const gaps = gapsFor([hunk('@@ -1,3 +1,3 @@')])
    expect(gaps.map((g) => g.key)).toEqual(['bottom'])
  })

  it('derives the top gap from the first hunk header', () => {
    const [top] = gapsFor([hunk('@@ -8,3 +10,3 @@ fn')])
    expect(top).toEqual({ key: 'top', newStart: 1, newEnd: 9, oldOffset: 2 })
  })

  it('derives the gap between hunks after the first one added lines', () => {
    const gaps = gapsFor([hunk('@@ -1,2 +1,5 @@'), hunk('@@ -10,2 +20,2 @@')])
    expect(gaps[0]).toEqual({ key: 'after-0', newStart: 6, newEnd: 19, oldOffset: 10 })
  })

  it('omits the gap between adjacent hunks', () => {
    const gaps = gapsFor([hunk('@@ -1,2 +1,2 @@'), hunk('@@ -3,2 +3,2 @@')])
    expect(gaps.map((g) => g.key)).toEqual(['bottom'])
  })

  it('treats omitted header counts as 1', () => {
    const gaps = gapsFor([hunk('@@ -5 +5 @@'), hunk('@@ -9 +9 @@')])
    expect(gaps).toEqual([
      { key: 'top', newStart: 1, newEnd: 4, oldOffset: 0 },
      { key: 'after-0', newStart: 6, newEnd: 8, oldOffset: 0 },
      { key: 'bottom', newStart: 10, newEnd: null, oldOffset: 0 },
    ])
  })

  it('computes the bottom offset from the last hunk net change', () => {
    const gaps = gapsFor([hunk('@@ -1,2 +1,5 @@')])
    expect(gaps).toEqual([{ key: 'bottom', newStart: 6, newEnd: null, oldOffset: 3 }])
  })

  it('anchors a pure-deletion hunk to the line before it', () => {
    const gaps = gapsFor([hunk('@@ -5,2 +4,0 @@')])
    expect(gaps).toEqual([
      { key: 'top', newStart: 1, newEnd: 4, oldOffset: 0 },
      { key: 'bottom', newStart: 5, newEnd: null, oldOffset: -2 },
    ])
  })

  it('returns no gaps for an added file', () => {
    expect(gapsFor([hunk('@@ -0,0 +1,4 @@')])).toEqual([])
  })

  it('returns no gaps for a deleted file', () => {
    expect(gapsFor([hunk('@@ -1,4 +0,0 @@')])).toEqual([])
  })
})

describe('splitLines', () => {
  it('drops the empty string after a final newline', () => {
    expect(splitLines('a\nb\n')).toEqual(['a', 'b'])
  })

  it('keeps the last line when there is no trailing newline', () => {
    expect(splitLines('a\nb')).toEqual(['a', 'b'])
  })

  it('splits CRLF without leaving carriage returns', () => {
    expect(splitLines('a\r\nb\r\n')).toEqual(['a', 'b'])
  })

  it('returns no lines for empty text', () => {
    expect(splitLines('')).toEqual([])
  })
})

describe('reveal', () => {
  const file = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`)

  it('uses a step of 20', () => {
    expect(EXPAND_STEP).toBe(20)
  })

  it('shows the first and last lines of a gap with old numbers from the offset', () => {
    const gap = { key: 'g', newStart: 11, newEnd: 30, oldOffset: 3 }
    const r = reveal(gap, file, { fromTop: 2, fromBottom: 1 })
    expect(r.above.map((l) => l.newLineNumber)).toEqual([11, 12])
    expect(r.above[0]).toEqual({
      type: 'context',
      content: 'line 11',
      newLineNumber: 11,
      oldLineNumber: 8,
    })
    expect(r.below).toEqual([
      { type: 'context', content: 'line 30', newLineNumber: 30, oldLineNumber: 27 },
    ])
    expect(r.hidden).toBe(17)
  })

  it('shows 30 distinct lines when 20 + 20 exceed a 30-line gap', () => {
    const gap = { key: 'g', newStart: 1, newEnd: 30, oldOffset: 0 }
    const r = reveal(gap, file, { fromTop: 20, fromBottom: 20 })
    const numbers = [...r.above, ...r.below].map((l) => l.newLineNumber)
    expect(numbers).toEqual(Array.from({ length: 30 }, (_, i) => i + 1))
    expect(r.hidden).toBe(0)
  })

  it('resolves a null end to the file length', () => {
    const gap = { key: 'bottom', newStart: 36, newEnd: null, oldOffset: 0 }
    const r = reveal(gap, file, { fromTop: 3, fromBottom: 0 })
    expect(r.above.map((l) => l.newLineNumber)).toEqual([36, 37, 38])
    expect(r.hidden).toBe(2)
  })

  it('yields nothing for a bottom gap that starts beyond the file', () => {
    const gap = { key: 'bottom', newStart: 41, newEnd: null, oldOffset: 0 }
    expect(reveal(gap, file, { fromTop: 20, fromBottom: 20 })).toEqual({
      above: [],
      hidden: 0,
      below: [],
    })
  })

  it('reveals nothing when the expansion is zero', () => {
    const gap = { key: 'g', newStart: 1, newEnd: 5, oldOffset: 0 }
    const r = reveal(gap, file, { fromTop: 0, fromBottom: 0 })
    expect(r.above).toEqual([])
    expect(r.below).toEqual([])
    expect(r.hidden).toBe(5)
  })
})
