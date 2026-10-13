import React from 'react'
import { ChevronDown, ChevronUp, TriangleAlert, UnfoldVertical } from 'lucide-react'
import { MovedRow } from '../MovedRow'
import { SplitLineRow, UnifiedLineRow } from '../DiffLineRows'
import { EXPAND_STEP } from '../../../review/expand-gaps'
import type { DiffItem, MovedMark } from '../../../review/diff-items'
import type { DiffHunk, DiffLine } from '../../../schemas/git.schema'
import { plural } from '../../text'
import type { PaneContext, Side } from './types'
import {
  AnnotationContent,
  hasAnnotations,
  LineAnnotations,
  OpenTests,
  SelectionExtras,
} from './annotations'
import { hunkCode, unifiedSide } from './lines'

interface LineRef {
  ctx: PaneContext
  lineNum: number
  side: Side
}

interface UnifiedLineProps {
  ctx: PaneContext
  line: DiffLine
  expanded: boolean
}

interface SplitSideProps {
  ctx: PaneContext
  line: DiffLine | null | undefined
  side: Side
  expanded: boolean
}

interface SplitPairProps {
  ctx: PaneContext
  left: DiffLine | null | undefined
  right: DiffLine | null | undefined
  expanded: boolean
}

interface ExpandButtonProps {
  label: string
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}

interface TestsButtonProps {
  ctx: PaneContext
  anchor: string
  code: string
  hunkHeader?: string
}

type ItemOf<K extends DiffItem['kind']> = Extract<DiffItem, { kind: K }>

type ItemRenderers = {
  [K in DiffItem['kind']]: (ctx: PaneContext, item: ItemOf<K>) => React.ReactNode
}

// A unified row's number cells carry 28px of padding and a 1px border; the insight gutter 8px of padding.
const NUM_CELL_CHROME_PX = 29
const GUTTER_CELL_PADDING_PX = 8

function chipOn(props: LineRef) {
  const { ctx, lineNum, side } = props
  if (side !== 'RIGHT') return null
  return ctx.lookups.chipsByLine.get(lineNum) ?? null
}

/** Threads hidden by the "hidden" setting still show as a count in the gutter. */
function hiddenThreadCount(props: LineRef): number {
  const { ctx, lineNum, side } = props
  if (ctx.actions.commentVisibility !== 'hidden') return 0
  return ctx.lookups.threadsForLine(lineNum, side).length
}

/** With agent notes off, a line's findings show as a count in the gutter instead. */
function gutterFindingCount(props: LineRef): number {
  const { ctx, lineNum, side } = props
  if (ctx.actions.agentNotesOn) return 0
  return ctx.lookups.findingsForLine(lineNum, side).length
}

/** What a memoised row shows for its line, as primitives so unchanged rows skip rendering. */
function rowProps(at: LineRef, expanded: boolean) {
  const { ctx, lineNum, side } = at
  return {
    expanded,
    language: ctx.lang,
    selected: ctx.drag.isLineSelected(lineNum, side),
    commented: ctx.lookups.isCommented(lineNum, side),
    chip: chipOn(at),
    hiddenThreadCount: hiddenThreadCount(at),
    findingCount: gutterFindingCount(at),
    gutterWidth: ctx.lookups.gutterWidth,
    onGutterMouseDown: ctx.drag.onGutterMouseDown,
    onRowMouseEnter: ctx.drag.onRowMouseEnter,
    onShowHiddenComments: ctx.actions.showHiddenComments,
  }
}

export function UnifiedTable(props: { ctx: PaneContext; children: React.ReactNode }) {
  const { ctx, children } = props
  const { numColWidth } = ctx.layout
  return (
    <table className="diff-table diff-table--review diff-table--row">
      <colgroup>
        <col style={{ width: numColWidth + NUM_CELL_CHROME_PX }} />
        <col style={{ width: numColWidth + NUM_CELL_CHROME_PX }} />
        <col style={{ width: ctx.lookups.gutterWidth + GUTTER_CELL_PADDING_PX }} />
        <col className="diff-col--prefix" />
        <col />
      </colgroup>
      <tbody>{children}</tbody>
    </table>
  )
}

