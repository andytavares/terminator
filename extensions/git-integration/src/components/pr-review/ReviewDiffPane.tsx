import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { HealthChips } from './HealthChips'
import { InlineCommentThread } from './InlineCommentThread'
import { CommentComposer } from './CommentComposer'
import { usePrReviewStore } from '../../stores/pr-review.store'
import {
  detectComplexityHotspots,
  computeFileCyclomaticDelta,
  classifyHunk,
} from '../../github/pr-review-service'
import { detectLanguage, highlight, buildSplitRows } from '../FileDiffView'
import { useLoadInlineComments } from '../../hooks/usePrReview'
import type { PrChangedFile, PrReviewDetail, Chapter } from '../../schemas/pr-review.schema'
import type { FileDiff } from '../../schemas/git.schema'
import { FileDiffSchema } from '../../schemas/git.schema'
import { githubAPI } from '../../api/github'

interface Props {
  repoRoot: string
  pr: PrReviewDetail
  file: PrChangedFile
  chapterProgress: { index: number; total: number }
  onMarkViewed: () => void
  onPrevFile: () => void
  onNextFile: () => void
  onFinishChapter: () => void
  isLastChapter: boolean
  onPause: () => void
  onOpenSubmit: () => void
  onShowRisk: () => void
}

interface ComposerAnchor {
  line: number
  startLine: number | null
  side: 'LEFT' | 'RIGHT'
}

type DiffViewMode = 'unified' | 'split'

