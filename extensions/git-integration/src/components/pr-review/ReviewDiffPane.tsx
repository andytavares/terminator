import React, { useEffect, useState, useRef, useCallback } from 'react'
import { HealthChips } from './HealthChips'
import { InlineCommentThread } from './InlineCommentThread'
import { CommentComposer } from './CommentComposer'
import { usePrReviewStore } from '../../stores/pr-review.store'
import { detectComplexityHotspots, computeFileCyclomaticDelta } from '../../github/pr-review-service'
import type { PrChangedFile, PrReviewDetail } from '../../schemas/pr-review.schema'
import type { FileDiff } from '../../schemas/git.schema'
import { FileDiffSchema } from '../../schemas/git.schema'

interface Props {
  repoRoot: string
  pr: PrReviewDetail
  file: PrChangedFile
  chapterProgress: { index: number; total: number }
  onMarkViewed: () => void
  onPrevFile: () => void
  onNextFile: () => void
  onFinishChapter: () => void
  onPause: () => void
  onOpenSubmit: () => void
  onShowRisk: () => void
}

interface ComposerAnchor {
  line: number
  startLine: number | null
  side: 'LEFT' | 'RIGHT'
}

export function ReviewDiffPane({
  repoRoot, pr, file, chapterProgress,
  onMarkViewed, onPrevFile, onNextFile: _onNextFile, onFinishChapter, onPause, onOpenSubmit, onShowRisk,
}: Props) {
  const [diff, setDiff] = useState<FileDiff | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [diffError, setDiffError] = useState<string | null>(null)
  const [composerAnchor, setComposerAnchor] = useState<ComposerAnchor | null>(null)
  const [replyTarget, setReplyTarget] = useState<{ threadId: string; inReplyToId: number } | null>(null)
  const [selectionStart, setSelectionStart] = useState<number | null>(null)
  const { viewedFiles, threads, patchFileComplexity } = usePrReviewStore()
  const scrollRef = useRef<HTMLDivElement>(null)

  const isViewed = viewedFiles.has(file.path)
  const fileThreads = threads[file.path] ?? []
  const isLastFile = chapterProgress.index === chapterProgress.total - 1

  useEffect(() => {
    setDiff(null)
    setDiffError(null)
    if (file.isBinary) return
    setDiffLoading(true)
    window.electronAPI.github.prFileDiff(repoRoot, pr.number, file.path)
      .then(result => {
        if ('error' in result) {
          setDiffError((result as { error: string }).error)
          return
        }
        const parsed = FileDiffSchema.safeParse((result as { diff: unknown }).diff)
        if (parsed.success) {
          setDiff(parsed.data)
          // Feed complexity delta back to the risk score
          const delta = computeFileCyclomaticDelta(parsed.data)
          const chapter = pr.chapters.find(c => c.files.some(f => f.path === file.path))
          if (chapter) patchFileComplexity(chapter.id, file.path, delta)
        }
      })
      .catch(e => setDiffError(String(e)))
      .finally(() => setDiffLoading(false))
  }, [file.path, repoRoot, pr.number])

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

  const hotspots = diff ? detectComplexityHotspots(diff) : []
  const hotspotHunks = new Set(hotspots.map(h => h.hunkIndex))

  const handleGutterClick = useCallback((lineNum: number, side: 'LEFT' | 'RIGHT') => {
    setComposerAnchor({
      line:      selectionStart != null && selectionStart !== lineNum ? lineNum : lineNum,
      startLine: selectionStart != null && selectionStart !== lineNum ? selectionStart : null,
      side,
    })
    setSelectionStart(null)
  }, [selectionStart])

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
          {file.riskScore.level === 'high' && (
            <span className="review-diff-high-risk">
              HIGH RISK <button className="review-diff-why-btn" onClick={onShowRisk}>why?</button>
            </span>
          )}
        </div>
        <div className="review-diff-header-right">
          <span className="review-diff-changes">+{file.additions}/−{file.deletions}</span>
          {isViewed && <span className="review-diff-viewed-badge">✓ Viewed</span>}
        </div>
      </div>

      {/* Health chips */}
      <HealthChips
        riskScore={file.riskScore}
        ciStatus={pr.ciStatus}
        lintStatus={pr.lintStatus}
        coverageStatus={pr.coverageStatus}
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
          <div
            className="review-diff-table-wrap"
            onMouseDown={e => {
              const row = (e.target as HTMLElement).closest('tr')
              const lineAttr = row?.dataset.newLine ?? row?.dataset.oldLine
              if (lineAttr) setSelectionStart(parseInt(lineAttr, 10))
            }}
          >
            {diff.hunks.map((hunk, hi) => (
              <React.Fragment key={hi}>
                <table className="diff-table diff-table--review">
                  <tbody>
                    <tr>
                      <td colSpan={5} className="diff-hunk-header">{hunk.header}</td>
                    </tr>
                    {hunk.lines.map((line, li) => {
                      const lineNum = line.newLineNumber ?? line.oldLineNumber ?? 0
                      const side: 'LEFT' | 'RIGHT' = line.type === 'remove' ? 'LEFT' : 'RIGHT'
                      const lineThreads = fileThreads.filter(t => t.line === lineNum && t.side === side)
                      return (
                        <React.Fragment key={`${hi}-${li}`}>
                          <tr
                            className={`diff-line diff-line--${line.type}`}
                            data-new-line={line.newLineNumber ?? undefined}
                            data-old-line={line.oldLineNumber ?? undefined}
                          >
                            <td className="diff-line__old-num">{line.oldLineNumber ?? ''}</td>
                            <td className="diff-line__new-num">{line.newLineNumber ?? ''}</td>
                            <td className="diff-line__prefix">{line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}</td>
                            <td className="diff-line__content">
                              <pre>{line.content}</pre>
                            </td>
                            <td className="diff-gutter">
                              <button
                                className="diff-gutter-btn"
                                aria-label="Add comment"
                                onClick={() => handleGutterClick(lineNum, side)}
                              >+</button>
                            </td>
                          </tr>
                          {composerAnchor?.line === lineNum && composerAnchor.side === side && (
                            <tr>
                              <td colSpan={5}>
                                <CommentComposer
                                  repoRoot={repoRoot}
                                  prNumber={pr.number}
                                  commitId={pr.headSHA}
                                  path={file.path}
                                  line={composerAnchor.line}
                                  startLine={composerAnchor.startLine ?? undefined}
                                  side={composerAnchor.side}
                                  onSubmitted={() => setComposerAnchor(null)}
                                  onCancel={() => setComposerAnchor(null)}
                                />
                              </td>
                            </tr>
                          )}
                          {lineThreads.map(thread => (
                            <tr key={thread.id}>
                              <td colSpan={5}>
                                <InlineCommentThread
                                  thread={thread}
                                  onReply={tid => setReplyTarget({ threadId: tid, inReplyToId: thread.comments[0].id })}
                                />
                                {replyTarget?.threadId === thread.id && (
                                  <CommentComposer
                                    repoRoot={repoRoot}
                                    prNumber={pr.number}
                                    inReplyToId={replyTarget.inReplyToId}
                                    onSubmitted={() => setReplyTarget(null)}
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

                {/* Complexity hotspot annotation */}
                {hotspotHunks.has(hi) && (() => {
                  const hotspot = hotspots.find(h => h.hunkIndex === hi)!
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
          <button className="review-diff-nav-btn" onClick={onPause}>Pause review</button>
          <button className="review-diff-nav-btn" onClick={onOpenSubmit}>Submit review</button>
        </div>
        <div className="review-diff-nav-center">
          <span className="review-diff-progress">
            {chapterProgress.index + 1} of {chapterProgress.total} files · [  prev · 1  mark viewed
          </span>
        </div>
        <div className="review-diff-nav-right">
          <button className="review-diff-nav-btn" onClick={onPrevFile} aria-label="Previous file">
            ← Prev
          </button>
          {isLastFile ? (
            <button className="review-diff-nav-btn review-diff-nav-btn--primary" onClick={onFinishChapter}>
              Finish chapter ↵
            </button>
          ) : (
            <button className="review-diff-nav-btn review-diff-nav-btn--primary" onClick={onMarkViewed}>
              Mark viewed → Next 1
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
