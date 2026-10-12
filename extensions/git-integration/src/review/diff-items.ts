import type { DiffHunk, DiffLine } from '../schemas/git.schema'
import type { MovedBlock } from '../schemas/pr-review.schema'
import type { SplitRow } from '../components/FileDiffView'

type Side = 'LEFT' | 'RIGHT'

/** A moved-code block touching one line, with whether that line opens it and whether it is shown. */
export interface MovedMark {
  block: MovedBlock
  side: Side
  key: string
  isStart: boolean
  expanded: boolean
}

export interface GapView {
  above: DiffLine[]
  hidden: number | null
  below: DiffLine[]
}

/**
 * One entry of the review diff's virtual list. Each renders as its own block so
 * the list can mount only the entries near the viewport.
 */
export type DiffItem =
  | { kind: 'notice'; key: string; hiddenCount: number }
  | { kind: 'gap-line'; key: string; line: DiffLine }
  | { kind: 'gap-expander'; key: string; gapKey: string; hidden: number | null }
  | { kind: 'hunk-header'; key: string; hunkIndex: number; hunk: DiffHunk }
  | { kind: 'line'; key: string; line: DiffLine; moved: MovedMark | null }
  | {
      kind: 'split-row'
      key: string
      left: DiffLine | null
      right: DiffLine | null
      movedLeft: MovedMark | null
      movedRight: MovedMark | null
    }
  | { kind: 'hotspot'; key: string; message: string }

export interface DiffItemSource {
  mode: 'unified' | 'split'
  hunkCount: number
  visibleHunks: Array<{ hunk: DiffHunk; index: number }>
  splitRows: SplitRow[][]
  gapViews: Map<string, GapView>
  hotspots: Array<{ hunkIndex: number; message: string }>
  movedMark: (lineNum: number, side: Side) => MovedMark | null
}

/** A line inside a collapsed moved block is hidden; the block's first line stays as its anchor. */
function hiddenByMove(mark: MovedMark | null): boolean {
  return mark !== null && !mark.isStart && !mark.expanded
}

function gapItems(source: DiffItemSource, gapKey: string): DiffItem[] {
  const view = source.gapViews.get(gapKey)
  if (!view) return []
  if (view.hidden === 0 && view.above.length + view.below.length === 0) return []
  const lineItems = (lines: DiffLine[], part: string): DiffItem[] =>
    lines.map((line) => ({
      kind: 'gap-line',
      key: `${gapKey}-${part}-${line.newLineNumber}`,
      line,
    }))
  const expander: DiffItem[] =
    view.hidden === 0
      ? []
      : [{ kind: 'gap-expander', key: `${gapKey}-expander`, gapKey, hidden: view.hidden }]
  return [...lineItems(view.above, 'above'), ...expander, ...lineItems(view.below, 'below')]
}

function unifiedItems(source: DiffItemSource, hunk: DiffHunk, hunkIndex: number): DiffItem[] {
  const items: DiffItem[] = []
  hunk.lines.forEach((line, lineIndex) => {
    const lineNum = line.newLineNumber ?? line.oldLineNumber ?? 0
    const moved = source.movedMark(lineNum, line.type === 'remove' ? 'LEFT' : 'RIGHT')
    if (hiddenByMove(moved)) return
    items.push({ kind: 'line', key: `${hunkIndex}-${lineIndex}`, line, moved })
  })
  return items
}

function splitItems(source: DiffItemSource, hunkIndex: number): DiffItem[] {
  const items: DiffItem[] = []
  source.splitRows[hunkIndex].forEach((row, rowIndex) => {
    const left = (row.kind === 'context' ? row.line : row.oldLine) ?? null
    const right = (row.kind === 'context' ? row.line : row.newLine) ?? null
    const movedLeft = left ? source.movedMark(left.oldLineNumber ?? 0, 'LEFT') : null
    const movedRight = right ? source.movedMark(right.newLineNumber ?? 0, 'RIGHT') : null
    if (hiddenByMove(movedLeft) || hiddenByMove(movedRight)) return
    items.push({
      kind: 'split-row',
      key: `${hunkIndex}-row-${rowIndex}`,
      left,
      right,
      movedLeft,
      movedRight,
    })
  })
  return items
}

function hunkItems(source: DiffItemSource, hunk: DiffHunk, hunkIndex: number): DiffItem[] {
  const hotspot = source.hotspots.find((h) => h.hunkIndex === hunkIndex)
  return [
    ...(hunkIndex === 0 ? gapItems(source, 'top') : []),
    { kind: 'hunk-header', key: `${hunkIndex}-header`, hunkIndex, hunk },
    ...(source.mode === 'unified'
      ? unifiedItems(source, hunk, hunkIndex)
      : splitItems(source, hunkIndex)),
    ...(hotspot
      ? [{ kind: 'hotspot' as const, key: `${hunkIndex}-hotspot`, message: hotspot.message }]
      : []),
    ...gapItems(source, `after-${hunkIndex}`),
    ...(hunkIndex === source.hunkCount - 1 ? gapItems(source, 'bottom') : []),
  ]
}

/** Flattens a file's visible hunks, gaps and annotations into the review diff's list entries. */
export function buildDiffItems(source: DiffItemSource): DiffItem[] {
  const hiddenCount = source.hunkCount - source.visibleHunks.length
  const notice: DiffItem[] = hiddenCount > 0 ? [{ kind: 'notice', key: 'notice', hiddenCount }] : []
  return [
    ...notice,
    ...source.visibleHunks.flatMap(({ hunk, index }) => hunkItems(source, hunk, index)),
  ]
}
