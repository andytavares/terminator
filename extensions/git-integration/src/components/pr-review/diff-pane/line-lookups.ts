import { useCallback, useMemo } from 'react'
import type {
  DraftComment,
  PrReviewDetail,
  ReviewNote,
  Thread,
} from '../../../schemas/pr-review.schema'
import type { AgentFinding, AgentRun } from '../../../schemas/review-agent.schema'
import type { CommentVisibility } from '../../../stores/review-ui.store'
import type { GutterChip } from '../DiffLineRows'
import type { Side } from './types'

type Insights = PrReviewDetail['insights']

type ComplexityFunction = NonNullable<Insights>['complexity']['functions'][number]

interface LineNotes {
  notes: ReviewNote[]
  drafts: DraftComment[]
  path: string
}

export interface LookupSource {
  path: string
  fileThreads: Thread[]
  commentVisibility: CommentVisibility
  agentRuns: AgentRun[]
  notes: ReviewNote[]
  drafts: DraftComment[]
  insights: Insights
}

export type LineLookups = ReturnType<typeof useLineLookups>

/** Every line a thread covers, as "side:line". */
function commentedLineKeys(threads: Thread[]): Set<string> {
  const set = new Set<string>()
  for (const thread of threads) {
    for (let n = thread.startLine ?? thread.line; n <= thread.line; n++)
      set.add(`${thread.side}:${n}`)
  }
  return set
}

/**
 * Comment visibility (R2): all shows every thread (resolved dimmed); unresolved hides
 * resolved and outdated; hidden shows none, only a pip.
 */
function visibleThreads(all: Thread[], visibility: CommentVisibility): Thread[] {
  if (visibility === 'hidden') return []
  if (visibility === 'unresolved') return all.filter((t) => !t.resolved && !t.outdated)
  return all
}

/** The file's review threads by line, and which lines they cover. */
function useThreadLookups(fileThreads: Thread[], visibility: CommentVisibility) {
  const commentedLines = useMemo(() => commentedLineKeys(fileThreads), [fileThreads])
  const isCommented = useCallback(
    (lineNum: number, side: Side) => lineNum > 0 && commentedLines.has(`${side}:${lineNum}`),
    [commentedLines]
  )
  const threadsForLine = useCallback(
    (lineNum: number, side: Side): Thread[] =>
      fileThreads.filter((t) => t.line === lineNum && t.side === side),
    [fileThreads]
  )
  const visibleThreadsForLine = useCallback(
    (lineNum: number, side: Side) => visibleThreads(threadsForLine(lineNum, side), visibility),
    [threadsForLine, visibility]
  )
  return { isCommented, threadsForLine, visibleThreadsForLine }
}

/** Open findings from finished agent runs on this file, by the line they end on. */
function useFindingLookup(agentRuns: AgentRun[], path: string) {
  const fileFindings = useMemo(
    () =>
      agentRuns
        .filter((r) => r.status === 'done')
        .flatMap((r) => r.findings)
        .filter((f) => !f.dismissed && f.path === path),
    [agentRuns, path]
  )
  return useCallback(
    (lineNum: number, side: Side): AgentFinding[] =>
      fileFindings.filter((f) => f.side === side && f.endLine === lineNum),
    [fileFindings]
  )
}

/** Private notes and pending draft comments on this file, by line. */
function useNoteLookups({ notes, drafts, path }: LineNotes) {
  const notesForLine = useCallback(
    (lineNum: number, side: Side) =>
      notes.filter((n) => n.path === path && n.line === lineNum && n.side === side),
    [notes, path]
  )
  const draftsForLine = useCallback(
    (lineNum: number, side: Side) =>
      drafts.filter((d) => d.path === path && d.line === lineNum && d.side === side),
    [drafts, path]
  )
  return { notesForLine, draftsForLine }
}

/** The functions in this file that gained branches, each once. */
function risingFunctions(insights: Insights, path: string): ComplexityFunction[] {
  return (insights?.complexity.functions ?? []).filter(
    (fn) => fn.path === path && fn.line != null && fn.branchDelta > 0
  )
}

/** "untested" for a rising function without a test, else its branch gain. */
function chipFor(fn: ComplexityFunction, insights: Insights): GutterChip {
  if (insights?.coverage.untestedFunctions.includes(fn.name)) {
    return { kind: 'danger', label: 'untested' }
  }
  return { kind: 'warn', label: `+${fn.branchDelta}` }
}

function chipsFor(insights: Insights, path: string): Map<number, GutterChip> {
  const chips = new Map<number, GutterChip>()
  for (const fn of risingFunctions(insights, path)) {
    if (!chips.has(fn.line!)) chips.set(fn.line!, chipFor(fn, insights))
  }
  return chips
}

/**
 * The gutter column is as wide as the widest chip it holds; a table squeezes an unsized
 * cell below its content, which let the chip overlap the code.
 */
function gutterWidthFor(insights: Insights, path: string): number {
  const labels = risingFunctions(insights, path).map((fn) => chipFor(fn, insights).label)
  const widest = Math.max(0, ...labels.map((l) => l.length))
  if (widest === 0) return 18
  return 22 + widest * 7
}

/** The complexity chip for each line, one object per line so memoised rows see the same prop. */
function useChips(insights: Insights, path: string) {
  const chipsByLine = useMemo(() => chipsFor(insights, path), [insights, path])
  const gutterWidth = useMemo(() => gutterWidthFor(insights, path), [insights, path])
  return { chipsByLine, gutterWidth }
}

/** What each line of the diff carries: threads, agent findings, notes, drafts and its chip. */
export function useLineLookups(source: LookupSource) {
  const { path } = source
  const threadLookups = useThreadLookups(source.fileThreads, source.commentVisibility)
  const findingsForLine = useFindingLookup(source.agentRuns, path)
  const noteLookups = useNoteLookups({ notes: source.notes, drafts: source.drafts, path })
  const chips = useChips(source.insights, path)
  return { ...threadLookups, findingsForLine, ...noteLookups, ...chips }
}