function UnifiedLine(props: UnifiedLineProps) {
  const { ctx, line, expanded } = props
  const at = {
    ctx,
    lineNum: line.newLineNumber ?? line.oldLineNumber ?? 0,
    side: unifiedSide(line),
  }
  return (
    <>
      <UnifiedLineRow line={line} {...rowProps(at, expanded)} />
      <SelectionExtras ctx={ctx} lineNum={at.lineNum} side={at.side} />
      <LineAnnotations ctx={ctx} lineNum={at.lineNum} side={at.side} />
    </>
  )
}

function splitLineNum(line: DiffLine | null | undefined, side: Side): number {
  if (side === 'LEFT') return line?.oldLineNumber ?? 0
  return line?.newLineNumber ?? 0
}

/** The width of one side of the split, as a percentage. */
function sidePct(ctx: PaneContext, side: Side): number {
  if (side === 'LEFT') return ctx.layout.splitLeftPct
  return 100 - ctx.layout.splitLeftPct
}

const EMPTY_SPAN: Record<Side, number> = { LEFT: 3, RIGHT: 4 }

function SplitCodeTable(props: SplitSideProps) {
  const { ctx, line, side, expanded } = props
  const lineNum = splitLineNum(line, side)
  const sideClass = side.toLowerCase()
  return (
    <table
      className={`diff-table diff-table--split diff-table--${sideClass}`}
      style={{ width: `${sidePct(ctx, side)}%` }}
    >
      <tbody>
        {line && (
          <SplitLineRow
            line={line}
            side={side}
            numColWidth={ctx.layout.numColWidth}
            {...rowProps({ ctx, lineNum, side }, expanded)}
          />
        )}
        {!line && (
          <tr className="diff-line">
            <td colSpan={EMPTY_SPAN[side]} className="diff-line__empty-cell" />
          </tr>
        )}
      </tbody>
    </table>
  )
}

/** True when the side's line carries a composer, threads or other annotations. */
function sideAnnotated(props: Omit<SplitSideProps, 'expanded'>): boolean {
  const { ctx, line, side } = props
  if (line == null) return false
  return hasAnnotations({ ctx, lineNum: splitLineNum(line, side), side })
}

function SplitComments(props: Omit<SplitSideProps, 'expanded'>) {
  const { ctx, line, side } = props
  const annotated = sideAnnotated({ ctx, line, side })
  return (
    <div className="diff-table--split" style={{ width: `${sidePct(ctx, side)}%` }}>
      {annotated && (
        <div
          className="diff-split-comment-inner"
          style={{ paddingLeft: ctx.layout.numColWidth + 18 }}
        >
          <AnnotationContent ctx={ctx} lineNum={splitLineNum(line, side)} side={side} />
        </div>
      )}
    </div>
  )
}

/** One flex row per line pair, then a comment row with the same classes, so the two align. */
function SplitPair(props: SplitPairProps) {
  const { ctx, left, right, expanded } = props
  const divider = ctx.layout.onSplitDividerMouseDown
  const hasComments =
    sideAnnotated({ ctx, line: left, side: 'LEFT' }) ||
    sideAnnotated({ ctx, line: right, side: 'RIGHT' })
  return (
    <>
      <div className="diff-split-tables">
        <SplitCodeTable ctx={ctx} line={left} side="LEFT" expanded={expanded} />
        <div className="diff-split-resize-handle" onMouseDown={divider} />
        <SplitCodeTable ctx={ctx} line={right} side="RIGHT" expanded={expanded} />
      </div>
      {hasComments && (
        <div className="diff-split-tables">
          <SplitComments ctx={ctx} line={left} side="LEFT" />
          <div className="diff-split-resize-handle" onMouseDown={divider} />
          <SplitComments ctx={ctx} line={right} side="RIGHT" />
        </div>
      )}
    </>
  )
}

