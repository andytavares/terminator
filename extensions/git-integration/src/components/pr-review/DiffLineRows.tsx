import React, { memo } from 'react'
import { Plus } from 'lucide-react'
import type { DiffLine } from '../../schemas/git.schema'
import { highlight } from '../../utils/syntax'
import { choose } from '../text'
import { unifiedSide } from './diff-pane/lines'
import { markChangedWords, type Span } from './diff-pane/word-diff'
import './diff-pane/diff-rows.css'

type Side = 'LEFT' | 'RIGHT'
type Language = string | undefined

export interface GutterChip {
  kind: 'warn'
  label: string
}

const HIGHLIGHT_CACHE_CAP = 20_000
const highlightCache = new Map<string, string>()

/** Highlighting is pure in (language, line); a row re-renders on every selection change. */
function cachedHighlight(content: string, language: Language): string {
  const key = `${language}\u0000${content}`
  let html = highlightCache.get(key)
  if (html === undefined) {
    html = highlight(content, language)
    if (highlightCache.size >= HIGHLIGHT_CACHE_CAP) highlightCache.clear()
    highlightCache.set(key, html)
  }
  return html
}

/** Props every code row takes. Rows are memoised, so callers pass primitives and stable callbacks. */
interface LineRowProps {
  line: DiffLine
  expanded: boolean
  language: Language
  selected: boolean
  /** The first line of the selection, the one row that shows the comment button. */
  selectionStart: boolean
  commented: boolean
  chip: GutterChip | null
  /** Changed-word spans of a replaced line; the unified view marks them. */
  words?: Span[]
  onGutterMouseDown: (e: React.MouseEvent, lineNum: number, side: Side) => void
  onRowMouseEnter: (lineNum: number, side: Side) => void
}

function rowClassName(props: LineRowProps): string {
  const { line, expanded, selected, selectionStart, commented } = props
  return [
    `diff-line diff-line--${line.type}`,
    choose(expanded, ' diff-line--expanded', ''),
    choose(selected, ' diff-line--selecting rs-line--selected', ''),
    choose(selectionStart, ' diff-line--selection-start', ''),
    choose(commented, ' diff-line--commented', ''),
  ].join('')
}

interface GutterButtonProps {
  lineNum: number
  side: Side
  onGutterMouseDown: LineRowProps['onGutterMouseDown']
}

function GutterButton({ lineNum, side, onGutterMouseDown }: GutterButtonProps) {
  return (
    <button
      className="diff-gutter-btn"
      aria-label="Add comment"
      onMouseDown={(e) => onGutterMouseDown(e, lineNum, side)}
    >
      <Plus aria-hidden="true" />
    </button>
  )
}

function ChipCell(props: { chip: GutterChip | null; gutterWidth: number }) {
  const { chip, gutterWidth } = props
  return (
    <td
      className={choose(gutterWidth === 0, 'rs-gut rs-gut--none', 'rs-gut')}
      style={{ width: gutterWidth, minWidth: gutterWidth }}
    >
      {chip && <span className={`rs-gutter-chip rs-gutter-chip--${chip.kind}`}>{chip.label}</span>}
    </td>
  )
}

interface CodeCellsProps {
  line: DiffLine
  language: Language
  prefix: string
  words?: Span[]
}

/** The line's highlighted HTML, with its changed words marked on top of the syntax colours. */
function codeHtml({ line, language, words }: Omit<CodeCellsProps, 'prefix'>): string {
  const html = cachedHighlight(line.content, language)
  if (!words) return html
  return markChangedWords(html, words, `diff-word--${line.type}`)
}

function CodeCells(props: CodeCellsProps) {
  return (
    <>
      <td className="diff-line__prefix">{props.prefix}</td>
      <td className="diff-line__content">
        <pre dangerouslySetInnerHTML={{ __html: codeHtml(props) }} />
      </td>
    </>
  )
}

const PREFIX: Record<DiffLine['type'], string> = { add: '+', remove: '-', context: ' ' }

function expandedAttr(expanded: boolean): 'true' | undefined {
  return choose(expanded, 'true' as const, undefined)
}

/** A unified row's old and new number cells; the comment button sits on the row's side. */
function UnifiedNumbers(props: { line: DiffLine; side: Side; button: React.ReactNode }) {
  const { line, side } = props
  return (
    <>
      <td className="diff-line__old-num diff-line__num-gutter">
        {line.oldLineNumber ?? ''}
        {side === 'LEFT' && props.button}
      </td>
      <td className="diff-line__new-num diff-line__num-gutter">
        {line.newLineNumber ?? ''}
        {side === 'RIGHT' && props.button}
      </td>
    </>
  )
}

/** One unified-view code row: old and new numbers, the insight gutter, the code. */
export const UnifiedLineRow = memo(function UnifiedLineRow(
  props: LineRowProps & { gutterWidth: number }
) {
  const { line } = props
  const lineNum = line.newLineNumber ?? line.oldLineNumber ?? 0
  const side = unifiedSide(line)
  const button = (
    <GutterButton lineNum={lineNum} side={side} onGutterMouseDown={props.onGutterMouseDown} />
  )
  const chip = choose(side === 'RIGHT', props.chip, null)
  return (
    <tr
      className={rowClassName(props)}
      aria-selected={props.selected}
      data-expanded={expandedAttr(props.expanded)}
      data-new-line={line.newLineNumber ?? undefined}
      data-old-line={line.oldLineNumber ?? undefined}
      onMouseEnter={() => props.onRowMouseEnter(lineNum, side)}
    >
      <UnifiedNumbers line={line} side={side} button={button} />
      <ChipCell chip={chip} gutterWidth={props.gutterWidth} />
      <CodeCells
        line={line}
        language={props.language}
        prefix={PREFIX[line.type]}
        words={props.words}
      />
    </tr>
  )
})
