// Pure parsing for GFM tables and GitHub alerts, kept free of DOM so the
// widgets in livePreview.ts stay thin and this logic stays testable.
//
// The parser already produces Table/TableRow/TableCell nodes (GFM is enabled in
// NoteEditor), but live preview only ever styled inline constructs, so a table
// rendered as raw pipes. Cell splitting mirrors @lezer/markdown's parseRow:
// split on unescaped '|', trim each cell.

export type ColumnAlign = 'left' | 'center' | 'right' | null

export interface ParsedTable {
  header: string[]
  align: ColumnAlign[]
  rows: string[][]
}

/**
 * Splits one table row into cells on unescaped pipes, dropping the empty
 * segments produced by leading and trailing pipes. Empty interior cells are
 * kept so columns stay aligned.
 */
export function splitTableRow(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let escaped = false

  for (const char of line) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\') {
      current += char
      escaped = true
      continue
    }
    if (char === '|') {
      cells.push(current)
      current = ''
      continue
    }
    current += char
  }
  cells.push(current)

  // A row is conventionally fenced by pipes; those produce an empty leading and
  // trailing segment that is not a column.
  if (cells.length > 1 && cells[0].trim() === '') cells.shift()
  if (cells.length > 1 && cells[cells.length - 1].trim() === '') cells.pop()

  return cells.map((c) => c.trim())
}

const DELIMITER_CELL = /^:?-+:?$/

/**
 * Parses the `---|:--:|---:` row into per-column alignments. Returns null when
 * the line is not a delimiter row, which is what makes a table a table.
 */
export function parseDelimiterRow(line: string): ColumnAlign[] | null {
  const cells = splitTableRow(line)
  if (cells.length === 0) return null
  if (!cells.every((c) => DELIMITER_CELL.test(c))) return null

  return cells.map((cell) => {
    const left = cell.startsWith(':')
    const right = cell.endsWith(':')
    if (left && right) return 'center'
    if (right) return 'right'
    if (left) return 'left'
    return null
  })
}

/**
 * Parses a table's source text. Returns null when the text is not a table.
 * Rows are padded or truncated to the header's column count so the rendered
 * grid is always rectangular.
 */
export function parseTable(source: string): ParsedTable | null {
  const lines = source.split('\n')
  if (lines.length < 2) return null

  const header = splitTableRow(lines[0])
  const align = parseDelimiterRow(lines[1])
  if (!align) return null

  const columnCount = header.length
  const rows = lines
    .slice(2)
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const cells = splitTableRow(line)
      return Array.from({ length: columnCount }, (_, i) => cells[i] ?? '')
    })

  return {
    header,
    align: Array.from({ length: columnCount }, (_, i) => align[i] ?? null),
    rows,
  }
}

// ── Inline spans ──────────────────────────────────────────────────
// Table cells commonly carry light inline markup. Spans are flat (no nesting),
// which covers the realistic cases without pulling a full inline parser into
// the widget.

export type InlineSpanType = 'text' | 'code' | 'strong' | 'em' | 'del' | 'link'

export interface InlineSpan {
  type: InlineSpanType
  text: string
  href?: string
}

// Ordered by precedence: code first (its content is literal), then the
// longest markers, so ** is not mistaken for two * delimiters.
const INLINE_PATTERNS: { type: InlineSpanType; re: RegExp }[] = [
  { type: 'code', re: /`([^`]+)`/ },
  { type: 'link', re: /\[([^\]]*)\]\(([^)\s]+)\)/ },
  { type: 'strong', re: /\*\*([^*]+)\*\*/ },
  { type: 'del', re: /~~([^~]+)~~/ },
  { type: 'em', re: /\*([^*]+)\*/ },
]

export function parseInlineSpans(text: string): InlineSpan[] {
  if (text === '') return []

  let earliest: { type: InlineSpanType; index: number; match: RegExpMatchArray } | null = null
  for (const { type, re } of INLINE_PATTERNS) {
    const match = re.exec(text)
    if (match && (earliest === null || match.index! < earliest.index)) {
      earliest = { type, index: match.index!, match }
    }
  }

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

/** `\|` is how a literal pipe survives cell splitting; it is not literal text. */
function unescapePipes(text: string): string {
  return text.replace(/\\\|/g, '|')
}

// ── GitHub alerts ─────────────────────────────────────────────────

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
