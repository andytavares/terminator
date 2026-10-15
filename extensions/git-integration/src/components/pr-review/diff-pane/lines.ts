import type { DiffHunk, DiffLine } from '../../../schemas/git.schema'
import type { LineSelection } from '../../../stores/review-ui.store'
import type { FileDiff } from '../../../schemas/git.schema'
import type { Side } from './types'
import { pairReplacedLines, wordSpans, type Span } from './word-diff'

/** The line's number on `side`: the old file's on the left, the new file's on the right. */
function lineNumberOn(line: DiffLine, side: Side): number | null | undefined {
  if (side === 'LEFT') return line.oldLineNumber
  return line.newLineNumber
}

/** True when the line's number on the selection's side lies inside it. */
export function inSelection(line: DiffLine, sel: Omit<LineSelection, 'path'>): boolean {
  const n = lineNumberOn(line, sel.side)
  return n != null && n >= sel.startLine && n <= sel.endLine
}

/** The selected lines' text, for finding the tests that cover it. */
export function selectionCode(hunks: DiffHunk[], sel: Omit<LineSelection, 'path'>): string {
  return hunks
    .flatMap((h) => h.lines)
    .filter((l) => inSelection(l, sel))
    .map((l) => l.content)
    .join('\n')
}

/** A hunk's code as it reads after the change. */
export function hunkCode(lines: Array<{ type: string; content: string }>): string {
  return lines
    .filter((l) => l.type !== 'remove')
    .map((l) => l.content)
    .join('\n')
}

/** The first hunk's line range, which the agent reads when nothing is selected. */
export function hunkNearTop(hunks: DiffHunk[]): { startLine: number; endLine: number } | null {
  for (const hunk of hunks) {
    const lines = hunk.lines.map((l) => l.newLineNumber ?? l.oldLineNumber ?? 0).filter(Boolean)
    if (lines.length > 0) return { startLine: Math.min(...lines), endLine: Math.max(...lines) }
  }
  return null
}

/** The widest line number the diff (and the revealed file text) can show. */
export function maxLineNumber(hunks: DiffHunk[], fileLineCount: number): number {
  let max = fileLineCount
  for (const line of hunks.flatMap((h) => h.lines)) {
    max = Math.max(max, line.oldLineNumber ?? 0, line.newLineNumber ?? 0)
  }
  return max
}

/** The number column's width for numbers up to `max`. */
export function numColWidthFor(max: number): number {
  const digits = String(max || 1).length
  return digits * 7 + 16
}

/** A unified row's side: removed lines are on the left. */
export function unifiedSide(line: DiffLine): Side {
  if (line.type === 'remove') return 'LEFT'
  return 'RIGHT'
}

/** The start line of a range comment, or null for a single line. */
export function rangeStart(sel: { startLine: number; endLine: number }): number | null {
  if (sel.startLine === sel.endLine) return null
  return sel.startLine
}

const wordSpansByDiff = new WeakMap<FileDiff, Map<DiffLine, Span[]>>()

function collectWordSpans(diff: FileDiff): Map<DiffLine, Span[]> {
  const byLine = new Map<DiffLine, Span[]>()
  for (const { lines } of diff.hunks) {
    for (const [removed, added] of pairReplacedLines(lines)) {
      const spans = wordSpans(lines[removed].content, lines[added].content)
      byLine.set(lines[removed], spans.old)
      byLine.set(lines[added], spans.new)
    }
  }
  return byLine
}

/** The changed-word spans of a line in a replaced pair, worked out once per diff. */
export function wordSpansFor(diff: FileDiff | null, line: DiffLine): Span[] | undefined {
  if (!diff) return undefined
  let byLine = wordSpansByDiff.get(diff)
  if (!byLine) {
    byLine = collectWordSpans(diff)
    wordSpansByDiff.set(diff, byLine)
  }
  return byLine.get(line)
}
