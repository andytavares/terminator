import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { ChevronDown, ChevronUp, TriangleAlert, UnfoldVertical } from 'lucide-react'
import { ViewMenu } from './ViewMenu'
import { UsesPopover } from './UsesPopover'
import { TestsPopover, type TestBlock } from './TestsPopover'
import { InlineCommentThread } from './InlineCommentThread'
import { RichContent } from './RichContent'
import { CommentComposer } from './CommentComposer'
import { AgentNote } from './AgentNote'
import { SelectionBar } from './SelectionBar'
import { MovedRow } from './MovedRow'
import { SplitLineRow, UnifiedLineRow, type GutterChip, type Side } from './DiffLineRows'
import { VirtualDiffList, type VirtualDiffListHandle } from './VirtualDiffList'
import { useShallow } from 'zustand/react/shallow'
import { usePrReviewStore } from '../../stores/pr-review.store'
import { useReviewUiStore, REVIEW_KEY_EVENTS } from '../../stores/review-ui.store'
import {
  detectComplexityHotspots,
  computeFileCyclomaticDelta,
  classifyHunk,
  parseDiff,
} from '../../github/pr-review-service'
import { detectLanguage, buildSplitRows } from '../FileDiffView'
import { useLoadInlineComments } from '../../hooks/usePrReview'
import type { PrChangedFile, PrReviewDetail, Chapter, Thread } from '../../schemas/pr-review.schema'
import type { DiffHunk, DiffLine, FileDiff } from '../../schemas/git.schema'
import { FileDiffSchema } from '../../schemas/git.schema'
import { githubAPI } from '../../api/github'
import { EXPAND_STEP, gapsFor, reveal, splitLines, type Expansion } from '../../review/expand-gaps'
import { buildDiffItems, type DiffItem, type MovedMark } from '../../review/diff-items'
import './review-surface.css'

interface Props {
  repoRoot: string
  pr: PrReviewDetail
  file: PrChangedFile
  onMarkViewed: () => void
  onPrevFile: () => void
  onNextFile: () => void
  onShowRisk: () => void
}

interface ComposerAnchor {
  line: number
  startLine: number | null
  side: 'LEFT' | 'RIGHT'
  initialBody: string
  fromFindingId: string | null
}

type FileText =
  | { status: 'idle' | 'loading' | 'tooLarge' }
  | { status: 'error'; message: string }
  | { status: 'ready'; lines: string[] }

type ContentResult = { content: string } | { tooLarge: true } | { error: string }

interface CachedDiff {
  diff: FileDiff
  note: string | null
}

// A unified row's number cells carry 28px of padding and a 1px border; the insight gutter 8px of padding.
const NUM_CELL_CHROME_PX = 29
const GUTTER_CELL_PADDING_PX = 8

const REWRITTEN_NOTE = 'History rewritten — showing the whole file'
const DIFF_CACHE_CAP = 60

function rememberDiff(
  cache: Map<string, CachedDiff>,
  key: string,
  entry: CachedDiff
): Map<string, CachedDiff> {
  const next = new Map(cache)
  next.delete(key)
  next.set(key, entry)
  if (next.size > DIFF_CACHE_CAP) next.delete(next.keys().next().value as string)
  return next
}

function movedKey(block: { fromPath: string; fromLine: number; toPath: string; toLine: number }) {
  return `${block.fromPath}:${block.fromLine}->${block.toPath}:${block.toLine}`
}

function itemShowsNewLine(item: DiffItem, line: number): boolean {
  if (item.kind === 'line' || item.kind === 'gap-line') return item.line.newLineNumber === line
  return item.kind === 'split-row' && item.right?.newLineNumber === line
}

function findChapterId(chapters: Chapter[], path: string): string | null {
  return chapters.find((c) => c.files.some((f) => f.path === path))?.id ?? null
}

