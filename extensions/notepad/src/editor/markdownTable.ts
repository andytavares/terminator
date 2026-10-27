// Pure parsing for GFM tables and GitHub alerts, kept free of DOM so the
// widgets in livePreview.ts stay thin and this logic stays testable.
//
// Tables are read from @lezer/markdown's GFM nodes (Table, TableHeader,
// TableRow, TableCell, TableDelimiter), the same ones the editor parses.

import { parser, GFM } from '@lezer/markdown'
import type { SyntaxNode } from '@lezer/common'

type ColumnAlign = 'left' | 'center' | 'right' | null

/**
 * A cell's text plus where that text starts, so clicking a rendered cell can
 * put the caret in the matching place in the source. Offsets are relative to
 * the source passed to parseTable.
 */
export interface TableCell {
  text: string
  offset: number
}

export interface ParsedTable {
  header: TableCell[]
  align: ColumnAlign[]
  rows: TableCell[][]
}

const gfmParser = parser.configure(GFM)

/**
 * Parses a table's source text. Returns null when the text is not a table.
 * Rows are padded or truncated to the header's column count so the rendered
 * grid is always rectangular.
 */
export function parseTable(source: string): ParsedTable | null {
  const table = gfmParser.parse(source).topNode.firstChild
  if (table?.name !== 'Table') return null

  const header = rowCells(table.getChild('TableHeader')!, source)
  const columnCount = header.length
  return {
    header,
    align: columnAlignments(table, source, columnCount),
    rows: table
      .getChildren('TableRow')
      .map((row) => padCells(rowCells(row, source), columnCount, row.to)),
  }
}

/**
 * The cells of one row. Lezer emits no TableCell for an empty cell, so each cell is the gap
 * between two pipes, and an empty gap is an empty cell just after its pipe.
 */
function rowCells(row: SyntaxNode, source: string): TableCell[] {
  const pipes = row.getChildren('TableDelimiter')
  const textNodes = row.getChildren('TableCell')
  const gapStarts = [row.from, ...pipes.map((pipe) => pipe.to)]
  const gapEnds = [...pipes.map((pipe) => pipe.from), row.to]
  const cells = gapStarts.map((start, index) => {
    const node = textNodes.find((cell) => cell.from >= start && cell.to <= gapEnds[index])
    return node
      ? { text: source.slice(node.from, node.to), offset: node.from }
      : { text: '', offset: start }
  })
  // A pipe at the very start or end of the row fences it; it does not open a column.
  if (pipes[0]?.from === row.from) cells.shift()
  if (pipes.at(-1)?.to === row.to) cells.pop()
  return cells
}

/** `:--`, `:-:`, `--:` read from the delimiter row, one entry per header column. */
function columnAlignments(table: SyntaxNode, source: string, columnCount: number): ColumnAlign[] {
  const delimiter = table.getChild('TableDelimiter')!
  const markers = source
    .slice(delimiter.from, delimiter.to)
    .split('|')
    .map((marker) => marker.trim())
    .filter(Boolean)
  return Array.from({ length: columnCount }, (_, index) => {
    const marker = markers[index] ?? ''
    if (marker.startsWith(':') && marker.endsWith(':')) return 'center'
    if (marker.endsWith(':')) return 'right'
    if (marker.startsWith(':')) return 'left'
    return null
  })
}

/** A padded cell points at the end of its row, which is where new text would go. */
function padCells(cells: TableCell[], columnCount: number, rowEnd: number): TableCell[] {
  const padding = { text: '', offset: rowEnd }
  return Array.from({ length: columnCount }, (_, index) => cells[index] ?? padding)
}

// ── Inline spans ──────────────────────────────────────────────────
// Table cells commonly carry light inline markup. Spans are flat (no nesting),
// which covers the realistic cases without pulling a full inline parser into
// the widget.

type InlineSpanType = 'text' | 'code' | 'strong' | 'em' | 'del' | 'link'

export type InlineSpan =
  | { type: Exclude<InlineSpanType, 'link'>; text: string }
  | { type: 'link'; text: string; href: string }

// Ordered by precedence: code first (its content is literal), then the
// longest markers, so ** is not mistaken for two * delimiters.
const INLINE_PATTERNS: { type: InlineSpanType; re: RegExp }[] = [
  { type: 'code', re: /`([^`]+)`/ },
  { type: 'link', re: /\[([^\]]*)\]\(([^)\s]+)\)/ },
  { type: 'strong', re: /\*\*([^*]+)\*\*/ },
  { type: 'del', re: /~~([^~]+)~~/ },
  { type: 'em', re: /\*([^*]+)\*/ },
]

/** The first inline construct in some text, by position. */
interface InlineMatch {
  type: InlineSpanType
  index: number
  match: RegExpMatchArray
}

export function parseInlineSpans(text: string): InlineSpan[] {
  if (text === '') return []

  const earliest = earliestInlineMatch(text)
  if (!earliest) return [{ type: 'text', text: unescapePipes(text) }]

  const { type, index, match } = earliest
  const before = text.slice(0, index)
  const after = text.slice(index + match[0].length)

  const span: InlineSpan =
    type === 'link'
      ? { type, text: match[1], href: match[2] }
      : { type, text: unescapePipes(match[1]) }

  return [
    ...(before ? [{ type: 'text' as const, text: unescapePipes(before) }] : []),
    span,
    ...parseInlineSpans(after),
  ]
}

function earliestInlineMatch(text: string): InlineMatch | null {
  let earliest: InlineMatch | null = null
  for (const { type, re } of INLINE_PATTERNS) {
    const match = re.exec(text)
    if (match && (earliest === null || match.index! < earliest.index)) {
      earliest = { type, index: match.index!, match }
    }
  }
  return earliest
}

/** `\|` is how a literal pipe survives cell splitting; it is not literal text. */
function unescapePipes(text: string): string {
  return text.replace(/\\\|/g, '|')
}

// ── GitHub alerts ─────────────────────────────────────────────────

/** @internal */
export const ALERT_KINDS = ['note', 'tip', 'important', 'warning', 'caution'] as const

export type AlertKind = (typeof ALERT_KINDS)[number]

const ALERT_MARKER = /^\s*>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i

/**
 * Recognises the `> [!NOTE]` marker that turns a blockquote into an alert.
 * Not a lezer construct — GFM parses these as an ordinary blockquote — so the
 * marker line is matched textually.
 */
export function parseAlertMarker(line: string): AlertKind | null {
  const match = ALERT_MARKER.exec(line)
  if (!match) return null
  return match[1].toLowerCase() as AlertKind
}

export const ALERT_LABELS: Record<AlertKind, string> = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution',
}
