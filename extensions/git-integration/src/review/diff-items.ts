import type { DiffHunk, DiffLine } from '../schemas/git.schema'
import type { MovedBlock, SameShapeHunk } from '../schemas/pr-review.schema'
import type { ReviewBand } from './review-layout'

type Side = 'LEFT' | 'RIGHT'

/** A moved-code block touching one line, with whether that line opens it and whether it is shown. */
export interface MovedMark {
  block: MovedBlock
  side: Side
  key: string
  isStart: boolean
  expanded: boolean
}

/** A hunk that repeats `first`'s change with other literals. */
export interface SameShapeFold {
  kind: 'same-shape'
  first: SameShapeHunk
  maskedValues: string[]
}

/** Why a hunk shows as one row: it repeats another hunk, or it only deletes lines. */
export type HunkFold = SameShapeFold | { kind: 'deleted'; lineCount: number }

export interface GapView {
  above: DiffLine[]
  hidden: number | null
  below: DiffLine[]
}

/** One entry of the review diff's virtual list, rendered as its own block so the list can mount
 *  only the entries near the viewport. */
export type DiffItem =
  | { kind: 'notice'; key: string; hiddenCount: number }
  | { kind: 'gap-line'; key: string; line: DiffLine }
  | { kind: 'gap-expander'; key: string; gapKey: string; hidden: number | null }
  | { kind: 'hunk-header'; key: string; hunkIndex: number; hunk: DiffHunk; viewed: boolean }
  | { kind: 'line'; key: string; line: DiffLine; moved: MovedMark | null }
  | { kind: 'hotspot'; key: string; message: string }
  | { kind: 'fold'; key: string; hunkIndex: number; fold: HunkFold; expanded: boolean }

export interface DiffItemSource {
  hunkCount: number
  visibleHunks: Array<{ hunk: DiffHunk; index: number }>
  gapViews: Map<string, GapView>
  hotspots: Array<{ hunkIndex: number; message: string }>
  movedMark: (lineNum: number, side: Side) => MovedMark | null
  /** Headers of the hunks marked viewed; each shows as its header alone. */
  viewedHunks: Set<string>
  /** Only the chapters band folds hunks. */
  band: ReviewBand
  /** The file's repeated hunks, by hunk index. */
  sameShape: Map<number, SameShapeFold>
  /** The indexes of the folded hunks the reviewer opened. */
  expandedFolds: Set<number>
}

/** A deleted-only hunk shorter than this shows in full. */
const MIN_FOLDED_DELETED_LINES = 3

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

function deletedFold(hunk: DiffHunk): HunkFold | null {
  if (hunk.lines.some((line) => line.type === 'add')) return null
  const lineCount = hunk.lines.filter((line) => line.type === 'remove').length
  if (lineCount < MIN_FOLDED_DELETED_LINES) return null
  return { kind: 'deleted', lineCount }
}

function foldOf(source: DiffItemSource, hunk: DiffHunk, hunkIndex: number): HunkFold | null {
  if (source.band !== 'chapters') return null
  return source.sameShape.get(hunkIndex) ?? deletedFold(hunk)
}

/** A hunk's lines, or its fold row, followed by the lines once the fold is opened. */
function bodyItems(source: DiffItemSource, hunk: DiffHunk, hunkIndex: number): DiffItem[] {
  const rows = unifiedItems(source, hunk, hunkIndex)
  const fold = foldOf(source, hunk, hunkIndex)
  if (!fold) return rows
  const expanded = source.expandedFolds.has(hunkIndex)
  const foldItem: DiffItem = { kind: 'fold', key: `${hunkIndex}-fold`, hunkIndex, fold, expanded }
  return expanded ? [foldItem, ...rows] : [foldItem]
}

function hunkItems(source: DiffItemSource, hunk: DiffHunk, hunkIndex: number): DiffItem[] {
  const viewed = source.viewedHunks.has(hunk.header)
  const hotspot = viewed ? undefined : source.hotspots.find((h) => h.hunkIndex === hunkIndex)
  return [
    ...(hunkIndex === 0 ? gapItems(source, 'top') : []),
    { kind: 'hunk-header', key: `${hunkIndex}-header`, hunkIndex, hunk, viewed },
    ...(viewed ? [] : bodyItems(source, hunk, hunkIndex)),
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
