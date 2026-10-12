import React, { memo } from 'react'
import type { DiffLine } from '../../schemas/git.schema'
import { highlight, type detectLanguage } from '../FileDiffView'

export type Side = 'LEFT' | 'RIGHT'
type Language = ReturnType<typeof detectLanguage>

export interface GutterChip {
  kind: 'danger' | 'warn'
  label: string
}

const HIGHLIGHT_CACHE_CAP = 20_000
const highlightCache = new Map<string, string>()

/** Highlighting is pure in (language, line); a row re-renders on every selection change. */
function highlightLine(content: string, language: Language): string {
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
    expanded ? ' diff-line--expanded' : '',
    selected ? ' diff-line--selecting rs-line--selected' : '',
    commented ? ' diff-line--commented' : '',
  ].join('')
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

interface GutterButtonProps {
  lineNum: number
  side: Side
  onGutterMouseDown: LineRowProps['onGutterMouseDown']
}

function GutterPips({
  hiddenThreadCount,
  findingCount,
  onShowHiddenComments,
}: Pick<LineRowProps, 'hiddenThreadCount' | 'findingCount' | 'onShowHiddenComments'>) {
  return (
    <>
      {hiddenThreadCount > 0 && (
        <button
          type="button"
          className="rs-pip"
          aria-label={`${hiddenThreadCount} hidden comments`}
          onClick={onShowHiddenComments}
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

function ChipCell(props: LineRowProps & { gutterWidth: number }) {
  const { chip, gutterWidth } = props
  return (
    <td className="rs-gut" style={{ width: gutterWidth, minWidth: gutterWidth }}>
      {chip && <span className={`rs-gutter-chip rs-gutter-chip--${chip.kind}`}>{chip.label}</span>}
      <GutterPips {...props} />
    </td>
  )
}

function CodeCells({
  line,
  language,
  prefix,
}: {
  line: DiffLine
  language: Language
  prefix: string
}) {
  return (
    <>
      <td className="diff-line__prefix">{prefix}</td>
      <td className="diff-line__content">
        <pre dangerouslySetInnerHTML={{ __html: highlightLine(line.content, language) }} />
      </td>
    </>
  )
}

const PREFIX: Record<DiffLine['type'], string> = { add: '+', remove: '-', context: ' ' }

/** One unified-view code row: old and new numbers, the insight gutter, the code. */
export const UnifiedLineRow = memo(function UnifiedLineRow(
  props: LineRowProps & { gutterWidth: number }
) {
  const { line, onGutterMouseDown } = props
  const lineNum = line.newLineNumber ?? line.oldLineNumber ?? 0
  const side: Side = line.type === 'remove' ? 'LEFT' : 'RIGHT'
  const button = (
    <GutterButton lineNum={lineNum} side={side} onGutterMouseDown={onGutterMouseDown} />
  )
  return (
    <tr
      className={rowClassName(props)}
      data-expanded={props.expanded ? 'true' : undefined}
      data-new-line={line.newLineNumber ?? undefined}
      data-old-line={line.oldLineNumber ?? undefined}
      onMouseEnter={() => props.onRowMouseEnter(lineNum, side)}
    >
      <td className="diff-line__old-num diff-line__num-gutter">
        {line.oldLineNumber ?? ''}
        {side === 'LEFT' && button}
      </td>
      <td className="diff-line__new-num diff-line__num-gutter">
        {line.newLineNumber ?? ''}
        {side === 'RIGHT' && button}
      </td>
      <ChipCell {...props} chip={side === 'RIGHT' ? props.chip : null} />
      <CodeCells line={line} language={props.language} prefix={PREFIX[line.type]} />
    </tr>
  )
})

/** One side of a split-view row. The left side carries its pips in the number cell; the right side has the insight gutter. */
export const SplitLineRow = memo(function SplitLineRow(
  props: LineRowProps & { side: Side; numColWidth: number; gutterWidth: number }
) {
  const { line, side, numColWidth } = props
  const lineNum = (side === 'LEFT' ? line.oldLineNumber : line.newLineNumber) ?? 0
  return (
    <tr
      className={rowClassName(props)}
      data-expanded={props.expanded ? 'true' : undefined}
      data-old-line={side === 'LEFT' ? (line.oldLineNumber ?? undefined) : undefined}
      data-new-line={side === 'RIGHT' ? (line.newLineNumber ?? undefined) : undefined}
      onMouseEnter={() => props.onRowMouseEnter(lineNum, side)}
    >
      <td
        className={`diff-line__${side === 'LEFT' ? 'old' : 'new'}-num diff-line__num-gutter`}
        style={{ width: numColWidth, minWidth: numColWidth }}
      >
        {lineNum || ''}
        <GutterButton lineNum={lineNum} side={side} onGutterMouseDown={props.onGutterMouseDown} />
        {side === 'LEFT' && <GutterPips {...props} />}
      </td>
      {side === 'RIGHT' && <ChipCell {...props} />}
      <CodeCells
        line={line}
        language={props.language}
        prefix={line.type === (side === 'LEFT' ? 'remove' : 'add') ? PREFIX[line.type] : ' '}
      />
    </tr>
  )
})
