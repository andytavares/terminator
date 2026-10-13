import type { DiffHunk, DiffLine } from '../schemas/git.schema'

// Gaps are derived from hunk headers alone: the diff carries no rows for unchanged lines
// outside a hunk, and the file length is unknown until the file is fetched.

export const EXPAND_STEP = 20

export interface Gap {
  key: string
  newStart: number
  newEnd: number | null
  oldOffset: number
}

export interface Expansion {
  fromTop: number
  fromBottom: number
}

interface Span {
  oldFirst: number
  oldCount: number
  newFirst: number
  newCount: number
  wholeFile: boolean
}

const HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

function parse(hunk: DiffHunk): Span | null {
  const m = HEADER.exec(hunk.header)
  if (!m) return null
  const oldStart = Number(m[1])
  const oldCount = m[2] === undefined ? 1 : Number(m[2])
  const newStart = Number(m[3])
  const newCount = m[4] === undefined ? 1 : Number(m[4])
  return {
    // A zero-count range names the line before it, so its first line is the next one.
    oldFirst: oldCount === 0 ? oldStart + 1 : oldStart,
    oldCount,
    newFirst: newCount === 0 ? newStart + 1 : newStart,
    newCount,
    wholeFile: (oldCount === 0 && oldStart === 0) || (newCount === 0 && newStart === 0),
  }
}

/** Each hunk's span, or null when one is unparseable or covers a whole added or deleted file. */
function spansOf(hunks: readonly DiffHunk[]): Span[] | null {
  const spans: Span[] = []
  for (const hunk of hunks) {
    const span = parse(hunk)
    if (!span || span.wholeFile) return null
    spans.push(span)
  }
  return spans
}

/** The unchanged lines above `next`, up to the line before it; none when `newStart` reaches it. */
function gapBefore(key: string, newStart: number, next: Span): Gap[] {
  if (newStart >= next.newFirst) return []
  return [{ key, newStart, newEnd: next.newFirst - 1, oldOffset: next.newFirst - next.oldFirst }]
}

function bottomGap(last: Span): Gap {
  const newStart = last.newFirst + last.newCount
  return {
    key: 'bottom',
    newStart,
    newEnd: null,
    oldOffset: newStart - (last.oldFirst + last.oldCount),
  }
}

export function gapsFor(hunks: readonly DiffHunk[]): Gap[] {
  const spans = spansOf(hunks)
  if (!spans || spans.length === 0) return []
  const between = spans
    .slice(1)
    .flatMap((next, i) => gapBefore(`after-${i}`, spans[i].newFirst + spans[i].newCount, next))
  return [...gapBefore('top', 1, spans[0]), ...between, bottomGap(spans[spans.length - 1])]
}

export function splitLines(text: string): string[] {
  const lines = text.split(/\r?\n/)
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

export function reveal(
  gap: Gap,
  fileLines: readonly string[],
  exp: Expansion
): { above: DiffLine[]; hidden: number; below: DiffLine[] } {
  const end = Math.min(gap.newEnd ?? fileLines.length, fileLines.length)
  const size = Math.max(0, end - gap.newStart + 1)
  const top = Math.min(Math.max(0, exp.fromTop), size)
  const bottom = Math.min(Math.max(0, exp.fromBottom), size - top)

  const line = (n: number): DiffLine => ({
    type: 'context',
    content: fileLines[n - 1],
    oldLineNumber: n - gap.oldOffset,
    newLineNumber: n,
  })
  const range = (from: number, count: number): DiffLine[] =>
    Array.from({ length: count }, (_, i) => line(from + i))

  return {
    above: range(gap.newStart, top),
    hidden: size - top - bottom,
    below: range(end - bottom + 1, bottom),
  }
}
