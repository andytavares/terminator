import React, { useMemo } from 'react'
import { highlight } from './highlight'

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
  /** A highlight.js language or file extension; none shows plain, escaped text. */
  language?: string
  layout?: 'unified' | 'split'
  /** Split layout only: the caller moves the divider and sets `--split-left` on a parent. */
  onDividerMouseDown?: (e: React.MouseEvent) => void
}

// ── Unified view ──────────────────────────────────────────────────────────────

const LINE_PREFIX: Record<DiffViewLine['type'], string> = { add: '+', remove: '-', context: ' ' }

function UnifiedRow({
  line,
  lang,
}: {
  line: DiffViewLine
  lang: string | undefined
}): React.JSX.Element {
  const html = useMemo(() => highlight(line.content, lang), [line.content, lang])
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
  lang: string | undefined
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

function UnifiedTable({ hunks, lang }: TableProps): React.JSX.Element {
  return (
    <table className="diff-table">
      <tbody>
        {hunks.map((hunk, hi) => (
          <React.Fragment key={hi}>
            <FileHunkHeader header={hunk.header} colSpan={4} />
            {hunk.lines.map((line, li) => (
              <UnifiedRow key={`${hi}-${li}`} line={line} lang={lang} />
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

function SplitCode(props: { line: DiffViewLine; side: SplitSide; lang: string | undefined }) {
  const { line, side, lang } = props
  const html = useMemo(() => highlight(line.content, lang), [line, lang])
  return (
    <>
      <td className="diff-line__old-num">{sideLineNumber(line, side) ?? ''}</td>
      <td className={`${CONTENT_CLASS[line.type]}${sideClassOf(side)}`}>
        <pre dangerouslySetInnerHTML={{ __html: html }} />
      </td>
    </>
  )
}

function SplitCell(props: {
  line: DiffViewLine | null
  side: SplitSide
  lang: string | undefined
}) {
  if (props.line) return <SplitCode line={props.line} side={props.side} lang={props.lang} />
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
  lang: string | undefined
  onDividerMouseDown: SplitTableProps['onDividerMouseDown']
}) {
  const { oldLine, newLine, cls } = rowSides(props.row)
  return (
    <tr className={cls}>
      <SplitCell line={oldLine} side="old" lang={props.lang} />
      <td className="diff-table__split-divider" onMouseDown={props.onDividerMouseDown} />
      <SplitCell line={newLine} side="new" lang={props.lang} />
    </tr>
  )
}

function SplitTable({ hunks, lang, onDividerMouseDown }: SplitTableProps) {
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
                lang={lang}
                onDividerMouseDown={onDividerMouseDown}
              />
            ))}
          </React.Fragment>
        ))}
      </tbody>
    </table>
  )
}

/** The rows of a diff as a unified or split table. Only `highlight` output reaches the HTML. */
export function DiffView(props: DiffViewProps): React.JSX.Element {
  const { hunks, language, layout = 'unified', onDividerMouseDown = () => undefined } = props
  if (layout === 'split') {
    return <SplitTable hunks={hunks} lang={language} onDividerMouseDown={onDividerMouseDown} />
  }
  return <UnifiedTable hunks={hunks} lang={language} />
}

/** Longest-common-subsequence lengths: `lcs[i][j]` is for the tails `a[i..]` and `b[j..]`. */
function lcsTable(a: string[], b: string[]): number[][] {
  // shortcut: O(n*m) table, fine for one tool call's file; use a Myers diff for large files.
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

/** The lines of a change from its old and new text; `null` old text means a new file. */
export function linesFromTexts(oldText: string | null, newText: string): DiffViewLine[] {
  const split = (text: string): string[] => text.split('\n')
  return lineDiffOps(oldText === null ? [] : split(oldText), split(newText))
}