export function ReviewDiffPane({
  repoRoot,
  pr,
  file,
  onMarkViewed,
  onPrevFile,
  onNextFile,
  onShowRisk,
}: Props) {
  const [diffCache, setDiffCache] = useState<Map<string, CachedDiff>>(() => new Map())
  const [diffFailure, setDiffFailure] = useState<{ key: string; message: string } | null>(null)
  const [rewrittenNoteFor, setRewrittenNoteFor] = useState<string | null>(null)
  const [composerAnchor, setComposerAnchor] = useState<ComposerAnchor | null>(null)
  const [noteAnchor, setNoteAnchor] = useState<{ line: number; side: 'LEFT' | 'RIGHT' } | null>(
    null
  )
  const [noteDraft, setNoteDraft] = useState('')
  const [replyTarget, setReplyTarget] = useState<{ threadId: string; inReplyToId: number } | null>(
    null
  )
  const [expandedMoved, setExpandedMoved] = useState<Set<string>>(new Set())
  const [testsFor, setTestsFor] = useState<{ anchor: string; block: TestBlock } | null>(null)
  const [pendingJump, setPendingJump] = useState<{ path: string; line: number } | null>(null)
  const lineDragRef = useRef<{
    active: boolean
    side: 'LEFT' | 'RIGHT' | null
    startLine: number
    endLine: number
  }>({ active: false, side: null, startLine: 0, endLine: 0 })
  const dragJustEndedRef = useRef(false)
  const [dragPreview, setDragPreview] = useState<{
    side: 'LEFT' | 'RIGHT'
    startLine: number
    endLine: number
  } | null>(null)
  const [splitLeftPct, setSplitLeftPct] = useState(50)
  const splitDragState = useRef({ active: false, startX: 0, startPct: 50, containerWidth: 0 })
  const {
    viewedFiles,
    threads,
    patchFileComplexity,
    changedSince,
    viewedAt,
    historyRewritten,
    notes,
    drafts,
    addNote,
    removeNote,
    updateDraft,
    removeDraft,
    setCurrentChapter,
    setCurrentFile,
    markFileViewed,
    unmarkFileViewed,
  } = usePrReviewStore(
    useShallow((s) => ({
      viewedFiles: s.viewedFiles,
      threads: s.threads,
      patchFileComplexity: s.patchFileComplexity,
      changedSince: s.changedSince,
      viewedAt: s.viewedAt,
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
  const {
    commentVisibility,
    setCommentVisibility,
    agentNotesOn,
    diffViewMode,
    hideFormattingHunks,
    setHideFormattingHunks,
    diffRange,
    selection,
    setSelection,
    composerRequest,
    requestComposer,
    agentRuns,
    openAgentPanel,
  } = useReviewUiStore(
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
  const scrollRef = useRef<HTMLDivElement>(null)
  // Tracks which hunk nextHunk/prevHunk last scrolled to, since jsdom (and
  // some real layouts) can't be trusted to report bounding-rect positions.
  const currentHunkIndexRef = useRef(0)
  const [expansions, setExpansions] = useState<Map<string, Expansion>>(new Map())
  const [fileText, setFileText] = useState<FileText>({ status: 'idle' })
  const fileTextCache = useRef(new Map<string, string[]>())
  const fileTextKey = `${file.path}@${pr.headSHA}`
  const fileTextKeyRef = useRef(fileTextKey)

  // Use refs so the complexity-patch effect always has current values without
  // making them deps of the diff-loading effect (which would cause an infinite
  // loop: patchFileComplexity updates activePr.chapters → pr.chapters ref
  // changes → effect re-runs → setDiff(null) → blank screen).
  const patchFileComplexityRef = useRef(patchFileComplexity)
  const prChaptersRef = useRef<Chapter[]>(pr.chapters)
  useEffect(() => {
    fileTextKeyRef.current = fileTextKey
    patchFileComplexityRef.current = patchFileComplexity
    prChaptersRef.current = pr.chapters
  })

  const lang = detectLanguage(file.path)
  const isViewed = viewedFiles.has(file.path)
  const slash = file.path.lastIndexOf('/')
  const dirName = slash >= 0 ? file.path.slice(0, slash + 1) : ''
  const baseName = file.path.slice(slash + 1)
  const fileThreads = useMemo(() => threads[file.path] ?? [], [threads, file.path])
  const isChangedSince = changedSince.has(file.path)

  const readingStep = useMemo(
    () => pr.readingOrder.find((s) => s.path === file.path) ?? null,
    [pr.readingOrder, file.path]
  )
  const usesWithDef = useMemo(
    () => (readingStep?.uses ?? []).filter((u) => u.definedInStep != null),
    [readingStep]
  )

  const movedHere = useMemo(
    () => pr.movedBlocks.filter((b) => b.toPath === file.path),
    [pr.movedBlocks, file.path]
  )
  const movedAway = useMemo(
    () => pr.movedBlocks.filter((b) => b.fromPath === file.path),
    [pr.movedBlocks, file.path]
  )

  const movedBlockForLine = useCallback(
    (lineNum: number, side: 'LEFT' | 'RIGHT') => {
      if (side === 'RIGHT') {
        return movedHere.find((b) => lineNum >= b.toLine && lineNum < b.toLine + b.lineCount)
      }
      return movedAway.find((b) => lineNum >= b.fromLine && lineNum < b.fromLine + b.lineCount)
    },
    [movedHere, movedAway]
  )

  // Only a since-range view reads when the file was last viewed. Depending on the
  // whole viewedAt map would refetch the open file every time it is marked viewed.
  const sinceSha = diffRange === 'since' && isChangedSince ? viewedAt[file.path] : undefined
  const diffKey = `${pr.number}:${pr.headSHA}:${file.path}:${sinceSha ? `since:${sinceSha}` : 'whole'}`
  const historyNote = historyRewritten && isChangedSince ? REWRITTEN_NOTE : null

  const cachedDiff = file.isBinary ? undefined : diffCache.get(diffKey)
  const diff = cachedDiff?.diff ?? null
  const diffError = !cachedDiff && diffFailure?.key === diffKey ? diffFailure.message : null
  const sinceNote = cachedDiff
    ? cachedDiff.note
    : rewrittenNoteFor === diffKey
      ? REWRITTEN_NOTE
      : null
  const diffLoading = !file.isBinary && !cachedDiff && !diffError

  const [shownDiffKey, setShownDiffKey] = useState(diffKey)
  if (shownDiffKey !== diffKey) {
    setShownDiffKey(diffKey)
    setExpansions(new Map())
    setFileText({ status: 'idle' })
  }

  useEffect(() => {
    currentHunkIndexRef.current = 0
  }, [diffKey])

  const hasCachedDiff = cachedDiff !== undefined
  useEffect(() => {
    if (file.isBinary || hasCachedDiff) return

    let cancelled = false
    const show = (next: FileDiff, note: string | null) =>
      setDiffCache((prev) => rememberDiff(prev, diffKey, { diff: next, note }))
    const fail = (message: string) => {
      if (!cancelled) setDiffFailure({ key: diffKey, message })
    }

    const loadFull = (note: string | null) =>
      githubAPI
        .prFileDiff({
          repoRoot,
          prNumber: pr.number,
          path: file.path,
          baseRef: pr.baseRefName,
          headSHA: pr.headSHA,
        })
        .then((result) => {
          if (cancelled) return
          if ('error' in result) {
            fail(result.error)
            return
          }
          const parsed = FileDiffSchema.safeParse(result.diff)
          if (parsed.success) {
            show(parsed.data, note)
          } else {
            fail('Unexpected diff format from server')
          }
        })
        .catch((e) => fail(String(e)))

    if (sinceSha) {
      githubAPI
        .prCompare(repoRoot, sinceSha, pr.headSHA)
        .then((cmp) => {
          if (cancelled) return
          if ('error' in cmp || cmp.rewritten) {
            if (!('error' in cmp)) setRewrittenNoteFor(diffKey)
            return loadFull(!('error' in cmp) ? REWRITTEN_NOTE : null)
          }
          const entry = cmp.files.find((f) => f.path === file.path)
          if (!entry) return loadFull(null)
          show(parseDiff(entry.patch, file.path), `Showing ${sinceSha.slice(0, 8)} … head`)
        })
        .catch(() => loadFull(null))
    } else {
      void loadFull(null)
    }
    return () => {
      cancelled = true
      setDiffFailure((failure) => (failure?.key === diffKey ? null : failure))
    }
  }, [
    diffKey,
    file.path,
    file.isBinary,
    hasCachedDiff,
    repoRoot,
    pr.number,
    pr.headSHA,
    pr.baseRefName,
    sinceSha,
  ])

  // Feed complexity delta into the risk score whenever the diff changes.
  // Runs independently so it doesn't trigger a diff reload.
  useEffect(() => {
    if (!diff) return
    const delta = computeFileCyclomaticDelta(diff)
    const chapter = prChaptersRef.current.find((c) => c.files.some((f) => f.path === file.path))
    if (chapter) patchFileComplexityRef.current(chapter.id, file.path, delta)
  }, [diff, file.path])

  // Keyboard navigation
  useEffect(() => {
    const handlePrev = () => onPrevFile()
    const handleMarkNext = () => onMarkViewed()
    window.addEventListener('pr-review:prev-file', handlePrev)
    window.addEventListener('pr-review:mark-viewed-next', handleMarkNext)
    return () => {
      window.removeEventListener('pr-review:prev-file', handlePrev)
      window.removeEventListener('pr-review:mark-viewed-next', handleMarkNext)
    }
  }, [onPrevFile, onMarkViewed])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const state = splitDragState.current
      if (!state.active || state.containerWidth === 0) return
      const delta = e.clientX - state.startX
      const deltaPct = (delta / state.containerWidth) * 100
      setSplitLeftPct(Math.max(20, Math.min(80, state.startPct + deltaPct)))
    }
    const onUp = () => {
      splitDragState.current.active = false
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  // Gutter drag selects lines; it no longer opens the composer. The float bar
  // (SelectionBar) that appears under the selection offers Comment/Ask
  // agent/Explain/Add note instead.
  useEffect(() => {
    const onMouseUp = () => {
      const drag = lineDragRef.current
      if (!drag.active || drag.side == null) return
      drag.active = false
      // The click that follows a multi-row drag lands on the rows' common
      // ancestor, not the gutter button; it must not clear this selection.
      dragJustEndedRef.current = true
      setTimeout(() => {
        dragJustEndedRef.current = false
      }, 0)
      const lo = Math.min(drag.startLine, drag.endLine)
      const hi = Math.max(drag.startLine, drag.endLine)
      setDragPreview(null)
      setSelection({ path: file.path, side: drag.side, startLine: lo, endLine: hi })
    }
    window.addEventListener('mouseup', onMouseUp)
    return () => window.removeEventListener('mouseup', onMouseUp)
  }, [file.path, setSelection])

  // A request from elsewhere (the agent panel, a finding) opens the composer
  // in this file, prefilled, then clears the one-shot request.
  const requestForThisFile = composerRequest?.path === file.path ? composerRequest : null
  const [seenComposerRequest, setSeenComposerRequest] = useState(requestForThisFile)
  if (seenComposerRequest !== requestForThisFile) {
    setSeenComposerRequest(requestForThisFile)
    if (requestForThisFile) {
      setComposerAnchor({
        line: requestForThisFile.line,
        startLine: requestForThisFile.startLine,
        side: requestForThisFile.side,
        initialBody: requestForThisFile.body,
        fromFindingId: requestForThisFile.fromFindingId,
      })
    }
  }
  useEffect(() => {
    if (requestForThisFile) requestComposer(null)
  }, [requestForThisFile, requestComposer])

  const hunkNearTop = useCallback((): { startLine: number; endLine: number } | null => {
    if (!diff) return null
    for (const hunk of diff.hunks) {
      const lines = hunk.lines.map((l) => l.newLineNumber ?? l.oldLineNumber ?? 0).filter(Boolean)
      if (lines.length > 0) return { startLine: Math.min(...lines), endLine: Math.max(...lines) }
    }
    return null
  }, [diff])

  const loadFileText = useCallback(() => {
    const key = fileTextKeyRef.current
    const cached = fileTextCache.current.get(key)
    if (cached) {
      setFileText({ status: 'ready', lines: cached })
      return
    }
    setFileText({ status: 'loading' })
    const isCurrent = () => fileTextKeyRef.current === key
    githubAPI
      .prFileContent({ repoRoot, prNumber: pr.number, path: file.path, ref: pr.headSHA })
      .then((raw: unknown) => {
        if (!isCurrent()) return
        const result = raw as ContentResult
        if ('tooLarge' in result) {
          setFileText({ status: 'tooLarge' })
        } else if ('error' in result) {
          setFileText({ status: 'error', message: result.error })
        } else {
          const lines = splitLines(result.content)
          fileTextCache.current.set(key, lines)
          setFileText({ status: 'ready', lines })
        }
      })
      .catch((e: unknown) => {
        if (isCurrent()) setFileText({ status: 'error', message: String(e) })
      })
  }, [repoRoot, pr.number, pr.headSHA, file.path])

  const expandGap = (key: string, kind: 'above' | 'below' | 'all') => {
    setExpansions((prev) => {
      const next = new Map(prev)
      const cur = next.get(key) ?? { fromTop: 0, fromBottom: 0 }
      next.set(
        key,
        kind === 'above'
          ? { ...cur, fromBottom: cur.fromBottom + EXPAND_STEP }
          : kind === 'below'
            ? { ...cur, fromTop: cur.fromTop + EXPAND_STEP }
            : { fromTop: Number.MAX_SAFE_INTEGER, fromBottom: 0 }
      )
      return next
    })
    if (fileText.status === 'idle') loadFileText()
  }

  // Gaps come from every hunk, not the visible ones, so hiding formatting hunks
  // never shifts which unchanged lines belong to which gap.
  const gaps = useMemo(
    () => (diff && !file.isBinary && !diff.truncated ? gapsFor(diff.hunks) : []),
    [diff, file.isBinary]
  )

  const gapViews = useMemo(() => {
    const views = new Map<string, { above: DiffLine[]; hidden: number | null; below: DiffLine[] }>()
    for (const gap of gaps) {
      const exp = expansions.get(gap.key) ?? { fromTop: 0, fromBottom: 0 }
      if (fileText.status === 'ready') {
        views.set(gap.key, reveal(gap, fileText.lines, exp))
      } else if (gap.newEnd != null) {
        const size = gap.newEnd - gap.newStart + 1
        const top = Math.min(exp.fromTop, size)
        const bottom = Math.min(exp.fromBottom, size - top)
        views.set(gap.key, { above: [], hidden: size - top - bottom, below: [] })
      } else {
        views.set(gap.key, { above: [], hidden: null, below: [] })
      }
    }
    return views
  }, [gaps, expansions, fileText])

  const hotspots = useMemo(() => (diff ? detectComplexityHotspots(diff) : []), [diff])
  const splitRowsByHunk = useMemo(
    () => (diff?.hunks ?? []).map((hunk) => buildSplitRows(hunk.lines)),
    [diff]
  )

  const visibleHunks = useMemo(() => {
    if (!diff) return []
    if (!hideFormattingHunks) return diff.hunks.map((h, i) => ({ hunk: h, index: i }))
    return diff.hunks
      .map((h, i) => ({ hunk: h, index: i }))
      .filter(({ hunk }) => classifyHunk(hunk) === 'semantic')
  }, [diff, hideFormattingHunks])

  const movedMark = useCallback(
    (lineNum: number, side: Side): MovedMark | null => {
      const block = movedBlockForLine(lineNum, side)
      if (!block) return null
      const key = movedKey(block)
      const isStart = lineNum === (side === 'RIGHT' ? block.toLine : block.fromLine)
      return { block, side, key, isStart, expanded: expandedMoved.has(key) }
    },
    [movedBlockForLine, expandedMoved]
  )

  const items = useMemo(
    () =>
      diff
        ? buildDiffItems({
            mode: diffViewMode,
            hunkCount: diff.hunks.length,
            visibleHunks,
            splitRows: splitRowsByHunk,
            gapViews,
            hotspots,
            movedMark,
          })
        : [],
    [diff, diffViewMode, visibleHunks, splitRowsByHunk, gapViews, hotspots, movedMark]
  )

  const listRef = useRef<VirtualDiffListHandle>(null)
  const hunkHeaderIndexes = useMemo(
    () => items.flatMap((item, index) => (item.kind === 'hunk-header' ? [index] : [])),
    [items]
  )

  const scrollHunkIntoView = useCallback(
    (direction: 1 | -1) => {
      if (hunkHeaderIndexes.length === 0) return
      const nextIndex = currentHunkIndexRef.current + direction
      if (nextIndex < 0) {
        onPrevFile()
        return
      }
      if (nextIndex >= hunkHeaderIndexes.length) {
        onNextFile()
        return
      }
      currentHunkIndexRef.current = nextIndex
      listRef.current?.scrollToIndex(hunkHeaderIndexes[nextIndex], 'start')
    },
    [hunkHeaderIndexes, onNextFile, onPrevFile]
  )

  // GitHub accepts review comments only on lines inside the diff.
  const selectionTouchesRevealed = useCallback(
    (sel: { path: string; side: 'LEFT' | 'RIGHT'; startLine: number; endLine: number } | null) => {
      if (!sel || sel.path !== file.path) return false
      for (const view of gapViews.values()) {
        for (const line of [...view.above, ...view.below]) {
          const n = sel.side === 'LEFT' ? line.oldLineNumber : line.newLineNumber
          if (n != null && n >= sel.startLine && n <= sel.endLine) return true
        }
      }
      return false
    },
    [gapViews, file.path]
  )

  const handlePeekDefinition = useCallback(() => {
    const use = usesWithDef[0]
    if (!use || !use.definedInPath) return
    const chapterId = findChapterId(pr.chapters, use.definedInPath)
    if (chapterId) setCurrentChapter(chapterId)
    setCurrentFile(use.definedInPath)
  }, [usesWithDef, pr.chapters, setCurrentChapter, setCurrentFile])

  // REVIEW_KEY_EVENTS: the surface-level key handler (useReviewKeys, owned
  // elsewhere) raises these; only the pane knows its hunks and selection.
  useEffect(() => {
    const onNextHunk = () => scrollHunkIntoView(1)
    const onPrevHunk = () => scrollHunkIntoView(-1)
    const scopeFromSelectionOrHunk = () => {
      if (selection && selection.path === file.path) {
        return {
          kind: 'lines' as const,
          path: selection.path,
          startLine: selection.startLine,
          endLine: selection.endLine,
          side: selection.side,
          chapter: null,
        }
      }
      const hunk = hunkNearTop()
      if (!hunk) return null
      return {
        kind: 'hunk' as const,
        path: file.path,
        startLine: hunk.startLine,
        endLine: hunk.endLine,
        side: 'RIGHT' as const,
        chapter: null,
      }
    }
    const onAskAgent = () => {
      const scope = scopeFromSelectionOrHunk()
      if (scope) openAgentPanel(scope, 'review')
    }
    const onExplain = () => {
      const scope = scopeFromSelectionOrHunk()
      if (scope) openAgentPanel(scope, 'explain', true)
    }
    const onComment = () => {
      if (selection && selection.path === file.path && !selectionTouchesRevealed(selection)) {
        setComposerAnchor({
          line: selection.endLine,
          startLine: selection.startLine !== selection.endLine ? selection.startLine : null,
          side: selection.side,
          initialBody: '',
          fromFindingId: null,
        })
      }
    }
    const onNote = () => {
      if (selection && selection.path === file.path) {
        setNoteAnchor({ line: selection.endLine, side: selection.side })
      }
    }
    const onPeekDefinition = () => handlePeekDefinition()
    window.addEventListener(REVIEW_KEY_EVENTS.nextHunk, onNextHunk)
    window.addEventListener(REVIEW_KEY_EVENTS.prevHunk, onPrevHunk)
    window.addEventListener(REVIEW_KEY_EVENTS.askAgent, onAskAgent)
    window.addEventListener(REVIEW_KEY_EVENTS.explain, onExplain)
    window.addEventListener(REVIEW_KEY_EVENTS.comment, onComment)
    window.addEventListener(REVIEW_KEY_EVENTS.note, onNote)
    window.addEventListener(REVIEW_KEY_EVENTS.peekDefinition, onPeekDefinition)
    return () => {
      window.removeEventListener(REVIEW_KEY_EVENTS.nextHunk, onNextHunk)
      window.removeEventListener(REVIEW_KEY_EVENTS.prevHunk, onPrevHunk)
      window.removeEventListener(REVIEW_KEY_EVENTS.askAgent, onAskAgent)
      window.removeEventListener(REVIEW_KEY_EVENTS.explain, onExplain)
      window.removeEventListener(REVIEW_KEY_EVENTS.comment, onComment)
      window.removeEventListener(REVIEW_KEY_EVENTS.note, onNote)
      window.removeEventListener(REVIEW_KEY_EVENTS.peekDefinition, onPeekDefinition)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selection,
    file.path,
    hunkNearTop,
    scrollHunkIntoView,
    openAgentPanel,
    selectionTouchesRevealed,
  ])

  const handleSplitDividerMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const container = scrollRef.current
      if (!container) return
      splitDragState.current = {
        active: true,
        startX: e.clientX,
        startPct: splitLeftPct,
        containerWidth: container.getBoundingClientRect().width,
      }
      e.preventDefault()
    },
    [splitLeftPct]
  )

  const splitRightPct = useMemo(() => 100 - splitLeftPct, [splitLeftPct])

  const refreshComments = useLoadInlineComments(repoRoot)

  const numColWidth = useMemo(() => {
    if (!diff) return 44
    let max = 0
    for (const hunk of diff.hunks) {
      for (const line of hunk.lines) {
        if ((line.oldLineNumber ?? 0) > max) max = line.oldLineNumber ?? 0
        if ((line.newLineNumber ?? 0) > max) max = line.newLineNumber ?? 0
      }
    }
    if (fileText.status === 'ready') max = Math.max(max, fileText.lines.length)
    const digits = String(max || 1).length
    return 20 + digits * 8 + 8
  }, [diff, fileText])

  const commentedLines = useMemo(() => {
    const set = new Set<string>()
    for (const thread of fileThreads) {
      const start = thread.startLine ?? thread.line
      for (let n = start; n <= thread.line; n++) {
        set.add(`${thread.side}:${n}`)
      }
    }
    return set
  }, [fileThreads])

  const isCommented = useCallback(
    (lineNum: number, side: 'LEFT' | 'RIGHT') =>
      lineNum > 0 && commentedLines.has(`${side}:${lineNum}`),
    [commentedLines]
  )

  const threadsForLine = useCallback(
    (lineNum: number, side: 'LEFT' | 'RIGHT'): Thread[] =>
      fileThreads.filter((t) => t.line === lineNum && t.side === side),
    [fileThreads]
  )

  /** Comment visibility (R2): all shows every thread (resolved dimmed);
   * unresolved hides resolved and outdated; hidden shows none, only a pip. */
  const visibleThreadsForLine = useCallback(
    (lineNum: number, side: 'LEFT' | 'RIGHT'): Thread[] => {
      const all = threadsForLine(lineNum, side)
      if (commentVisibility === 'hidden') return []
      if (commentVisibility === 'unresolved') return all.filter((t) => !t.resolved && !t.outdated)
      return all
    },
    [threadsForLine, commentVisibility]
  )

  const fileFindings = useMemo(
    () =>
      agentRuns
        .filter((r) => r.status === 'done')
        .flatMap((r) => r.findings)
        .filter((f) => !f.dismissed && f.path === file.path),
    [agentRuns, file.path]
  )

  const findingsForLine = useCallback(
    (lineNum: number, side: 'LEFT' | 'RIGHT') =>
      fileFindings.filter((f) => f.side === side && f.endLine === lineNum),
    [fileFindings]
  )

  const notesForLine = useCallback(
    (lineNum: number, side: 'LEFT' | 'RIGHT') =>
      notes.filter((n) => n.path === file.path && n.line === lineNum && n.side === side),
    [notes, file.path]
  )

  const draftsForLine = useCallback(
    (lineNum: number, side: 'LEFT' | 'RIGHT') =>
      drafts.filter((d) => d.path === file.path && d.line === lineNum && d.side === side),
    [drafts, file.path]
  )

  // One chip object per line, kept across renders so memoised rows see the same prop.
  const chipsByLine = useMemo(() => {
    const chips = new Map<number, GutterChip>()
    for (const fn of pr.insights?.complexity.functions ?? []) {
      if (fn.path !== file.path || fn.line == null || fn.branchDelta <= 0 || chips.has(fn.line)) {
        continue
      }
      const untested = pr.insights?.coverage.untestedFunctions.includes(fn.name)
      chips.set(
        fn.line,
        untested
          ? { kind: 'danger', label: 'untested' }
          : { kind: 'warn', label: `+${fn.branchDelta}` }
      )
    }
    return chips
  }, [pr.insights, file.path])

  // The gutter column is as wide as the widest chip it holds; a table squeezes
  // an unsized cell below its content, which let the chip overlap the code.
  const gutterWidth = useMemo(() => {
    const labels = (pr.insights?.complexity.functions ?? [])
      .filter((f) => f.path === file.path && f.line != null && f.branchDelta > 0)
      .map((f) =>
        pr.insights?.coverage.untestedFunctions.includes(f.name) ? 'untested' : `+${f.branchDelta}`
      )
    const widest = Math.max(0, ...labels.map((l) => l.length))
    return widest === 0 ? 18 : 22 + widest * 7
  }, [pr.insights, file.path])

  const handleGutterMouseDown = useCallback(
    (e: React.MouseEvent, lineNum: number, side: 'LEFT' | 'RIGHT') => {
      e.preventDefault()
      e.stopPropagation()
      lineDragRef.current = { active: true, side, startLine: lineNum, endLine: lineNum }
      setDragPreview({ side, startLine: lineNum, endLine: lineNum })
    },
    []
  )

  const handleRowMouseEnter = useCallback((lineNum: number, side: 'LEFT' | 'RIGHT') => {
    const drag = lineDragRef.current
    if (!drag.active || drag.side !== side || lineNum === 0) return
    drag.endLine = lineNum
    setDragPreview({ side, startLine: drag.startLine, endLine: lineNum })
  }, [])

  const isLineSelected = useCallback(
    (lineNum: number, side: 'LEFT' | 'RIGHT') => {
      if (lineNum === 0) return false
      if (dragPreview && dragPreview.side === side) {
        const lo = Math.min(dragPreview.startLine, dragPreview.endLine)
        const hi = Math.max(dragPreview.startLine, dragPreview.endLine)
        return lineNum >= lo && lineNum <= hi
      }
      if (selection && selection.path === file.path && selection.side === side) {
        return lineNum >= selection.startLine && lineNum <= selection.endLine
      }
      return false
    },
    [dragPreview, selection, file.path]
  )

  const clearSelectionOnBackgroundClick = useCallback(
    (e: React.MouseEvent) => {
      if (dragJustEndedRef.current) return
      const target = e.target as HTMLElement
      if (target.closest('.rs-float') || target.closest('.diff-gutter-btn')) return
      if (selection?.path === file.path) setSelection(null)
    },
    [selection, file.path, setSelection]
  )

  const goToPath = useCallback(
    (path: string) => {
      const chapterId = findChapterId(pr.chapters, path)
      if (chapterId) setCurrentChapter(chapterId)
      setCurrentFile(path)
    },
    [pr.chapters, setCurrentChapter, setCurrentFile]
  )

  const prPaths = useMemo(
    () => new Set(pr.chapters.flatMap((c) => c.files.map((f) => f.path))),
    [pr.chapters]
  )

  const openTests = (anchor: string, code: string, hunkHeader?: string) =>
    setTestsFor({
      anchor,
      block: { repoRoot, headSHA: pr.headSHA, path: file.path, code, hunkHeader },
    })

  const openTestInReview = (path: string, line: number) => {
    setPendingJump({ path, line })
    goToPath(path)
  }

  const performedJumpRef = useRef(pendingJump)
  useEffect(() => {
    if (!pendingJump || !diff || pendingJump.path !== file.path) return
    if (performedJumpRef.current === pendingJump) return
    const index = items.findIndex((item) => itemShowsNewLine(item, pendingJump.line))
    if (index < 0) return
    performedJumpRef.current = pendingJump
    listRef.current?.scrollToIndex(index, 'center')
  }, [pendingJump, diff, file.path, items])

  const hunkCode = (lines: Array<{ type: string; content: string }>) =>
    lines
      .filter((l) => l.type !== 'remove')
      .map((l) => l.content)
      .join('\n')

  const selectionCode = (sel: { side: 'LEFT' | 'RIGHT'; startLine: number; endLine: number }) =>
    (diff?.hunks ?? [])
      .flatMap((h) => h.lines)
      .filter((l) => {
        const n = sel.side === 'LEFT' ? l.oldLineNumber : l.newLineNumber
        return n != null && n >= sel.startLine && n <= sel.endLine
      })
      .map((l) => l.content)
      .join('\n')

  const testsButton = (anchor: string, code: string, hunkHeader?: string) => (
    <>
      <button
        type="button"
        className="rs-hunk-tests"
        onClick={(e) => {
          e.stopPropagation()
          openTests(anchor, code, hunkHeader)
        }}
        aria-label="Jump to the tests for this block"
      >
        Tests
      </button>
      {testsFor?.anchor === anchor && (
        <TestsPopover
          block={testsFor.block}
          prPaths={prPaths}
          onOpenInReview={openTestInReview}
          onClose={() => setTestsFor(null)}
        />
      )}
    </>
  )

  const closeComposer = () => setComposerAnchor(null)

  const saveNote = () => {
    if (!noteAnchor || !noteDraft.trim()) return
    addNote(
      { repoRoot, prNumber: pr.number, headSHA: pr.headSHA },
      {
        id: crypto.randomUUID(),
        path: file.path,
        line: noteAnchor.line,
        side: noteAnchor.side,
        body: noteDraft,
        createdAt: new Date().toISOString(),
      }
    )
    setNoteAnchor(null)
    setNoteDraft('')
  }

  const renderSelectionExtras = (lineNum: number, side: 'LEFT' | 'RIGHT') => (
    <>
      {selection &&
        selection.path === file.path &&
        selection.side === side &&
        selection.endLine === lineNum &&
        dragPreview === null && (
          <tr>
            <td colSpan={5} className="rs-hunk-anchor">
              <SelectionBar
                canComment={!selectionTouchesRevealed(selection)}
                onTests={() => openTests('selection', selectionCode(selection))}
                onAskAgent={() =>
                  openAgentPanel(
                    {
                      kind: 'lines',
                      path: file.path,
                      startLine: selection.startLine,
                      endLine: selection.endLine,
                      side: selection.side,
                      chapter: null,
                    },
                    'review'
                  )
                }
                onExplain={() =>
                  openAgentPanel(
                    {
                      kind: 'lines',
                      path: file.path,
                      startLine: selection.startLine,
                      endLine: selection.endLine,
                      side: selection.side,
                      chapter: null,
                    },
                    'explain',
                    true
                  )
                }
                onAddNote={() => setNoteAnchor({ line: selection.endLine, side: selection.side })}
                onComment={() =>
                  setComposerAnchor({
                    line: selection.endLine,
                    startLine:
                      selection.startLine !== selection.endLine ? selection.startLine : null,
                    side: selection.side,
                    initialBody: '',
                    fromFindingId: null,
                  })
                }
              />
              {testsFor?.anchor === 'selection' && (
                <TestsPopover
                  block={testsFor.block}
                  prPaths={prPaths}
                  onOpenInReview={openTestInReview}
                  onClose={() => setTestsFor(null)}
                />
              )}
            </td>
          </tr>
        )}
      {noteAnchor && noteAnchor.line === lineNum && noteAnchor.side === side && (
        <tr>
          <td colSpan={5}>
            <div className="rs-note-composer">
              <textarea
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                rows={3}
                placeholder="Private note…"
              />
              <div className="rs-note-composer-actions">
                <button type="button" className="rs-btn rs-btn--pri" onClick={saveNote}>
                  Save
                </button>
                <button
                  type="button"
                  className="rs-btn"
                  onClick={() => {
                    setNoteAnchor(null)
                    setNoteDraft('')
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )

  const hasAnnotations = useCallback(
    (lineNum: number, side: 'LEFT' | 'RIGHT') =>
      (composerAnchor?.line === lineNum && composerAnchor.side === side) ||
      visibleThreadsForLine(lineNum, side).length > 0 ||
      (agentNotesOn && findingsForLine(lineNum, side).length > 0) ||
      notesForLine(lineNum, side).length > 0 ||
      draftsForLine(lineNum, side).length > 0,
    [
      composerAnchor,
      visibleThreadsForLine,
      agentNotesOn,
      findingsForLine,
      notesForLine,
      draftsForLine,
    ]
  )

  /** The annotation content for one line/side: composer, threads, agent notes,
   * private notes, drafts. Unwrapped so it can sit in a <tr><td> (unified) or
   * a plain <div> (split). */
  const renderAnnotationContent = (lineNum: number, side: 'LEFT' | 'RIGHT') => {
    const lineThreads = visibleThreadsForLine(lineNum, side)
    const findings = agentNotesOn ? findingsForLine(lineNum, side) : []
    const lineNotes = notesForLine(lineNum, side)
    const lineDrafts = draftsForLine(lineNum, side)
    return (
      <>
        {composerAnchor?.line === lineNum && composerAnchor.side === side && (
          <CommentComposer
            repoRoot={repoRoot}
            prNumber={pr.number}
            commitId={pr.headSHA}
            path={file.path}
            line={composerAnchor.line}
            startLine={composerAnchor.startLine ?? undefined}
            side={composerAnchor.side}
            initialBody={composerAnchor.initialBody}
            fromFindingId={composerAnchor.fromFindingId}
            onSubmitted={closeComposer}
            onCancel={closeComposer}
          />
        )}
        {lineThreads.map((thread) => (
          <React.Fragment key={thread.id}>
            <InlineCommentThread
              thread={thread}
              onReply={(tid) =>
                setReplyTarget({ threadId: tid, inReplyToId: thread.comments[0].id })
              }
            />
            {replyTarget?.threadId === thread.id && (
              <CommentComposer
                repoRoot={repoRoot}
                prNumber={pr.number}
                inReplyToId={replyTarget.inReplyToId}
                onSubmitted={() => {
                  setReplyTarget(null)
                  refreshComments()
                }}
                onCancel={() => setReplyTarget(null)}
              />
            )}
          </React.Fragment>
        ))}
        {findings.map((f) => (
          <AgentNote key={f.id} severity={f.severity} body={f.body} />
        ))}
        {lineNotes.map((n) => (
          <div className="rs-thread" key={n.id}>
            <div className="rs-thread-th">Private note</div>
            <div className="rs-thread-bd">{n.body}</div>
            <div className="rs-thread-actions">
              <button
                type="button"
                className="rs-btn"
                onClick={() =>
                  removeNote({ repoRoot, prNumber: pr.number, headSHA: pr.headSHA }, n.id)
                }
              >
                Delete
              </button>
            </div>
          </div>
        ))}
        {lineDrafts.map((d) => (
          <div className="rs-thread" key={d.id}>
            <div className="rs-thread-th">Pending · sent when you submit your review</div>
            <div className="rs-thread-bd">
              <RichContent>{d.body}</RichContent>
            </div>
            <div className="rs-thread-actions">
              <button
                type="button"
                className="rs-btn"
                onClick={() => {
                  const next = prompt('Edit draft', d.body)
                  if (next != null)
                    updateDraft({ repoRoot, prNumber: pr.number, headSHA: pr.headSHA }, d.id, next)
                }}
              >
                Edit
              </button>
              <button
                type="button"
                className="rs-btn"
                onClick={() =>
                  removeDraft({ repoRoot, prNumber: pr.number, headSHA: pr.headSHA }, d.id)
                }
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </>
    )
  }

  const renderLineAnnotations = (lineNum: number, side: 'LEFT' | 'RIGHT') =>
    hasAnnotations(lineNum, side) ? (
      <tr>
        <td colSpan={5}>{renderAnnotationContent(lineNum, side)}</td>
      </tr>
    ) : null

  const showHiddenComments = useCallback(() => setCommentVisibility('all'), [setCommentVisibility])

  /** What a memoised row shows for its line, as primitives so unchanged rows skip rendering. */
  const rowProps = (lineNum: number, side: Side, expanded: boolean) => ({
    expanded,
    language: lang,
    selected: isLineSelected(lineNum, side),
    commented: isCommented(lineNum, side),
    chip: side === 'RIGHT' ? (chipsByLine.get(lineNum) ?? null) : null,
    hiddenThreadCount: commentVisibility === 'hidden' ? threadsForLine(lineNum, side).length : 0,
    findingCount: agentNotesOn ? 0 : findingsForLine(lineNum, side).length,
    gutterWidth,
    onGutterMouseDown: handleGutterMouseDown,
    onRowMouseEnter: handleRowMouseEnter,
    onShowHiddenComments: showHiddenComments,
  })

  const renderUnifiedLine = (line: DiffLine, expanded: boolean) => {
    const lineNum = line.newLineNumber ?? line.oldLineNumber ?? 0
    const side: Side = line.type === 'remove' ? 'LEFT' : 'RIGHT'
    return (
      <>
        <UnifiedLineRow line={line} {...rowProps(lineNum, side, expanded)} />
        {renderSelectionExtras(lineNum, side)}
        {renderLineAnnotations(lineNum, side)}
      </>
    )
  }

  const renderSplitPair = (
    leftLine: DiffLine | null | undefined,
    rightLine: DiffLine | null | undefined,
    expanded: boolean
  ) => {
    const leftLineNum = leftLine?.oldLineNumber ?? 0
    const rightLineNum = rightLine?.newLineNumber ?? 0
    const leftThreads = leftLine ? visibleThreadsForLine(leftLineNum, 'LEFT') : []
    const rightThreads = rightLine ? visibleThreadsForLine(rightLineNum, 'RIGHT') : []
    const showComposerLeft =
      leftLine != null && composerAnchor?.line === leftLineNum && composerAnchor.side === 'LEFT'
    const showComposerRight =
      rightLine != null && composerAnchor?.line === rightLineNum && composerAnchor.side === 'RIGHT'
    const leftAnnotated = leftLine != null && hasAnnotations(leftLineNum, 'LEFT')
    const rightAnnotated = rightLine != null && hasAnnotations(rightLineNum, 'RIGHT')
    const hasComments =
      leftThreads.length > 0 ||
      rightThreads.length > 0 ||
      showComposerLeft ||
      showComposerRight ||
      leftAnnotated ||
      rightAnnotated
    return (
      <>
        {/* One flex row per line pair — identical structure to diff-split-tables */}
        <div className="diff-split-tables">
          <table
            className="diff-table diff-table--split diff-table--left"
            style={{ width: `${splitLeftPct}%` }}
          >
            <tbody>
              {leftLine ? (
                <SplitLineRow
                  line={leftLine}
                  side="LEFT"
                  numColWidth={numColWidth}
                  {...rowProps(leftLineNum, 'LEFT', expanded)}
                />
              ) : (
                <tr className="diff-line">
                  <td colSpan={3} className="diff-line__empty-cell" />
                </tr>
              )}
            </tbody>
          </table>
          <div className="diff-split-resize-handle" onMouseDown={handleSplitDividerMouseDown} />
          <table
            className="diff-table diff-table--split diff-table--right"
            style={{ width: `${splitRightPct}%` }}
          >
            <tbody>
              {rightLine ? (
                <SplitLineRow
                  line={rightLine}
                  side="RIGHT"
                  numColWidth={numColWidth}
                  {...rowProps(rightLineNum, 'RIGHT', expanded)}
                />
              ) : (
                <tr className="diff-line">
                  <td colSpan={4} className="diff-line__empty-cell" />
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {/* Comment row: uses exact same flex classes as code rows for pixel-perfect alignment */}
        {hasComments && (
          <div className="diff-split-tables">
            <div className="diff-table--split" style={{ width: `${splitLeftPct}%` }}>
              {leftLine != null && (showComposerLeft || leftAnnotated) && (
                <div className="diff-split-comment-inner" style={{ paddingLeft: numColWidth + 18 }}>
                  {renderAnnotationContent(leftLineNum, 'LEFT')}
                </div>
              )}
            </div>
            <div className="diff-split-resize-handle" onMouseDown={handleSplitDividerMouseDown} />
            <div className="diff-table--split" style={{ width: `${splitRightPct}%` }}>
              {rightLine != null && (showComposerRight || rightAnnotated) && (
                <div className="diff-split-comment-inner" style={{ paddingLeft: numColWidth + 18 }}>
                  {renderAnnotationContent(rightLineNum, 'RIGHT')}
                </div>
              )}
            </div>
          </div>
        )}
      </>
    )
  }

  const renderExpanderContent = (gap: { key: string }, hidden: number | null) => {
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
    const busy = fileText.status === 'loading'
    const allLabel = hidden == null ? 'Show all lines' : `Show all ${hidden} lines`
    return (
      <>
        {gap.key !== 'top' && (
          <button
            type="button"
            className="diff-gap-btn"
            disabled={busy}
            aria-label={`Show ${EXPAND_STEP} lines below`}
            title={`Show ${EXPAND_STEP} lines below`}
            onClick={() => expandGap(gap.key, 'below')}
          >
            <ChevronDown aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          className="diff-gap-btn"
          disabled={busy}
          aria-label={allLabel}
          title={allLabel}
          onClick={() => expandGap(gap.key, 'all')}
        >
          <UnfoldVertical aria-hidden="true" />
          <span>{hidden == null ? 'All lines' : `${hidden} lines`}</span>
        </button>
        {gap.key !== 'bottom' && (
          <button
            type="button"
            className="diff-gap-btn"
            disabled={busy}
            aria-label={`Show ${EXPAND_STEP} lines above`}
            title={`Show ${EXPAND_STEP} lines above`}
            onClick={() => expandGap(gap.key, 'above')}
          >
            <ChevronUp aria-hidden="true" />
          </button>
        )}
      </>
    )
  }

  const unifiedTable = (rows: React.ReactNode) => (
    <table className="diff-table diff-table--review diff-table--row">
      <colgroup>
        <col style={{ width: numColWidth + NUM_CELL_CHROME_PX }} />
        <col style={{ width: numColWidth + NUM_CELL_CHROME_PX }} />
        <col style={{ width: gutterWidth + GUTTER_CELL_PADDING_PX }} />
        <col className="diff-col--prefix" />
        <col />
      </colgroup>
      <tbody>{rows}</tbody>
    </table>
  )

  const toggleMoved = (key: string) =>
    setExpandedMoved((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const renderMovedRow = (mark: MovedMark) => {
    const here = mark.side === 'RIGHT'
    const otherPath = here ? mark.block.fromPath : mark.block.toPath
    return (
      <MovedRow
        symbol={mark.block.symbol}
        lineCount={mark.block.lineCount}
        otherPath={otherPath}
        otherLine={here ? mark.block.fromLine : mark.block.toLine}
        direction={here ? 'here' : 'away'}
        expanded={mark.expanded}
        onToggleShow={() => toggleMoved(mark.key)}
        onGoToOrigin={() => goToPath(otherPath)}
      />
    )
  }

  const renderHunkHeader = (hunk: DiffHunk, hunkIndex: number) => {
    const bar = (
      <div className="rs-hunk-bar">
        <span className="rs-hunk-bar__text">{hunk.header}</span>
        {testsButton(`hunk-${hunkIndex}`, hunkCode(hunk.lines), hunk.header)}
      </div>
    )
    return diffViewMode === 'unified' ? (
      unifiedTable(
        <tr>
          <td colSpan={5} className="diff-hunk-header rs-hunk-anchor">
            {bar}
          </td>
        </tr>
      )
    ) : (
      <div className="diff-split-header rs-hunk-anchor">{bar}</div>
    )
  }

  const renderGapExpander = (gapKey: string, hidden: number | null) => {
    const content = renderExpanderContent({ key: gapKey }, hidden)
    return diffViewMode === 'unified' ? (
      unifiedTable(
        <tr className="diff-gap-row">
          <td colSpan={5}>{content}</td>
        </tr>
      )
    ) : (
      <div className="diff-gap-row">{content}</div>
    )
  }

  const formattingNotice = (hiddenCount: number) => (
    <div className="review-diff-formatting-notice">
      {hiddenCount} formatting-only hunk
      {hiddenCount !== 1 ? 's' : ''} hidden —{' '}
      <button
        className="review-diff-formatting-show-btn"
        onClick={() => setHideFormattingHunks(false)}
      >
        show all
      </button>
    </div>
  )

  const renderUnifiedItem = (line: DiffLine, moved: MovedMark | null) =>
    unifiedTable(
      <>
        {moved?.isStart && (
          <tr>
            <td colSpan={5}>{renderMovedRow(moved)}</td>
          </tr>
        )}
        {renderUnifiedLine(line, false)}
      </>
    )

  const renderItem = (item: DiffItem): React.ReactNode => {
    switch (item.kind) {
      case 'notice':
        return formattingNotice(item.hiddenCount)
      case 'hunk-header':
        return renderHunkHeader(item.hunk, item.hunkIndex)
      case 'line':
        return renderUnifiedItem(item.line, item.moved)
      case 'split-row':
        return (
          <>
            {item.movedLeft?.isStart && renderMovedRow(item.movedLeft)}
            {item.movedRight?.isStart && renderMovedRow(item.movedRight)}
            {renderSplitPair(item.left, item.right, false)}
          </>
        )
      case 'gap-line':
        return diffViewMode === 'unified'
          ? unifiedTable(renderUnifiedLine(item.line, true))
          : renderSplitPair(item.line, item.line, true)
      case 'gap-expander':
        return renderGapExpander(item.gapKey, item.hidden)
      case 'hotspot':
        return (
          <div className="complexity-hotspot-annotation" role="alert">
            <TriangleAlert aria-hidden="true" /> {item.message}
          </div>
        )
    }
  }

  return (
    <div className="review-diff-pane">
      <div className="rs-fh">
        <span className="rs-p" title={file.path}>
          {dirName && <span className="rs-p-dir">{dirName}</span>}
          {baseName}
        </span>
        <button
          type="button"
          className={`rs-risk rs-risk--${file.riskScore.level}`}
          onClick={onShowRisk}
          title="Why this risk level?"
        >
          {file.riskScore.level === 'high'
            ? 'High risk'
            : file.riskScore.level === 'medium'
              ? 'Medium risk'
              : 'Low risk'}
        </button>
        {isChangedSince && diffRange === 'since' && (
          <span className="rs-note rs-note--changed" title="Changed since you viewed">
            <span className="rs-long">Changed since you viewed</span>
            <span className="rs-short">Changed</span>
          </span>
        )}
        <span className="rs-sp" />
        <UsesPopover
          uses={usesWithDef.map((u) => ({
            symbol: u.symbol,
            definedInStep: u.definedInStep!,
            read: u.definedInPath != null && viewedFiles.has(u.definedInPath),
          }))}
          onPeekDefinition={handlePeekDefinition}
        />
        <ViewMenu sinceNote={sinceNote ?? historyNote} />
        <span className="rs-fh-sep" />
        <label className="rs-viewed">
          <input
            type="checkbox"
            checked={isViewed}
            onChange={() =>
              isViewed
                ? unmarkFileViewed(
                    { repoRoot, prNumber: pr.number, headSHA: pr.headSHA },
                    file.path
                  )
                : markFileViewed({ repoRoot, prNumber: pr.number, headSHA: pr.headSHA }, file.path)
            }
          />
          Viewed
        </label>
      </div>

      {/* Diff content */}
      <div className="review-diff-scroll" ref={scrollRef} onClick={clearSelectionOnBackgroundClick}>
        {file.isBinary ? (
          <div className="review-diff-binary">Binary file — diff not available.</div>
        ) : diffLoading ? (
          <div className="review-diff-loading">Loading diff…</div>
        ) : diffError ? (
          <div className="review-diff-error">Failed to load diff: {diffError}</div>
        ) : diff ? (
          <div className={`review-diff-table-wrap review-diff-table-wrap--${diffViewMode}`}>
            <VirtualDiffList
              items={items}
              scrollRef={scrollRef}
              renderItem={renderItem}
              handleRef={listRef}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}
