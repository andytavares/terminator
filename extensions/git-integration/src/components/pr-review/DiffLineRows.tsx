import React, { memo } from 'react'
import type { DiffLine } from '../../schemas/git.schema'
import { highlight, type detectLanguage } from '../FileDiffView'
import { choose } from '../text'
import { unifiedSide } from './diff-pane/lines'

export type Side = 'LEFT' | 'RIGHT'
type Language = ReturnType<typeof detectLanguage>

export interface GutterChip {
  kind: 'danger' | 'warn'
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
  commented: boolean
  chip: GutterChip | null
  hiddenThreadCount: number
  findingCount: number
  onGutterMouseDown: (e: React.MouseEvent, lineNum: number, side: Side) => void
  onRowMouseEnter: (lineNum: number, side: Side) => void
  onShowHiddenComments: () => void
}

function rowClassName(props: LineRowProps): string {
  const { line, expanded, selected, commented } = props
  return [
    `diff-line diff-line--${line.type}`,
    choose(expanded, ' diff-line--expanded', ''),
    choose(selected, ' diff-line--selecting rs-line--selected', ''),
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
      +
    </button>
  )
}

type PipProps = Pick<LineRowProps, 'hiddenThreadCount' | 'findingCount' | 'onShowHiddenComments'>

function GutterPips(props: PipProps) {
  const { hiddenThreadCount, findingCount } = props
  return (
    <>
      {hiddenThreadCount > 0 && (
        <button
          type="button"
          className="rs-pip"
          aria-label={`${hiddenThreadCount} hidden comments`}
          onClick={props.onShowHiddenComments}
        >
          {hiddenThreadCount}
        </button>
      )}
      {findingCount > 0 && (
        <span className="rs-pip rs-pip--ag" aria-label={`${findingCount} agent notes`}>
          {findingCount}
        </span>
      )}
    </>
  )
}

/** The pips for a row, passed on prop by prop. */
function RowPips({ row }: { row: PipProps }) {
  return (
    <GutterPips
      hiddenThreadCount={row.hiddenThreadCount}
      findingCount={row.findingCount}
      onShowHiddenComments={row.onShowHiddenComments}
    />
  )
}

function ChipCell(props: { row: PipProps; chip: GutterChip | null; gutterWidth: number }) {
  const { chip, gutterWidth } = props
  return (
    <td className="rs-gut" style={{ width: gutterWidth, minWidth: gutterWidth }}>
      {chip && <span className={`rs-gutter-chip rs-gutter-chip--${chip.kind}`}>{chip.label}</span>}
      <RowPips row={props.row} />
    </td>
  )
}

interface CodeCellsProps {
  line: DiffLine
  language: Language
  prefix: string
}

function CodeCells({ line, language, prefix }: CodeCellsProps) {
  return (
    <>
      <td className="diff-line__prefix">{prefix}</td>
      <td className="diff-line__content">
        <pre dangerouslySetInnerHTML={{ __html: cachedHighlight(line.content, language) }} />
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
      data-expanded={expandedAttr(props.expanded)}
      data-new-line={line.newLineNumber ?? undefined}
      data-old-line={line.oldLineNumber ?? undefined}
      onMouseEnter={() => props.onRowMouseEnter(lineNum, side)}
    >
      <UnifiedNumbers line={line} side={side} button={button} />
      <ChipCell row={props} chip={chip} gutterWidth={props.gutterWidth} />
      <CodeCells line={line} language={props.language} prefix={PREFIX[line.type]} />
    </tr>
  )
})

/** What a split row shows for its side: number, data attributes, number-cell class, prefix. */
function splitSideView(line: DiffLine, side: Side) {
  if (side === 'LEFT') {
    return {
      lineNum: line.oldLineNumber ?? 0,
      attrs: { 'data-old-line': line.oldLineNumber ?? undefined },
      numClass: 'diff-line__old-num diff-line__num-gutter',
      prefix: choose(line.type === 'remove', PREFIX[line.type], ' '),
    }
  }
  return {
    lineNum: line.newLineNumber ?? 0,
    attrs: { 'data-new-line': line.newLineNumber ?? undefined },
    numClass: 'diff-line__new-num diff-line__num-gutter',
    prefix: choose(line.type === 'add', PREFIX[line.type], ' '),
  }
}

/** One side of a split-view row. The left side carries its pips in the number cell; the right side has the insight gutter. */
export const SplitLineRow = memo(function SplitLineRow(
  props: LineRowProps & { side: Side; numColWidth: number; gutterWidth: number }
) {
  const { line, side, numColWidth } = props
  const view = splitSideView(line, side)
  const { lineNum } = view
  return (
    <tr
      className={rowClassName(props)}
      data-expanded={expandedAttr(props.expanded)}
      {...view.attrs}
      onMouseEnter={() => props.onRowMouseEnter(lineNum, side)}
    >
      <td className={view.numClass} style={{ width: numColWidth, minWidth: numColWidth }}>
        {lineNum || ''}
        <GutterButton lineNum={lineNum} side={side} onGutterMouseDown={props.onGutterMouseDown} />
        {side === 'LEFT' && <RowPips row={props} />}
      </td>
      {side === 'RIGHT' && (
        <ChipCell row={props} chip={props.chip} gutterWidth={props.gutterWidth} />
      )}
      <CodeCells line={line} language={props.language} prefix={view.prefix} />
    </tr>
  )
})
