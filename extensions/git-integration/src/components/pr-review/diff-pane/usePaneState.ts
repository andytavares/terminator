import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { usePrReviewStore } from '../../../stores/pr-review.store'
import { useReviewUiStore } from '../../../stores/review-ui.store'
import { classifyHunk, type ComplexityHotspot } from '../../../github/pr-review-service'
import { measureDiffComplexity } from '../../../review/insights'
import { buildSplitRows } from '../../FileDiffView'
import { buildDiffItems, type GapView, type MovedMark } from '../../../review/diff-items'
import type { Chapter, MovedBlock, PrHead, ReviewNote } from '../../../schemas/pr-review.schema'
import type { DiffItem } from '../../../review/diff-items'
import type { FileDiff } from '../../../schemas/git.schema'
import type { DiffViewMode } from '../../../stores/review-ui.store'
import type { TestBlock } from '../TestsPopover'
import type { VirtualDiffListHandle } from '../VirtualDiffList'
import type {
  Annotating,
  ComposerAnchor,
  NoteAnchor,
  ReplyTarget,
  Side,
  TestsControl,
} from './types'

interface NoteTarget {
  head: PrHead
  path: string
  addNote: (head: PrHead, note: ReviewNote) => void
}

interface JumpTarget {
  path: string
  diff: FileDiff | null
  items: DiffItem[]
  listRef: { current: VirtualDiffListHandle | null }
}

interface TestsSource extends JumpTarget {
  head: PrHead
  chapters: Chapter[]
  goToPath: (path: string) => void
}

interface ItemSource {
  diff: FileDiff | null
  hotspots: ComplexityHotspot[]
  mode: DiffViewMode
  hideFormattingHunks: boolean
  gapViews: Map<string, GapView>
  movedMark: (lineNum: number, side: Side) => MovedMark | null
  viewedHunks: Set<string>
}

interface ComplexityTarget {
  diff: FileDiff | null
  path: string
  chapters: Chapter[]
  patchFileComplexity: (chapterId: string, filePath: string, delta: number) => void
}

export function usePaneReviewStore() {
  return usePrReviewStore(
    useShallow((s) => ({
      viewedFiles: s.viewedFiles,
      threads: s.threads,
      patchFileComplexity: s.patchFileComplexity,
      changedSince: s.changedSince,
      viewedAt: s.viewedAt,
      viewedHunks: s.viewedHunks,
      toggleHunkViewed: s.toggleHunkViewed,
      historyRewritten: s.historyRewritten,
      notes: s.notes,
      drafts: s.drafts,
      addNote: s.addNote,
      removeNote: s.removeNote,
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
      commentVisibility: s.commentVisibility,
      setCommentVisibility: s.setCommentVisibility,
      agentNotesOn: s.agentNotesOn,
      diffViewMode: s.diffViewMode,
      hideFormattingHunks: s.hideFormattingHunks,
      setHideFormattingHunks: s.setHideFormattingHunks,
      diffRange: s.diffRange,
      selection: s.selection,
      setSelection: s.setSelection,
      composerRequest: s.composerRequest,
      requestComposer: s.requestComposer,
      agentRuns: s.agentRuns,
      openAgentPanel: s.openAgentPanel,
    }))
  )
}

/** The comment composer, the reply composer and the private-note box. */
/** The private-note box: where it is open, what is typed, and saving or dropping it. */
function useNoteBox(target: NoteTarget) {
  const [noteAnchor, setNoteAnchor] = useState<NoteAnchor | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const cancelNote = () => {
    setNoteAnchor(null)
    setNoteDraft('')
  }
  const saveNote = () => {
    if (!noteAnchor || !noteDraft.trim()) return
    const { line, side } = noteAnchor
    const note = { id: crypto.randomUUID(), path: target.path, line, side, body: noteDraft }
    target.addNote(target.head, { ...note, createdAt: new Date().toISOString() })
    cancelNote()
  }
  return { noteAnchor, setNoteAnchor, noteDraft, setNoteDraft, saveNote, cancelNote }
}