export function ReviewDiffPane({
  repoRoot,
  pr,
  file,
  chapterProgress,
  onMarkViewed,
  onPrevFile,
  onNextFile: _onNextFile,
  onFinishChapter,
  isLastChapter,
  onPause,
  onOpenSubmit,
  onShowRisk,
}: Props) {
  const [diff, setDiff] = useState<FileDiff | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [diffError, setDiffError] = useState<string | null>(null)
  const [composerAnchor, setComposerAnchor] = useState<ComposerAnchor | null>(null)
  const [replyTarget, setReplyTarget] = useState<{ threadId: string; inReplyToId: number } | null>(
    null
  )
  const [diffViewMode, setDiffViewMode] = useState<DiffViewMode>('unified')
  const [hideFormattingHunks, setHideFormattingHunks] = useState(true)
  const lineDragRef = useRef<{
    active: boolean
    side: 'LEFT' | 'RIGHT' | null
    startLine: number
    endLine: number
  }>({ active: false, side: null, startLine: 0, endLine: 0 })
  const [selectionRange, setSelectionRange] = useState<{
    side: 'LEFT' | 'RIGHT'
    startLine: number
    endLine: number
  } | null>(null)
  const [splitLeftPct, setSplitLeftPct] = useState(50)
  const splitDragState = useRef({ active: false, startX: 0, startPct: 50, containerWidth: 0 })
  const { viewedFiles, threads, patchFileComplexity } = usePrReviewStore()
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
  const fileThreads = useMemo(() => threads[file.path] ?? [], [threads, file.path])
  const isLastFile = chapterProgress.index === chapterProgress.total - 1

  useEffect(() => {
    setDiff(null)
    setDiffError(null)
    if (file.isBinary) return
    setDiffLoading(true)
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
      .finally(() => setDiffLoading(false))
  }, [file.path, file.isBinary, repoRoot, pr.number, pr.headSHA])

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

  useEffect(() => {
    const onMouseUp = () => {
      const drag = lineDragRef.current
      if (!drag.active || drag.side == null) return
      drag.active = false
      const lo = Math.min(drag.startLine, drag.endLine)
      const hi = Math.max(drag.startLine, drag.endLine)
      setSelectionRange(null)
      setComposerAnchor({
        line: hi,
        startLine: lo !== hi ? lo : null,
        side: drag.side,
      })
    }
    window.addEventListener('mouseup', onMouseUp)
    return () => window.removeEventListener('mouseup', onMouseUp)
  }, [])

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

  const hotspots = diff ? detectComplexityHotspots(diff) : []
  const hotspotHunks = new Set(hotspots.map((h) => h.hunkIndex))

  const dryViolationCount = useMemo(() => {
    if (!pr.dryViolations?.length) return undefined
    return pr.dryViolations.filter((v) => v.files.includes(file.path)).length
  }, [pr.dryViolations, file.path])

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
      setSelectionRange({ side, startLine: lineNum, endLine: lineNum })
    },
    []
  )

  const handleRowMouseEnter = useCallback((lineNum: number, side: 'LEFT' | 'RIGHT') => {
    const drag = lineDragRef.current
    if (!drag.active || drag.side !== side || lineNum === 0) return
    drag.endLine = lineNum
    setSelectionRange({ side, startLine: drag.startLine, endLine: lineNum })
  }, [])

  const isLineSelected = useCallback(
    (lineNum: number, side: 'LEFT' | 'RIGHT') => {
      if (!selectionRange || selectionRange.side !== side || lineNum === 0) return false
      const lo = Math.min(selectionRange.startLine, selectionRange.endLine)
      const hi = Math.max(selectionRange.startLine, selectionRange.endLine)
      return lineNum >= lo && lineNum <= hi
    },
    [selectionRange]
  )

  return (
    <div className="review-diff-pane">
      {/* File header */}
      <div className="review-diff-header">
        <div className="review-diff-header-left">
          <span className={`review-diff-risk-dot review-diff-risk-dot--${file.riskScore.level}`} />
          <span className="review-diff-filename">{file.path}</span>
          {file.changeType !== 'modified' && (
            <span className="review-diff-change-badge">{file.changeType}</span>
          )}
          <span
            className={`review-diff-risk-label review-diff-risk-label--${file.riskScore.level}`}
          >
            {file.riskScore.level === 'high'
              ? 'HIGH RISK'
              : file.riskScore.level === 'medium'
                ? 'MED RISK'
                : 'LOW RISK'}{' '}
            <button className="review-diff-why-btn" onClick={onShowRisk}>
              why?
            </button>
          </span>
        </div>
        <div className="review-diff-header-right">
          <div className="review-diff-view-toggle" role="group" aria-label="Diff view mode">
            <button
              className={`review-diff-view-btn${diffViewMode === 'unified' ? ' review-diff-view-btn--active' : ''}`}
              onClick={() => setDiffViewMode('unified')}
              title="Unified diff view"
            >
              Unified
            </button>
            <button
              className={`review-diff-view-btn${diffViewMode === 'split' ? ' review-diff-view-btn--active' : ''}`}
              onClick={() => setDiffViewMode('split')}
              title="Split diff view"
            >
              Split
            </button>
          </div>
          <button
            className={`review-diff-filter-btn${hideFormattingHunks ? ' review-diff-filter-btn--active' : ''}`}
            onClick={() => setHideFormattingHunks((v) => !v)}
            title="Hide formatting-only hunks (whitespace, import reordering)"
          >
            Semantic
          </button>
          <span className="review-diff-changes">
            +{file.additions}/−{file.deletions}
          </span>
          {isViewed && <span className="review-diff-viewed-badge">✓ Viewed</span>}
        </div>
      </div>

      {/* Health chips */}
      <HealthChips
        riskScore={file.riskScore}
        ciStatus={pr.ciStatus}
        lintStatus={pr.lintStatus}
        coverageStatus={pr.coverageStatus}
        dryViolationCount={dryViolationCount}
      />

      {/* Diff content */}
      <div className="review-diff-scroll" ref={scrollRef}>
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
                        <td colSpan={4} className="diff-hunk-header">
                          {hunk.header}
                        </td>
                      </tr>
                      {hunk.lines.map((line, li) => {
                        const lineNum = line.newLineNumber ?? line.oldLineNumber ?? 0
                        const side: 'LEFT' | 'RIGHT' = line.type === 'remove' ? 'LEFT' : 'RIGHT'
                        const lineThreads = fileThreads.filter(
                          (t) => t.line === lineNum && t.side === side
                        )
                        return (
                          <React.Fragment key={`${hi}-${li}`}>
                            <tr
                              className={`diff-line diff-line--${line.type}${isLineSelected(lineNum, side) ? ' diff-line--selecting' : ''}${isCommented(lineNum, side) ? ' diff-line--commented' : ''}`}
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
                            {composerAnchor?.line === lineNum && composerAnchor.side === side && (
                              <tr>
                                <td colSpan={4}>
                                  <CommentComposer
                                    repoRoot={repoRoot}
                                    prNumber={pr.number}
                                    commitId={pr.headSHA}
                                    path={file.path}
                                    line={composerAnchor.line}
                                    startLine={composerAnchor.startLine ?? undefined}
                                    side={composerAnchor.side}
                                    onSubmitted={() => {
                                      setComposerAnchor(null)
                                      refreshComments()
                                    }}
                                    onCancel={() => setComposerAnchor(null)}
                                  />
                                </td>
                              </tr>
                            )}
                            {lineThreads.map((thread) => (
                              <tr key={thread.id}>
                                <td colSpan={4}>
                                  <InlineCommentThread
                                    thread={thread}
                                    onReply={(tid) =>
                                      setReplyTarget({
                                        threadId: tid,
                                        inReplyToId: thread.comments[0].id,
                                      })
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
                                </td>
                              </tr>
                            ))}
                          </React.Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                ) : (
                  <div className="diff-split-hunk">
                    <div className="diff-split-header">{hunk.header}</div>
                    {buildSplitRows(hunk.lines).map((row, ri) => {
                      const leftLine = row.kind === 'context' ? row.line : row.oldLine
                      const rightLine = row.kind === 'context' ? row.line : row.newLine
                      const leftLineNum = leftLine?.oldLineNumber ?? 0
                      const rightLineNum = rightLine?.newLineNumber ?? 0
                      const leftThreads = leftLine
                        ? fileThreads.filter((t) => t.line === leftLineNum && t.side === 'LEFT')
                        : []
                      const rightThreads = rightLine
                        ? fileThreads.filter((t) => t.line === rightLineNum && t.side === 'RIGHT')
                        : []
                      const showComposerLeft =
                        leftLine != null &&
                        composerAnchor?.line === leftLineNum &&
                        composerAnchor.side === 'LEFT'
                      const showComposerRight =
                        rightLine != null &&
                        composerAnchor?.line === rightLineNum &&
                        composerAnchor.side === 'RIGHT'
                      const hasComments =
                        leftThreads.length > 0 ||
                        rightThreads.length > 0 ||
                        showComposerLeft ||
                        showComposerRight

                      return (
                        <React.Fragment key={`${hi}-row-${ri}`}>
                          {/* One flex row per line pair — identical structure to diff-split-tables */}
                          <div className="diff-split-tables">
                            <table
                              className="diff-table diff-table--split diff-table--left"
                              style={{ width: `${splitLeftPct}%` }}
                            >
                              <tbody>
                                {leftLine ? (
                                  <tr
                                    className={`diff-line diff-line--${leftLine.type}${isLineSelected(leftLineNum, 'LEFT') ? ' diff-line--selecting' : ''}${isCommented(leftLineNum, 'LEFT') ? ' diff-line--commented' : ''}`}
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
                                    className={`diff-line diff-line--${rightLine.type}${isLineSelected(rightLineNum, 'RIGHT') ? ' diff-line--selecting' : ''}${isCommented(rightLineNum, 'RIGHT') ? ' diff-line--commented' : ''}`}
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
                                    <td colSpan={3} className="diff-line__empty-cell" />
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
                                {(showComposerLeft || leftThreads.length > 0) && (
                                  <div
                                    className="diff-split-comment-inner"
                                    style={{ paddingLeft: numColWidth + 18 }}
                                  >
                                    {showComposerLeft && (
                                      <CommentComposer
                                        repoRoot={repoRoot}
                                        prNumber={pr.number}
                                        commitId={pr.headSHA}
                                        path={file.path}
                                        line={composerAnchor!.line}
                                        startLine={composerAnchor!.startLine ?? undefined}
                                        side="LEFT"
                                        onSubmitted={() => {
                                          setComposerAnchor(null)
                                          refreshComments()
                                        }}
                                        onCancel={() => setComposerAnchor(null)}
                                      />
                                    )}
                                    {leftThreads.map((thread) => (
                                      <React.Fragment key={thread.id}>
                                        <InlineCommentThread
                                          thread={thread}
                                          onReply={(tid) =>
                                            setReplyTarget({
                                              threadId: tid,
                                              inReplyToId: thread.comments[0].id,
                                            })
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
                                {(showComposerRight || rightThreads.length > 0) && (
                                  <div
                                    className="diff-split-comment-inner"
                                    style={{ paddingLeft: numColWidth + 18 }}
                                  >
                                    {showComposerRight && (
                                      <CommentComposer
                                        repoRoot={repoRoot}
                                        prNumber={pr.number}
                                        commitId={pr.headSHA}
                                        path={file.path}
                                        line={composerAnchor!.line}
                                        startLine={composerAnchor!.startLine ?? undefined}
                                        side="RIGHT"
                                        onSubmitted={() => {
                                          setComposerAnchor(null)
                                          refreshComments()
                                        }}
                                        onCancel={() => setComposerAnchor(null)}
                                      />
                                    )}
                                    {rightThreads.map((thread) => (
                                      <React.Fragment key={thread.id}>
                                        <InlineCommentThread
                                          thread={thread}
                                          onReply={(tid) =>
                                            setReplyTarget({
                                              threadId: tid,
                                              inReplyToId: thread.comments[0].id,
                                            })
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
                        ⚠ {hotspot.message}
                      </div>
                    )
                  })()}
              </React.Fragment>
            ))}
          </div>
        ) : null}
      </div>

      {/* Bottom navigation bar */}
      <div className="review-diff-nav-bar">
        <div className="review-diff-nav-left">
          <button className="review-diff-nav-btn" onClick={onPause}>
            Pause review
          </button>
          <button className="review-diff-nav-btn" onClick={onOpenSubmit}>
            Submit review
          </button>
        </div>
        <div className="review-diff-nav-center">
          <span className="review-diff-progress">
            {chapterProgress.index + 1} of {chapterProgress.total} files · [ prev · 1 mark viewed
          </span>
        </div>
        <div className="review-diff-nav-right">
          <button className="review-diff-nav-btn" onClick={onPrevFile} aria-label="Previous file">
            ← Prev
          </button>
          {isLastFile ? (
            <button
              className="review-diff-nav-btn review-diff-nav-btn--primary"
              onClick={onFinishChapter}
            >
              {isLastChapter ? 'Finish review ↵' : 'Finish chapter ↵'}
            </button>
          ) : (
            <button
              className="review-diff-nav-btn review-diff-nav-btn--primary"
              onClick={onMarkViewed}
            >
              Mark viewed → Next 1
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
