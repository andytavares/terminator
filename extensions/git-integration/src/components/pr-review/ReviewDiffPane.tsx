import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { TriangleAlert } from 'lucide-react'
import { ViewMenu } from './ViewMenu'
import { UsesPopover } from './UsesPopover'
import { TestsPopover, type TestBlock } from './TestsPopover'
import { InlineCommentThread } from './InlineCommentThread'
import { RichContent } from './RichContent'
import { CommentComposer } from './CommentComposer'
import { AgentNote } from './AgentNote'
import { SelectionBar } from './SelectionBar'
import { MovedRow } from './MovedRow'
import { usePrReviewStore } from '../../stores/pr-review.store'
import { useReviewUiStore, REVIEW_KEY_EVENTS } from '../../stores/review-ui.store'
import {
  detectComplexityHotspots,
  computeFileCyclomaticDelta,
  classifyHunk,
  parseDiff,
} from '../../github/pr-review-service'
import { detectLanguage, highlight, buildSplitRows } from '../FileDiffView'
import { useLoadInlineComments } from '../../hooks/usePrReview'
import type { PrChangedFile, PrReviewDetail, Chapter, Thread } from '../../schemas/pr-review.schema'
import type { FileDiff } from '../../schemas/git.schema'
import { FileDiffSchema } from '../../schemas/git.schema'
import { githubAPI } from '../../api/github'
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
  const [diff, setDiff] = useState<FileDiff | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [diffError, setDiffError] = useState<string | null>(null)
  const [sinceNote, setSinceNote] = useState<string | null>(null)
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
  } = usePrReviewStore()
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
  } = useReviewUiStore()
  const scrollRef = useRef<HTMLDivElement>(null)

  // Use refs so the complexity-patch effect always has current values without
  // making them deps of the diff-loading effect (which would cause an infinite
  // loop: patchFileComplexity updates activePr.chapters → pr.chapters ref
  // changes → effect re-runs → setDiff(null) → blank screen).
  const patchFileComplexityRef = useRef(patchFileComplexity)
  patchFileComplexityRef.current = patchFileComplexity
  const prChaptersRef = useRef<Chapter[]>(pr.chapters)
  prChaptersRef.current = pr.chapters

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

  const movedKey = (fromPath: string, fromLine: number, toPath: string, toLine: number) =>
    `${fromPath}:${fromLine}->${toPath}:${toLine}`

  const movedBlockForLine = useCallback(
    (lineNum: number, side: 'LEFT' | 'RIGHT') => {
      if (side === 'RIGHT') {
        return movedHere.find((b) => lineNum >= b.toLine && lineNum < b.toLine + b.lineCount)
      }
      return movedAway.find((b) => lineNum >= b.fromLine && lineNum < b.fromLine + b.lineCount)
    },
    [movedHere, movedAway]
  )

  useEffect(() => {
    setDiff(null)
    setDiffError(null)
    setSinceNote(null)
    currentHunkIndexRef.current = 0
    if (file.isBinary) return
    setDiffLoading(true)

    const loadFull = () =>
      githubAPI
        .prFileDiff(repoRoot, pr.number, file.path)
        .then((result) => {
          if ('error' in result) {
            setDiffError((result as { error: string }).error)
            return
          }
          const parsed = FileDiffSchema.safeParse((result as { diff: unknown }).diff)
          if (parsed.success) {
            setDiff(parsed.data)
          } else {
            setDiffError('Unexpected diff format from server')
          }
        })
        .catch((e) => setDiffError(String(e)))

    const viewedSha = viewedAt[file.path]
    if (diffRange === 'since' && isChangedSince && viewedSha) {
      githubAPI
        .prCompare(repoRoot, viewedSha, pr.headSHA)
        .then((cmp) => {
          if ('error' in cmp || (cmp as { rewritten?: boolean }).rewritten) {
            if ((cmp as { rewritten?: boolean }).rewritten) {
              setSinceNote('History rewritten — showing the whole file')
            }
            return loadFull()
          }
          const entry = (cmp as { files: Array<{ path: string; patch: string }> }).files.find(
            (f) => f.path === file.path
          )
          if (!entry) return loadFull()
          setDiff(parseDiff(entry.patch, file.path))
          setSinceNote(`Showing ${viewedSha.slice(0, 8)} … head`)
        })
        .catch(() => loadFull())
        .finally(() => setDiffLoading(false))
      return
    }

    if (historyRewritten && isChangedSince) {
      setSinceNote('History rewritten — showing the whole file')
    }
    loadFull().finally(() => setDiffLoading(false))
  }, [
    file.path,
    file.isBinary,
    repoRoot,
    pr.number,
    pr.headSHA,
    diffRange,
    isChangedSince,
    viewedAt,
    historyRewritten,
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
  useEffect(() => {
    if (!composerRequest || composerRequest.path !== file.path) return
    setComposerAnchor({
      line: composerRequest.line,
      startLine: composerRequest.startLine,
      side: composerRequest.side,
      initialBody: composerRequest.body,
      fromFindingId: composerRequest.fromFindingId,
    })
    requestComposer(null)
  }, [composerRequest, file.path, requestComposer])

  // Tracks which hunk nextHunk/prevHunk last scrolled to, since jsdom (and
  // some real layouts) can't be trusted to report bounding-rect positions.
  const currentHunkIndexRef = useRef(0)

  const scrollHunkIntoView = useCallback(
    (direction: 1 | -1) => {
      const container = scrollRef.current
      if (!container) return
      const headers = Array.from(container.querySelectorAll<HTMLElement>('.diff-hunk-header'))
      if (headers.length === 0) return
      const nextIndex = currentHunkIndexRef.current + direction
      if (nextIndex < 0) {
        onPrevFile()
        return
      }
      if (nextIndex >= headers.length) {
        onNextFile()
        return
      }
      currentHunkIndexRef.current = nextIndex
      headers[nextIndex].scrollIntoView({ block: 'start' })
    },
    [onNextFile, onPrevFile]
  )

  const hunkNearTop = useCallback((): { startLine: number; endLine: number } | null => {
    if (!diff) return null
    for (const hunk of diff.hunks) {
      const lines = hunk.lines.map((l) => l.newLineNumber ?? l.oldLineNumber ?? 0).filter(Boolean)
      if (lines.length > 0) return { startLine: Math.min(...lines), endLine: Math.max(...lines) }
    }
    return null
  }, [diff])

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
      if (selection && selection.path === file.path) {
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
  }, [selection, file.path, hunkNearTop, scrollHunkIntoView, openAgentPanel])

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
    const digits = String(max || 1).length
    return 20 + digits * 8 + 8
  }, [diff])

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

  const findingsForLine = useCallback(
    (lineNum: number, side: 'LEFT' | 'RIGHT') =>
      agentRuns
        .filter((r) => r.status === 'done')
        .flatMap((r) => r.findings)
        .filter(
          (f) => !f.dismissed && f.path === file.path && f.side === side && f.endLine === lineNum
        ),
    [agentRuns, file.path]
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

  const insightsChipForLine = useCallback(
    (lineNum: number) => {
      const fn = pr.insights?.complexity.functions.find(
        (f) => f.path === file.path && f.line === lineNum && f.branchDelta > 0
      )
      if (!fn) return null
      const untested = pr.insights?.coverage.untestedFunctions.includes(fn.name)
      return untested
        ? { kind: 'danger' as const, label: 'untested' }
        : { kind: 'warn' as const, label: `+${fn.branchDelta}` }
    },
    [pr.insights, file.path]
  )

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

  const hotspots = diff ? detectComplexityHotspots(diff) : []
  const hotspotHunks = new Set(hotspots.map((h) => h.hunkIndex))

  const visibleHunks = useMemo(() => {
    if (!diff) return []
    if (!hideFormattingHunks) return diff.hunks.map((h, i) => ({ hunk: h, index: i }))
    return diff.hunks
      .map((h, i) => ({ hunk: h, index: i }))
      .filter(({ hunk }) => classifyHunk(hunk) === 'semantic')
  }, [diff, hideFormattingHunks])

  const hiddenFormattingCount = diff ? diff.hunks.length - visibleHunks.length : 0

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

  const handlePeekDefinition = useCallback(() => {
    const use = usesWithDef[0]
    if (!use || !use.definedInPath) return
    const chapterId = findChapterId(pr.chapters, use.definedInPath)
    if (chapterId) setCurrentChapter(chapterId)
    setCurrentFile(use.definedInPath)
  }, [usesWithDef, pr.chapters, setCurrentChapter, setCurrentFile])

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

  useEffect(() => {
    if (!pendingJump || !diff || pendingJump.path !== file.path) return
    scrollRef.current
      ?.querySelector<HTMLElement>(`[data-new-line="${pendingJump.line}"]`)
      ?.scrollIntoView({ block: 'center' })
    setPendingJump(null)
  }, [pendingJump, diff, file.path])

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
    addNote(repoRoot, pr.number, pr.headSHA, {
      id: crypto.randomUUID(),
      path: file.path,
      line: noteAnchor.line,
      side: noteAnchor.side,
      body: noteDraft,
      createdAt: new Date().toISOString(),
    })
    setNoteAnchor(null)
    setNoteDraft('')
  }

  const renderSelectionExtras = (lineNum: number, side: 'LEFT' | 'RIGHT') => (
    <>
      {selection &&
        selection.path === file.path &&
        selection.side === side &&
        selection.endLine === lineNum &&
        !lineDragRef.current.active && (
          <tr>
            <td colSpan={5} className="rs-hunk-anchor">
              <SelectionBar
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
                onClick={() => removeNote(repoRoot, pr.number, pr.headSHA, n.id)}
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
                  if (next != null) updateDraft(repoRoot, pr.number, pr.headSHA, d.id, next)
                }}
              >
                Edit
              </button>
              <button
                type="button"
                className="rs-btn"
                onClick={() => removeDraft(repoRoot, pr.number, pr.headSHA, d.id)}
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

  const gutterPip = (lineNum: number, side: 'LEFT' | 'RIGHT') => {
    const hiddenThreadCount =
      commentVisibility === 'hidden' ? threadsForLine(lineNum, side).length : 0
    const findings = !agentNotesOn ? findingsForLine(lineNum, side) : []
    return (
      <>
        {hiddenThreadCount > 0 && (
          <button
            type="button"
            className="rs-pip"
            aria-label={`${hiddenThreadCount} hidden comments`}
            onClick={() => setCommentVisibility('all')}
          >
            {hiddenThreadCount}
          </button>
        )}
        {findings.length > 0 && (
          <span className="rs-pip rs-pip--ag" aria-label={`${findings.length} agent notes`}>
            {findings.length}
          </span>
        )}
      </>
    )
  }

  return (
    <div className="review-diff-pane">
      <div className="rs-fh">
        <span className="rs-p" title={file.path}>
          {dirName && <span className="rs-p-dir">{dirName}</span>}
          {baseName}
        </span>
        {file.changeType !== 'modified' && <span className="rs-note">{file.changeType}</span>}
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
        {readingStep && (
          <span className="rs-note">{`Step ${readingStep.step} of ${pr.readingOrder.length}`}</span>
        )}
        {isChangedSince && diffRange === 'since' && (
          <span className="rs-note rs-note--changed" title="Changed since you viewed">
            <span className="rs-long">Changed since you viewed</span>
            <span className="rs-short">Changed</span>
          </span>
        )}
        <span className="rs-note">
          +{file.additions}/−{file.deletions}
        </span>
        <span className="rs-sp" />
        <UsesPopover
          uses={usesWithDef.map((u) => ({
            symbol: u.symbol,
            definedInStep: u.definedInStep!,
            read: u.definedInPath != null && viewedFiles.has(u.definedInPath),
          }))}
          onPeekDefinition={handlePeekDefinition}
        />
        <ViewMenu sinceNote={sinceNote} />
        <span className="rs-fh-sep" />
        <label className="rs-viewed">
          <input
            type="checkbox"
            checked={isViewed}
            onChange={() =>
              isViewed
                ? unmarkFileViewed(repoRoot, pr.number, pr.headSHA, file.path)
                : markFileViewed(repoRoot, pr.number, pr.headSHA, file.path)
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
            {hiddenFormattingCount > 0 && (
              <div className="review-diff-formatting-notice">
                {hiddenFormattingCount} formatting-only hunk
                {hiddenFormattingCount !== 1 ? 's' : ''} hidden —{' '}
                <button
                  className="review-diff-formatting-show-btn"
                  onClick={() => setHideFormattingHunks(false)}
                >
                  show all
                </button>
              </div>
            )}
            {visibleHunks.map(({ hunk, index: hi }) => (
              <React.Fragment key={hi}>
                {diffViewMode === 'unified' ? (
                  <table className="diff-table diff-table--review">
                    <tbody>
                      <tr>
                        <td colSpan={5} className="diff-hunk-header rs-hunk-anchor">
                          <div className="rs-hunk-bar">
                            <span className="rs-hunk-bar__text">{hunk.header}</span>
                            {testsButton(`hunk-${hi}`, hunkCode(hunk.lines), hunk.header)}
                          </div>
                        </td>
                      </tr>
                      {hunk.lines.map((line, li) => {
                        const lineNum = line.newLineNumber ?? line.oldLineNumber ?? 0
                        const side: 'LEFT' | 'RIGHT' = line.type === 'remove' ? 'LEFT' : 'RIGHT'
                        const mb = movedBlockForLine(lineNum, side)
                        const isRangeStart = mb
                          ? lineNum === (side === 'RIGHT' ? mb.toLine : mb.fromLine)
                          : false
                        const key = mb
                          ? movedKey(mb.fromPath, mb.fromLine, mb.toPath, mb.toLine)
                          : null
                        const expanded = key ? expandedMoved.has(key) : false

                        if (mb && !isRangeStart && !expanded) return null

                        return (
                          <React.Fragment key={`${hi}-${li}`}>
                            {mb && isRangeStart && (
                              <tr>
                                <td colSpan={5}>
                                  <MovedRow
                                    symbol={mb.symbol}
                                    lineCount={mb.lineCount}
                                    otherPath={side === 'RIGHT' ? mb.fromPath : mb.toPath}
                                    otherLine={side === 'RIGHT' ? mb.fromLine : mb.toLine}
                                    direction={side === 'RIGHT' ? 'here' : 'away'}
                                    expanded={expanded}
                                    onToggleShow={() =>
                                      setExpandedMoved((prev) => {
                                        const next = new Set(prev)
                                        if (next.has(key!)) next.delete(key!)
                                        else next.add(key!)
                                        return next
                                      })
                                    }
                                    onGoToOrigin={() =>
                                      goToPath(side === 'RIGHT' ? mb.fromPath : mb.toPath)
                                    }
                                  />
                                </td>
                              </tr>
                            )}
                            <tr
                              className={`diff-line diff-line--${line.type}${isLineSelected(lineNum, side) ? ' diff-line--selecting rs-line--selected' : ''}${isCommented(lineNum, side) ? ' diff-line--commented' : ''}`}
                              data-new-line={line.newLineNumber ?? undefined}
                              data-old-line={line.oldLineNumber ?? undefined}
                              onMouseEnter={() => handleRowMouseEnter(lineNum, side)}
                            >
                              <td className="diff-line__old-num diff-line__num-gutter">
                                {line.oldLineNumber ?? ''}
                                {side === 'LEFT' && (
                                  <button
                                    className="diff-gutter-btn"
                                    aria-label="Add comment"
                                    onMouseDown={(e) => handleGutterMouseDown(e, lineNum, side)}
                                  >
                                    +
                                  </button>
                                )}
                              </td>
                              <td className="diff-line__new-num diff-line__num-gutter">
                                {line.newLineNumber ?? ''}
                                {side === 'RIGHT' && (
                                  <button
                                    className="diff-gutter-btn"
                                    aria-label="Add comment"
                                    onMouseDown={(e) => handleGutterMouseDown(e, lineNum, side)}
                                  >
                                    +
                                  </button>
                                )}
                              </td>
                              <td
                                className="rs-gut"
                                style={{ width: gutterWidth, minWidth: gutterWidth }}
                              >
                                {side === 'RIGHT' && insightsChipForLine(lineNum) && (
                                  <span
                                    className={`rs-gutter-chip rs-gutter-chip--${insightsChipForLine(lineNum)!.kind}`}
                                  >
                                    {insightsChipForLine(lineNum)!.label}
                                  </span>
                                )}
                                {gutterPip(lineNum, side)}
                              </td>
                              <td className="diff-line__prefix">
                                {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
                              </td>
                              <td className="diff-line__content">
                                <pre
                                  dangerouslySetInnerHTML={{
                                    __html: highlight(line.content, lang),
                                  }}
                                />
                              </td>
                            </tr>
                            {renderSelectionExtras(lineNum, side)}
                            {renderLineAnnotations(lineNum, side)}
                          </React.Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                ) : (
                  <div className="diff-split-hunk">
                    <div className="diff-split-header rs-hunk-anchor">
                      <div className="rs-hunk-bar">
                        <span className="rs-hunk-bar__text">{hunk.header}</span>
                        {testsButton(`hunk-${hi}`, hunkCode(hunk.lines), hunk.header)}
                      </div>
                    </div>
                    {buildSplitRows(hunk.lines).map((row, ri) => {
                      const leftLine = row.kind === 'context' ? row.line : row.oldLine
                      const rightLine = row.kind === 'context' ? row.line : row.newLine
                      const leftLineNum = leftLine?.oldLineNumber ?? 0
                      const rightLineNum = rightLine?.newLineNumber ?? 0

                      // Moved code (S4): a moved-away block only has removed
                      // (left) lines; a moved-here block only has added
                      // (right) lines, so each side is checked independently.
                      const mbLeft = leftLine ? movedBlockForLine(leftLineNum, 'LEFT') : undefined
                      const mbRight = rightLine
                        ? movedBlockForLine(rightLineNum, 'RIGHT')
                        : undefined
                      const leftIsStart = mbLeft ? leftLineNum === mbLeft.fromLine : false
                      const rightIsStart = mbRight ? rightLineNum === mbRight.toLine : false
                      const leftKey = mbLeft
                        ? movedKey(mbLeft.fromPath, mbLeft.fromLine, mbLeft.toPath, mbLeft.toLine)
                        : null
                      const rightKey = mbRight
                        ? movedKey(
                            mbRight.fromPath,
                            mbRight.fromLine,
                            mbRight.toPath,
                            mbRight.toLine
                          )
                        : null
                      const leftExpanded = leftKey ? expandedMoved.has(leftKey) : false
                      const rightExpanded = rightKey ? expandedMoved.has(rightKey) : false

                      if (mbLeft && !leftIsStart && !leftExpanded) return null
                      if (mbRight && !rightIsStart && !rightExpanded) return null

                      const leftThreads = leftLine ? visibleThreadsForLine(leftLineNum, 'LEFT') : []
                      const rightThreads = rightLine
                        ? visibleThreadsForLine(rightLineNum, 'RIGHT')
                        : []
                      const showComposerLeft =
                        leftLine != null &&
                        composerAnchor?.line === leftLineNum &&
                        composerAnchor.side === 'LEFT'
                      const showComposerRight =
                        rightLine != null &&
                        composerAnchor?.line === rightLineNum &&
                        composerAnchor.side === 'RIGHT'
                      const leftAnnotated = leftLine != null && hasAnnotations(leftLineNum, 'LEFT')
                      const rightAnnotated =
                        rightLine != null && hasAnnotations(rightLineNum, 'RIGHT')
                      const hasComments =
                        leftThreads.length > 0 ||
                        rightThreads.length > 0 ||
                        showComposerLeft ||
                        showComposerRight ||
                        leftAnnotated ||
                        rightAnnotated

                      return (
                        <React.Fragment key={`${hi}-row-${ri}`}>
                          {mbLeft && leftIsStart && (
                            <MovedRow
                              symbol={mbLeft.symbol}
                              lineCount={mbLeft.lineCount}
                              otherPath={mbLeft.toPath}
                              otherLine={mbLeft.toLine}
                              direction="away"
                              expanded={leftExpanded}
                              onToggleShow={() =>
                                setExpandedMoved((prev) => {
                                  const next = new Set(prev)
                                  if (next.has(leftKey!)) next.delete(leftKey!)
                                  else next.add(leftKey!)
                                  return next
                                })
                              }
                              onGoToOrigin={() => goToPath(mbLeft.toPath)}
                            />
                          )}
                          {mbRight && rightIsStart && (
                            <MovedRow
                              symbol={mbRight.symbol}
                              lineCount={mbRight.lineCount}
                              otherPath={mbRight.fromPath}
                              otherLine={mbRight.fromLine}
                              direction="here"
                              expanded={rightExpanded}
                              onToggleShow={() =>
                                setExpandedMoved((prev) => {
                                  const next = new Set(prev)
                                  if (next.has(rightKey!)) next.delete(rightKey!)
                                  else next.add(rightKey!)
                                  return next
                                })
                              }
                              onGoToOrigin={() => goToPath(mbRight.fromPath)}
                            />
                          )}
                          {/* One flex row per line pair — identical structure to diff-split-tables */}
                          <div className="diff-split-tables">
                            <table
                              className="diff-table diff-table--split diff-table--left"
                              style={{ width: `${splitLeftPct}%` }}
                            >
                              <tbody>
                                {leftLine ? (
                                  <tr
                                    className={`diff-line diff-line--${leftLine.type}${isLineSelected(leftLineNum, 'LEFT') ? ' diff-line--selecting rs-line--selected' : ''}${isCommented(leftLineNum, 'LEFT') ? ' diff-line--commented' : ''}`}
                                    data-old-line={leftLine.oldLineNumber ?? undefined}
                                    onMouseEnter={() => handleRowMouseEnter(leftLineNum, 'LEFT')}
                                  >
                                    <td
                                      className="diff-line__old-num diff-line__num-gutter"
                                      style={{ width: numColWidth, minWidth: numColWidth }}
                                    >
                                      {leftLine.oldLineNumber ?? ''}
                                      <button
                                        className="diff-gutter-btn"
                                        aria-label="Add comment"
                                        onMouseDown={(e) =>
                                          handleGutterMouseDown(e, leftLineNum, 'LEFT')
                                        }
                                      >
                                        +
                                      </button>
                                      {gutterPip(leftLineNum, 'LEFT')}
                                    </td>
                                    <td className="diff-line__prefix">
                                      {leftLine.type === 'remove' ? '-' : ' '}
                                    </td>
                                    <td className="diff-line__content">
                                      <pre
                                        dangerouslySetInnerHTML={{
                                          __html: highlight(leftLine.content, lang),
                                        }}
                                      />
                                    </td>
                                  </tr>
                                ) : (
                                  <tr className="diff-line">
                                    <td colSpan={3} className="diff-line__empty-cell" />
                                  </tr>
                                )}
                              </tbody>
                            </table>
                            <div
                              className="diff-split-resize-handle"
                              onMouseDown={handleSplitDividerMouseDown}
                            />
                            <table
                              className="diff-table diff-table--split diff-table--right"
                              style={{ width: `${splitRightPct}%` }}
                            >
                              <tbody>
                                {rightLine ? (
                                  <tr
                                    className={`diff-line diff-line--${rightLine.type}${isLineSelected(rightLineNum, 'RIGHT') ? ' diff-line--selecting rs-line--selected' : ''}${isCommented(rightLineNum, 'RIGHT') ? ' diff-line--commented' : ''}`}
                                    data-new-line={rightLine.newLineNumber ?? undefined}
                                    onMouseEnter={() => handleRowMouseEnter(rightLineNum, 'RIGHT')}
                                  >
                                    <td
                                      className="diff-line__new-num diff-line__num-gutter"
                                      style={{ width: numColWidth, minWidth: numColWidth }}
                                    >
                                      {rightLine.newLineNumber ?? ''}
                                      <button
                                        className="diff-gutter-btn"
                                        aria-label="Add comment"
                                        onMouseDown={(e) =>
                                          handleGutterMouseDown(e, rightLineNum, 'RIGHT')
                                        }
                                      >
                                        +
                                      </button>
                                    </td>
                                    <td
                                      className="rs-gut"
                                      style={{ width: gutterWidth, minWidth: gutterWidth }}
                                    >
                                      {insightsChipForLine(rightLineNum) && (
                                        <span
                                          className={`rs-gutter-chip rs-gutter-chip--${insightsChipForLine(rightLineNum)!.kind}`}
                                        >
                                          {insightsChipForLine(rightLineNum)!.label}
                                        </span>
                                      )}
                                      {gutterPip(rightLineNum, 'RIGHT')}
                                    </td>
                                    <td className="diff-line__prefix">
                                      {rightLine.type === 'add' ? '+' : ' '}
                                    </td>
                                    <td className="diff-line__content">
                                      <pre
                                        dangerouslySetInnerHTML={{
                                          __html: highlight(rightLine.content, lang),
                                        }}
                                      />
                                    </td>
                                  </tr>
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
                              <div
                                className="diff-table--split"
                                style={{ width: `${splitLeftPct}%` }}
                              >
                                {leftLine != null && (showComposerLeft || leftAnnotated) && (
                                  <div
                                    className="diff-split-comment-inner"
                                    style={{ paddingLeft: numColWidth + 18 }}
                                  >
                                    {renderAnnotationContent(leftLineNum, 'LEFT')}
                                  </div>
                                )}
                              </div>
                              <div
                                className="diff-split-resize-handle"
                                onMouseDown={handleSplitDividerMouseDown}
                              />
                              <div
                                className="diff-table--split"
                                style={{ width: `${splitRightPct}%` }}
                              >
                                {rightLine != null && (showComposerRight || rightAnnotated) && (
                                  <div
                                    className="diff-split-comment-inner"
                                    style={{ paddingLeft: numColWidth + 18 }}
                                  >
                                    {renderAnnotationContent(rightLineNum, 'RIGHT')}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </React.Fragment>
                      )
                    })}
                  </div>
                )}

                {/* Complexity hotspot annotation */}
                {hotspotHunks.has(hi) &&
                  (() => {
                    const hotspot = hotspots.find((h) => h.hunkIndex === hi)!
                    return (
                      <div className="complexity-hotspot-annotation" role="alert">
                        <TriangleAlert aria-hidden="true" /> {hotspot.message}
                      </div>
                    )
                  })()}
              </React.Fragment>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