function ExpandButton(props: ExpandButtonProps) {
  return (
    <button
      aria-label={props.label}
      type="button"
      className="diff-gap-btn"
      disabled={props.disabled}
      title={props.label}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}

function allLinesLabels(hidden: number | null): { label: string; text: string } {
  if (hidden == null) return { label: 'Show all lines', text: 'All lines' }
  return { label: `Show all ${hidden} lines`, text: `${hidden} lines` }
}

const STEP_BUTTONS = {
  below: { skipAt: 'top', label: `Show ${EXPAND_STEP} lines below`, Icon: ChevronDown },
  above: { skipAt: 'bottom', label: `Show ${EXPAND_STEP} lines above`, Icon: ChevronUp },
} as const

/** Reveals EXPAND_STEP more lines on one side of the gap; the file's edges have no such side. */
function StepButton(props: { ctx: PaneContext; gapKey: string; kind: 'above' | 'below' }) {
  const step = STEP_BUTTONS[props.kind]
  const { Icon } = step
  if (props.gapKey === step.skipAt) return null
  return (
    <ExpandButton
      label={step.label}
      disabled={props.ctx.gaps.fileText.status === 'loading'}
      onClick={() => props.ctx.gaps.expandGap(props.gapKey, props.kind)}
    >
      <Icon aria-hidden="true" />
    </ExpandButton>
  )
}

function ExpandButtons(props: { ctx: PaneContext; gapKey: string; hidden: number | null }) {
  const { ctx, gapKey } = props
  const all = allLinesLabels(props.hidden)
  return (
    <>
      <StepButton ctx={ctx} gapKey={gapKey} kind="below" />
      <ExpandButton
        label={all.label}
        disabled={ctx.gaps.fileText.status === 'loading'}
        onClick={() => ctx.gaps.expandGap(gapKey, 'all')}
      >
        <UnfoldVertical aria-hidden="true" />
        <span>{all.text}</span>
      </ExpandButton>
      <StepButton ctx={ctx} gapKey={gapKey} kind="above" />
    </>
  )
}

function ExpanderContent(props: { ctx: PaneContext; gapKey: string; hidden: number | null }) {
  const { fileText, loadFileText } = props.ctx.gaps
  if (fileText.status === 'tooLarge') {
    return <span className="diff-gap-msg">This file is too large to expand here.</span>
  }
  if (fileText.status === 'error') {
    return (
      <>
        <span className="diff-gap-msg">{fileText.message}</span>
        <button type="button" className="diff-gap-btn" onClick={loadFileText}>
          Retry
        </button>
      </>
    )
  }
  return <ExpandButtons {...props} />
}

function GapExpander(props: { ctx: PaneContext; gapKey: string; hidden: number | null }) {
  const { ctx, gapKey, hidden } = props
  const content = <ExpanderContent ctx={ctx} gapKey={gapKey} hidden={hidden} />
  if (ctx.mode !== 'unified') return <div className="diff-gap-row">{content}</div>
  return (
    <UnifiedTable ctx={ctx}>
      <tr className="diff-gap-row">
        <td colSpan={5}>{content}</td>
      </tr>
    </UnifiedTable>
  )
}

function TestsButton(props: TestsButtonProps) {
  const { ctx, anchor, code, hunkHeader } = props
  const open = (e: React.MouseEvent) => {
    e.stopPropagation()
    ctx.tests.openTests(anchor, code, hunkHeader)
  }
  return (
    <>
      <button
        aria-label="Jump to the tests for this block"
        type="button"
        className="rs-hunk-tests"
        onClick={open}
      >
        Tests
      </button>
      <OpenTests ctx={ctx} anchor={anchor} />
    </>
  )
}

function HunkHeader(props: { ctx: PaneContext; hunk: DiffHunk; hunkIndex: number }) {
  const { ctx, hunk, hunkIndex } = props
  const bar = (
    <div className="rs-hunk-bar">
      <span className="rs-hunk-bar__text">{hunk.header}</span>
      <TestsButton
        ctx={ctx}
        anchor={`hunk-${hunkIndex}`}
        code={hunkCode(hunk.lines)}
        hunkHeader={hunk.header}
      />
    </div>
  )
  if (ctx.mode !== 'unified') return <div className="diff-split-header rs-hunk-anchor">{bar}</div>
  return (
    <UnifiedTable ctx={ctx}>
      <tr>
        <td colSpan={5} className="diff-hunk-header rs-hunk-anchor">
          {bar}
        </td>
      </tr>
    </UnifiedTable>
  )
}

/** Where the moved block's other end is: its origin for a block moved here, else its destination. */
function otherEnd(mark: MovedMark): { path: string; line: number } {
  const { block } = mark
  if (mark.side === 'RIGHT') return { path: block.fromPath, line: block.fromLine }
  return { path: block.toPath, line: block.toLine }
}

function MovedRowFor(props: { ctx: PaneContext; mark: MovedMark }) {
  const { ctx, mark } = props
  const other = otherEnd(mark)
  return (
    <MovedRow
      symbol={mark.block.symbol}
      lineCount={mark.block.lineCount}
      otherPath={other.path}
      otherLine={other.line}
      direction={(mark.side === 'RIGHT' && 'here') || 'away'}
      expanded={mark.expanded}
      onToggleShow={() => ctx.actions.toggleMoved(mark.key)}
      onGoToOrigin={() => ctx.actions.goToPath(other.path)}
    />
  )
}

function FormattingNotice(props: { ctx: PaneContext; hiddenCount: number }) {
  const { ctx, hiddenCount } = props
  return (
    <div className="review-diff-formatting-notice">
      {hiddenCount} formatting-only {plural(hiddenCount, 'hunk')} hidden —{' '}
      <button
        className="review-diff-formatting-show-btn"
        onClick={() => ctx.actions.setHideFormattingHunks(false)}
      >
        show all
      </button>
    </div>
  )
}

function UnifiedItem(props: { ctx: PaneContext; line: DiffLine; moved: MovedMark | null }) {
  const { ctx, line, moved } = props
  return (
    <UnifiedTable ctx={ctx}>
      {moved?.isStart && (
        <tr>
          <td colSpan={5}>
            <MovedRowFor ctx={ctx} mark={moved} />
          </td>
        </tr>
      )}
      <UnifiedLine ctx={ctx} line={line} expanded={false} />
    </UnifiedTable>
  )
}

function SplitItem(props: { ctx: PaneContext; item: ItemOf<'split-row'> }) {
  const { ctx, item } = props
  return (
    <>
      {item.movedLeft?.isStart && <MovedRowFor ctx={ctx} mark={item.movedLeft} />}
      {item.movedRight?.isStart && <MovedRowFor ctx={ctx} mark={item.movedRight} />}
      <SplitPair ctx={ctx} left={item.left} right={item.right} expanded={false} />
    </>
  )
}

/** A revealed unchanged line: one row in the unified view, both sides in the split view. */
function GapLine(props: { ctx: PaneContext; line: DiffLine }) {
  const { ctx, line } = props
  if (ctx.mode !== 'unified') return <SplitPair expanded ctx={ctx} left={line} right={line} />
  return (
    <UnifiedTable ctx={ctx}>
      <UnifiedLine expanded ctx={ctx} line={line} />
    </UnifiedTable>
  )
}

function Hotspot(props: { message: string }) {
  const { message } = props
  return (
    <div className="complexity-hotspot-annotation" role="alert">
      <TriangleAlert aria-hidden="true" /> {message}
    </div>
  )
}

const ITEM_RENDERERS: ItemRenderers = {
  notice: (ctx, item) => <FormattingNotice ctx={ctx} hiddenCount={item.hiddenCount} />,
  'hunk-header': (ctx, item) => (
    <HunkHeader ctx={ctx} hunk={item.hunk} hunkIndex={item.hunkIndex} />
  ),
  line: (ctx, item) => <UnifiedItem ctx={ctx} line={item.line} moved={item.moved} />,
  'split-row': (ctx, item) => <SplitItem ctx={ctx} item={item} />,
  'gap-line': (ctx, item) => <GapLine ctx={ctx} line={item.line} />,
  'gap-expander': (ctx, item) => (
    <GapExpander ctx={ctx} gapKey={item.gapKey} hidden={item.hidden} />
  ),
  hotspot: (_ctx, item) => <Hotspot message={item.message} />,
}

/** One entry of the virtual list. */
export function renderDiffItem(ctx: PaneContext, item: DiffItem): React.ReactNode {
  const render = ITEM_RENDERERS[item.kind] as (ctx: PaneContext, item: DiffItem) => React.ReactNode
  return render(ctx, item)
}
