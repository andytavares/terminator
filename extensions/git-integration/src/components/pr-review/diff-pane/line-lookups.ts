import { useCallback, useMemo } from 'react'
import type { DraftComment, PrReviewDetail, Thread } from '../../../schemas/pr-review.schema'
import type { AgentFinding, AgentRun } from '../../../schemas/review-agent.schema'
import type { GutterChip } from '../DiffLineRows'
import type { Side } from './types'

type Insights = PrReviewDetail['insights']

type ComplexityFunction = NonNullable<Insights>['complexity']['functions'][number]

export interface LookupSource {
  path: string
  fileThreads: Thread[]
  agentRuns: AgentRun[]
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

/** The file's review threads by line, and which lines they cover. */
function useThreadLookups(fileThreads: Thread[]) {
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
  return { isCommented, threadsForLine }
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

/** Pending draft comments on this file, by line. */
function useDraftLookup(drafts: DraftComment[], path: string) {
  return useCallback(
    (lineNum: number, side: Side) =>
      drafts.filter((d) => d.path === path && d.line === lineNum && d.side === side),
    [drafts, path]
  )
}

/** The functions in this file that gained branches, each once. */
function risingFunctions(insights: Insights, path: string): ComplexityFunction[] {
  return (insights?.complexity.functions ?? []).filter(
    (fn) => fn.path === path && fn.line != null && fn.branchDelta > 0
  )
}

/** A rising function's branch gain. */
function chipFor(fn: ComplexityFunction): GutterChip {
  return { kind: 'warn', label: `+${fn.branchDelta}` }
}

function chipsFor(insights: Insights, path: string): Map<number, GutterChip> {
  const chips = new Map<number, GutterChip>()
  for (const fn of risingFunctions(insights, path)) {
    if (!chips.has(fn.line!)) chips.set(fn.line!, chipFor(fn))
  }
  return chips
}

/** As wide as the widest chip it holds: a table squeezes an unsized cell below its content, which
 *  let the chip overlap the code. */
function gutterWidthFor(insights: Insights, path: string): number {
  const labels = risingFunctions(insights, path).map((fn) => chipFor(fn).label)
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

/** What each line of the diff carries: threads, agent findings, drafts and its chip. */
export function useLineLookups(source: LookupSource) {
  const { path } = source
  const threadLookups = useThreadLookups(source.fileThreads)
  const findingsForLine = useFindingLookup(source.agentRuns, path)
  const draftsForLine = useDraftLookup(source.drafts, path)
  const chips = useChips(source.insights, path)
  return { ...threadLookups, findingsForLine, draftsForLine, ...chips }
}
