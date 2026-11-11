import { useCallback, useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { usePrReviewStore } from '../../../stores/pr-review.store'
import { useReviewUiStore } from '../../../stores/review-ui.store'
import { classifyHunk, type ComplexityHotspot } from '../../../github/pr-review-service'
import { measureDiffComplexity } from '../../../review/insights'
import {
  buildDiffItems,
  type GapView,
  type MovedMark,
  type SameShapeFold,
} from '../../../review/diff-items'
import type { ReviewBand } from '../../../review/review-layout'
import type { Chapter, MovedBlock, SameShapeGroup } from '../../../schemas/pr-review.schema'
import type { DiffItem } from '../../../review/diff-items'
import type { FileDiff } from '../../../schemas/git.schema'
import type { Annotating, ComposerAnchor, ReplyTarget, Side } from './types'

interface ItemSource {
  diff: FileDiff | null
  hotspots: ComplexityHotspot[]
  hideFormattingHunks: boolean
  gapViews: Map<string, GapView>
  movedMark: (lineNum: number, side: Side) => MovedMark | null
  viewedHunks: Set<string>
  band: ReviewBand
  sameShape: Map<number, SameShapeFold>
  expandedFolds: Set<number>
}

export function usePaneReviewStore() {
  return usePrReviewStore(
    useShallow((s) => ({
      viewedFiles: s.viewedFiles,
      threads: s.threads,
      changedSince: s.changedSince,
      viewedAt: s.viewedAt,
      viewedHunks: s.viewedHunks,
      toggleHunkViewed: s.toggleHunkViewed,
      historyRewritten: s.historyRewritten,
      drafts: s.drafts,
      updateDraft: s.updateDraft,
      removeDraft: s.removeDraft,
      setCurrentChapter: s.setCurrentChapter,
      setCurrentFile: s.setCurrentFile,
      markFileViewed: s.markFileViewed,
      unmarkFileViewed: s.unmarkFileViewed,
    }))
  )
}

export function usePaneUiStore() {
  return useReviewUiStore(
    useShallow((s) => ({
      diffRange: s.diffRange,
      selection: s.selection,
      setSelection: s.setSelection,
      composerRequest: s.composerRequest,
      requestComposer: s.requestComposer,
      agentRuns: s.agentRuns,
      openAgentPanel: s.openAgentPanel,
      deferHunk: s.deferHunk,
      setFileHunks: s.setFileHunks,
      revisitHunk: s.revisitHunk,
      clearRevisitHunk: s.clearRevisitHunk,
    }))
  )
}

/** The comment composer and the reply composer. */
export function useAnnotating(): Annotating {
  const [composerAnchor, setComposerAnchor] = useState<ComposerAnchor | null>(null)
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null)
  return {
    composerAnchor,
    setComposerAnchor,
    closeComposer: () => setComposerAnchor(null),
    replyTarget,
    setReplyTarget,
  }
}

function movedKey(block: { fromPath: string; fromLine: number; toPath: string; toLine: number }) {
  return `${block.fromPath}:${block.fromLine}->${block.toPath}:${block.toLine}`
}

function blockAt(blocks: { here: MovedBlock[]; away: MovedBlock[] }, lineNum: number, side: Side) {
  if (side === 'RIGHT')
    return blocks.here.find((b) => lineNum >= b.toLine && lineNum < b.toLine + b.lineCount)
  return blocks.away.find((b) => lineNum >= b.fromLine && lineNum < b.fromLine + b.lineCount)
}

function blockStart(block: MovedBlock, side: Side): number {
  if (side === 'RIGHT') return block.toLine
  return block.fromLine
}