export function useAnnotating(target: NoteTarget): Annotating {
  const [composerAnchor, setComposerAnchor] = useState<ComposerAnchor | null>(null)
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null)
  const noteBox = useNoteBox(target)
  return {
    composerAnchor,
    setComposerAnchor,
    closeComposer: () => setComposerAnchor(null),
    replyTarget,
    setReplyTarget,
    ...noteBox,
  }
}

/** The index of the first entry showing new-file line `line`, or -1. */
function indexShowingNewLine(items: DiffItem[], line: number): number {
  return items.findIndex((item) => {
    if (item.kind === 'line' || item.kind === 'gap-line') return item.line.newLineNumber === line
    return item.kind === 'split-row' && item.right?.newLineNumber === line
  })
}

/** Scrolls to a test opened from the tests popover once its file's diff is shown, once per jump. */
function usePendingJump(target: JumpTarget) {
  const [pendingJump, setPendingJump] = useState<{ path: string; line: number } | null>(null)
  const performedJumpRef = useRef(pendingJump)
  const { path, diff, items, listRef } = target
  useEffect(() => {
    if (!pendingJump || !diff || pendingJump.path !== path) return
    if (performedJumpRef.current === pendingJump) return
    const index = indexShowingNewLine(items, pendingJump.line)
    if (index < 0) return
    performedJumpRef.current = pendingJump
    listRef.current?.scrollToIndex(index, 'center')
  }, [pendingJump, diff, path, items, listRef])
  return setPendingJump
}

/** The tests popover, and jumping from it to a test in this review. */
export function useTests(source: TestsSource): TestsControl {
  const [testsFor, setTestsFor] = useState<{ anchor: string; block: TestBlock } | null>(null)
  const setPendingJump = usePendingJump(source)
  const { head, path, chapters } = source
  const prPaths = useMemo(
    () => new Set(chapters.flatMap((c) => c.files.map((f) => f.path))),
    [chapters]
  )
  return {
    testsFor,
    closeTests: () => setTestsFor(null),
    openTests: (anchor, code, hunkHeader) => {
      const block = { repoRoot: head.repoRoot, headSHA: head.headSHA, path, code, hunkHeader }
      setTestsFor({ anchor, block })
    },
    openTestInReview: (testPath, line) => {
      setPendingJump({ path: testPath, line })
      source.goToPath(testPath)
    },
    prPaths,
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
  const { diff, mode, hideFormattingHunks, gapViews, movedMark, viewedHunks, hotspots } = source
  const splitRows = useMemo(() => splitRowsOf(diff), [diff])
  const visibleHunks = useMemo(
    () => visibleHunksOf(diff, hideFormattingHunks),
    [diff, hideFormattingHunks]
  )
  return useMemo(() => {
    if (!diff) return []
    const parts = { visibleHunks, splitRows, gapViews, hotspots, movedMark, viewedHunks }
    return buildDiffItems({ mode, hunkCount: diff.hunks.length, ...parts })
  }, [diff, mode, visibleHunks, splitRows, gapViews, hotspots, movedMark, viewedHunks])
}

function splitRowsOf(diff: FileDiff | null) {
  return (diff?.hunks ?? []).map((hunk) => buildSplitRows(hunk.lines))
}

/** Measures the diff once. Its branch delta feeds the file's risk score, and its hotspot hunks go to
 *  the list. The chapters and the store action are read through refs: as dependencies they would
 *  loop (patching updates the chapters, which would refetch the diff and blank the pane). */
export function useComplexityPatch(target: ComplexityTarget): ComplexityHotspot[] {
  const patchRef = useRef(target.patchFileComplexity)
  const chaptersRef = useRef<Chapter[]>(target.chapters)
  useEffect(() => {
    patchRef.current = target.patchFileComplexity
    chaptersRef.current = target.chapters
  })
  const [measured, setMeasured] = useState<{ diff: FileDiff; hotspots: ComplexityHotspot[] }>()
  const { diff, path } = target
  useEffect(() => {
    if (!diff) return
    let current = true
    void measureDiffComplexity(path, diff).then((result) => {
      if (!current) return
      setMeasured({ diff, hotspots: result?.hotspots ?? [] })
      const chapter = chaptersRef.current.find((c) => c.files.some((f) => f.path === path))
      if (chapter) patchRef.current(chapter.id, path, result?.delta ?? 0)
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
