import React, { useMemo } from 'react'

/** One line of a diff. Plain data, so any source (git, ACP old and new text) can fill it. */
export interface DiffViewLine {
  type: 'add' | 'remove' | 'context'
  content: string
  oldLineNumber: number | null
  newLineNumber: number | null
}

export interface DiffViewHunk {
  header: string
  lines: DiffViewLine[]
}

export interface DiffViewProps {
  hunks: DiffViewHunk[]
  /** Turns a line into HTML, for syntax highlighting. It must escape what it does not mark up.
   * Absent: plain, escaped text. The caller brings the highlighter, so this package bundles none. */
  toHtml?: (code: string) => string
  layout?: 'unified' | 'split'
  /** Split layout only: the caller moves the divider and sets `--split-left` on a parent. */
  onDividerMouseDown?: (e: React.MouseEvent) => void
}

// ── Unified view ──────────────────────────────────────────────────────────────

type ToHtml = (code: string) => string

function escapeHtml(code: string): string {
  return code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const LINE_PREFIX: Record<DiffViewLine['type'], string> = { add: '+', remove: '-', context: ' ' }

function UnifiedRow({ line, toHtml }: { line: DiffViewLine; toHtml: ToHtml }): React.JSX.Element {
  const html = useMemo(() => toHtml(line.content), [line.content, toHtml])
  return (
    <tr className={`diff-line diff-line--${line.type}`}>
      <td className="diff-line__old-num">{line.oldLineNumber ?? ''}</td>
      <td className="diff-line__new-num">{line.newLineNumber ?? ''}</td>
      <td className="diff-line__prefix">{LINE_PREFIX[line.type]}</td>
      <td className="diff-line__content">
        <pre dangerouslySetInnerHTML={{ __html: html }} />
      </td>
    </tr>
  )
}

interface TableProps {
  hunks: DiffViewHunk[]
  toHtml: ToHtml
}

function FileHunkHeader(props: { header: string; colSpan: number }) {
  return (
    <tr>
      <td colSpan={props.colSpan} className="diff-hunk-header">
        {props.header}
      </td>
    </tr>
  )
}

function UnifiedTable({ hunks, toHtml }: TableProps): React.JSX.Element {
  return (
    <table className="diff-table">
      <tbody>
        {hunks.map((hunk, hi) => (
          <React.Fragment key={hi}>
            <FileHunkHeader header={hunk.header} colSpan={4} />
            {hunk.lines.map((line, li) => (
              <UnifiedRow key={`${hi}-${li}`} line={line} toHtml={toHtml} />
            ))}
          </React.Fragment>
        ))}
      </tbody>
    </table>
  )
}

// ── Split view ────────────────────────────────────────────────────────────────

export type SplitRow =
  | { kind: 'context'; line: DiffViewLine }
  | { kind: 'change'; oldLine: DiffViewLine | null; newLine: DiffViewLine | null }

/** The lines of `type` starting at `start`. */
function runOf(lines: DiffViewLine[], start: number, type: DiffViewLine['type']): DiffViewLine[] {
  const run: DiffViewLine[] = []
  while (start + run.length < lines.length && lines[start + run.length].type === type) {
    run.push(lines[start + run.length])
  }
  return run
}

/** Removed and added lines side by side, row by row; the longer side runs on alone. */
function pairChanges(removes: DiffViewLine[], adds: DiffViewLine[]): SplitRow[] {
  const count = Math.max(removes.length, adds.length)
  return Array.from({ length: count }, (_, j) => ({
    kind: 'change' as const,
    oldLine: removes[j] ?? null,
    newLine: adds[j] ?? null,
  }))
}

export function buildSplitRows(lines: DiffViewLine[]): SplitRow[] {
  const rows: SplitRow[] = []
  let i = 0
  while (i < lines.length) {
    if (lines[i].type === 'context') {
      rows.push({ kind: 'context', line: lines[i++] })
      continue
    }
    const removes = runOf(lines, i, 'remove')
    const adds = runOf(lines, i + removes.length, 'add')
    rows.push(...pairChanges(removes, adds))
    i += removes.length + adds.length
  }
  return rows
}

type SplitSide = 'old' | 'new'

const CONTENT_CLASS: Record<DiffViewLine['type'], string> = {
  remove: 'diff-line__content diff-line__content--remove',
  add: 'diff-line__content diff-line__content--add',
  context: 'diff-line__content',
}

function sideClassOf(side: SplitSide): string {
  if (side === 'old') return ' diff-line__content--old-side'
  return ' diff-line__content--new-side'
}

function sideLineNumber(line: DiffViewLine, side: SplitSide): number | null | undefined {
  if (side === 'old') return line.oldLineNumber
  return line.newLineNumber
}

function SplitCode(props: { line: DiffViewLine; side: SplitSide; toHtml: ToHtml }) {
  const { line, side, toHtml } = props
  const html = useMemo(() => toHtml(line.content), [line, toHtml])
  return (
    <>
      <td className="diff-line__old-num">{sideLineNumber(line, side) ?? ''}</td>
      <td className={`${CONTENT_CLASS[line.type]}${sideClassOf(side)}`}>
        <pre dangerouslySetInnerHTML={{ __html: html }} />
      </td>
    </>
  )
}

function SplitCell(props: { line: DiffViewLine | null; side: SplitSide; toHtml: ToHtml }) {
  if (props.line) return <SplitCode line={props.line} side={props.side} toHtml={props.toHtml} />
  return (
    <>
      <td className="diff-line__old-num" />
      <td className={`diff-line__content diff-line__content--empty${sideClassOf(props.side)}`} />
    </>
  )
}

interface SplitTableProps extends TableProps {
  onDividerMouseDown: (e: React.MouseEvent) => void
}

function rowSides(row: SplitRow): {
  oldLine: DiffViewLine | null
  newLine: DiffViewLine | null
  cls: string
} {
  if (row.kind === 'context') {
    return { oldLine: row.line, newLine: row.line, cls: 'diff-line diff-line--context' }
  }
  return { oldLine: row.oldLine, newLine: row.newLine, cls: 'diff-line' }
}

function SplitTableRow(props: {
  row: SplitRow
  toHtml: ToHtml
  onDividerMouseDown: SplitTableProps['onDividerMouseDown']
}) {
  const { oldLine, newLine, cls } = rowSides(props.row)
  return (
    <tr className={cls}>
      <SplitCell line={oldLine} side="old" toHtml={props.toHtml} />
      <td className="diff-table__split-divider" onMouseDown={props.onDividerMouseDown} />
      <SplitCell line={newLine} side="new" toHtml={props.toHtml} />
    </tr>
  )
}

function SplitTable({ hunks, toHtml, onDividerMouseDown }: SplitTableProps) {
  return (
    <table className="diff-table diff-table--split">
      <tbody>
        {hunks.map((hunk, hi) => (
          <React.Fragment key={hi}>
            <FileHunkHeader header={hunk.header} colSpan={5} />
            {buildSplitRows(hunk.lines).map((row, ri) => (
              <SplitTableRow
                key={ri}
                row={row}
                toHtml={toHtml}
                onDividerMouseDown={onDividerMouseDown}
              />
            ))}
          </React.Fragment>
        ))}
      </tbody>
    </table>
  )
}

/** The rows of a diff as a unified or split table. Only `toHtml` or escaped text reaches the HTML. */
export function DiffView(props: DiffViewProps): React.JSX.Element {
  const {
    hunks,
    toHtml = escapeHtml,
    layout = 'unified',
    onDividerMouseDown = () => undefined,
  } = props
  if (layout === 'split') {
    return <SplitTable hunks={hunks} toHtml={toHtml} onDividerMouseDown={onDividerMouseDown} />
  }
  return <UnifiedTable hunks={hunks} toHtml={toHtml} />
}

/** Longest-common-subsequence lengths: `lcs[i][j]` is for the tails `a[i..]` and `b[j..]`. */
function lcsTable(a: string[], b: string[]): number[][] {
  // shortcut: O(n*m) table, capped by MAX_COMPARED_CELLS; a Myers diff would compare larger files.
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  return lcs
}

/** The lines of a whole-file diff. */
function lineDiffOps(a: string[], b: string[]): DiffViewLine[] {
  const lcs = lcsTable(a, b)
  const lines: DiffViewLine[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    const removeNext = j >= b.length || (i < a.length && lcs[i + 1][j] >= lcs[i][j + 1])
    if (i < a.length && j < b.length && a[i] === b[j]) {
      lines.push({ type: 'context', content: a[i], oldLineNumber: ++i, newLineNumber: ++j })
    } else if (removeNext) {
      lines.push({ type: 'remove', content: a[i], oldLineNumber: ++i, newLineNumber: null })
    } else {
      lines.push({ type: 'add', content: b[j], oldLineNumber: null, newLineNumber: ++j })
    }
  }
  return lines
}

/** The lines of a change from its old and new text. `null` old text shows every line as added;
 *  it does not mean a new file (an agent sends it for an inserted snippet too). */
export function linesFromTexts(oldText: string | null, newText: string): DiffViewLine[] {
  // A final newline ends the last line; it does not start another one.
  const split = (text: string): string[] => text.replace(/\n$/, '').split('\n')
  const before = oldText === null ? [] : split(oldText)
  const after = split(newText)
  if (before.length * after.length > MAX_COMPARED_CELLS) return replacedWhole(before, after)
  return lineDiffOps(before, after)
}

/** Past this many line pairs the table costs too much for a view; ~700 lines against ~700. */
const MAX_COMPARED_CELLS = 500_000

/** Every old line removed, then every new line added: what a change too large to compare shows. */
function replacedWhole(before: string[], after: string[]): DiffViewLine[] {
  return [
    ...before.map((content, i) => ({
      type: 'remove' as const,
      content,
      oldLineNumber: i + 1,
      newLineNumber: null,
    })),
    ...after.map((content, i) => ({
      type: 'add' as const,
      content,
      oldLineNumber: null,
      newLineNumber: i + 1,
    })),
  ]
}