/** Moved blocks touching this file, the marks they put on its lines, and showing or folding one. */
export function useMovedMarks(movedBlocks: MovedBlock[], path: string) {
  const [expandedMoved, setExpandedMoved] = useState<Set<string>>(new Set())
  const here = useMemo(() => movedBlocks.filter((b) => b.toPath === path), [movedBlocks, path])
  const away = useMemo(() => movedBlocks.filter((b) => b.fromPath === path), [movedBlocks, path])
  const movedMark = useCallback(
    (lineNum: number, side: Side): MovedMark | null => {
      const block = blockAt({ here, away }, lineNum, side)
      if (!block) return null
      const key = movedKey(block)
      const isStart = lineNum === blockStart(block, side)
      return { block, side, key, isStart, expanded: expandedMoved.has(key) }
    },
    [here, away, expandedMoved]
  )
  const toggleMoved = (key: string) =>
    setExpandedMoved((prev) => {
      const next = new Set(prev)
      if (!next.delete(key)) next.add(key)
      return next
    })
  return { movedMark, toggleMoved }
}

/** This file's hunks that repeat an earlier hunk, by hunk index, with the hunk each repeats. */
export function useSameShapeFolds(groups: SameShapeGroup[], path: string) {
  return useMemo(
    () =>
      new Map(
        groups.flatMap((group) =>
          group.rest
            .filter((hunk) => hunk.path === path)
            .map((hunk): [number, SameShapeFold] => [
              hunk.hunkIndex,
              { kind: 'same-shape', first: group.first, maskedValues: hunk.maskedValues },
            ])
        )
      ),
    [groups, path]
  )
}

/** The folded hunks the reviewer opened, and opening or closing one. */
export function useFoldToggles() {
  const [expandedFolds, setExpandedFolds] = useState<Set<number>>(new Set())
  const toggleFold = (hunkIndex: number) =>
    setExpandedFolds((prev) => {
      const next = new Set(prev)
      if (!next.delete(hunkIndex)) next.add(hunkIndex)
      return next
    })
  return { expandedFolds, toggleFold }
}

function visibleHunksOf(diff: FileDiff | null, hideFormatting: boolean) {
  const all = (diff?.hunks ?? []).map((hunk, index) => ({ hunk, index }))
  if (!hideFormatting) return all
  return all.filter(({ hunk }) => classifyHunk(hunk) === 'semantic')
}

/** The headers of the file's hunks marked viewed, stable until they change. */
export function useViewedHunks(headers: string[] | undefined): Set<string> {
  return useMemo(() => new Set(headers), [headers])
}

/** The virtual list's entries for the diff as shown. */
export function useDiffItems(source: ItemSource): DiffItem[] {
  const { diff, hideFormattingHunks, gapViews, movedMark, viewedHunks, hotspots } = source
  const { band, sameShape, expandedFolds } = source
  const visibleHunks = useMemo(
    () => visibleHunksOf(diff, hideFormattingHunks),
    [diff, hideFormattingHunks]
  )
  return useMemo(() => {
    if (!diff) return []
    const parts = { visibleHunks, gapViews, hotspots, movedMark, viewedHunks }
    const folds = { band, sameShape, expandedFolds }
    return buildDiffItems({ hunkCount: diff.hunks.length, ...parts, ...folds })
  }, [
    diff,
    visibleHunks,
    gapViews,
    hotspots,
    movedMark,
    viewedHunks,
    band,
    sameShape,
    expandedFolds,
  ])
}

/** Measures the diff once; its hotspot hunks go to the list. */
export function useComplexityHotspots(diff: FileDiff | null, path: string): ComplexityHotspot[] {
  const [measured, setMeasured] = useState<{ diff: FileDiff; hotspots: ComplexityHotspot[] }>()
  useEffect(() => {
    if (!diff) return
    let current = true
    void measureDiffComplexity(path, diff).then((result) => {
      if (current) setMeasured({ diff, hotspots: result?.hotspots ?? [] })
    })
    return () => {
      current = false
    }
  }, [diff, path])
  return measured?.diff === diff ? measured.hotspots : NO_HOTSPOTS
}

const NO_HOTSPOTS: ComplexityHotspot[] = []

/** The chapter holding `path`, if any. */
export function findChapterId(chapters: Chapter[], path: string): string | null {
  return chapters.find((c) => c.files.some((f) => f.path === path))?.id ?? null
}
