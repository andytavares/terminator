import React, { useEffect, useState } from 'react'
import { usePrReviewStore } from '../../stores/pr-review.store'
import { ChapterNav } from './ChapterNav'
import { ChapterFileList } from './ChapterFileList'
import { ReviewDiffPane } from './ReviewDiffPane'
import { RiskBreakdownPanel } from './RiskBreakdownPanel'
import { ReviewSubmitPanel } from './ReviewSubmitPanel'
import { useLoadInlineComments } from '../../hooks/usePrReview'
import type { PrReviewDetail, PrChangedFile } from '../../../../../src/shared/schemas/pr-review.schema'

interface Props {
  repoRoot: string
  pr: PrReviewDetail
  onClose: () => void
}

export function PrReviewView({ repoRoot, pr, onClose }: Props) {
  const {
    currentChapterId, currentFilePath,
    setCurrentChapter, setCurrentFile,
    viewedFiles, fileOrderOverrides,
    markFileViewed, setPaused,
  } = usePrReviewStore()

  const loadInlineComments = useLoadInlineComments(repoRoot)
  const [showSubmit, setShowSubmit]       = useState(false)
  const [showRiskFor, setShowRiskFor]     = useState<string | null>(null)

  // Resolve active chapter and file
  const activeChapterId = currentChapterId ?? pr.chapters[0]?.id ?? null
  const activeChapter   = pr.chapters.find(c => c.id === activeChapterId) ?? pr.chapters[0] ?? null

  const orderedFiles: PrChangedFile[] = activeChapter
    ? (() => {
        const overrideOrder = fileOrderOverrides[activeChapter.id]
        if (overrideOrder) {
          return overrideOrder
            .map(p => activeChapter.files.find(f => f.path === p))
            .filter((f): f is PrChangedFile => !!f)
        }
        return activeChapter.files
      })()
    : []

  const currentFileIndex = currentFilePath
    ? orderedFiles.findIndex(f => f.path === currentFilePath)
    : 0
  const resolvedIndex   = Math.max(0, currentFileIndex)
  const activeFile      = orderedFiles[resolvedIndex] ?? null

  // Set initial file if nothing selected yet
  useEffect(() => {
    if (!currentFilePath && orderedFiles.length > 0) {
      setCurrentFile(orderedFiles[0].path)
    }
  }, [activeChapterId])

  useEffect(() => {
    loadInlineComments()
  }, [pr.number])

  const handleSelectChapter = (id: string) => {
    setCurrentChapter(id)
    const chapter = pr.chapters.find(c => c.id === id)
    if (chapter) {
      const overrideOrder = fileOrderOverrides[chapter.id]
      const files = overrideOrder
        ? overrideOrder.map(p => chapter.files.find(f => f.path === p)).filter((f): f is PrChangedFile => !!f)
        : chapter.files
      setCurrentFile(files[0]?.path ?? null)
    }
  }

  const handleSelectFile = (path: string) => {
    setCurrentFile(path)
    setShowRiskFor(null)
  }

  const handleMarkViewed = () => {
    if (!activeFile) return
    markFileViewed(repoRoot, pr.number, pr.headSHA, activeFile.path)
    const nextIndex = resolvedIndex + 1
    if (nextIndex < orderedFiles.length) {
      setCurrentFile(orderedFiles[nextIndex].path)
    }
  }

  const handlePrevFile = () => {
    const prevIndex = resolvedIndex - 1
    if (prevIndex >= 0) setCurrentFile(orderedFiles[prevIndex].path)
  }

  const handleNextFile = () => {
    const nextIndex = resolvedIndex + 1
    if (nextIndex < orderedFiles.length) setCurrentFile(orderedFiles[nextIndex].path)
  }

  const handleFinishChapter = () => {
    if (!activeChapter) return
    // Mark remaining files as viewed
    orderedFiles.forEach(f => {
      if (!viewedFiles.has(f.path)) {
        markFileViewed(repoRoot, pr.number, pr.headSHA, f.path)
      }
    })
    // Move to next chapter if available
    const chapterIndex = pr.chapters.findIndex(c => c.id === activeChapterId)
    const nextChapter  = pr.chapters[chapterIndex + 1]
    if (nextChapter) {
      handleSelectChapter(nextChapter.id)
    }
  }

  const handlePause = () => {
    setPaused(repoRoot, pr.number, pr.headSHA, new Date().toISOString())
    onClose()
  }

  const showMultipleChapters = pr.chapters.length > 1

  return (
    <div className="pr-review-view">
      {/* Chapter tabs (hidden for single-chapter PRs) */}
      {showMultipleChapters && activeChapterId && (
        <ChapterNav
          chapters={pr.chapters}
          activeChapterId={activeChapterId}
          onSelectChapter={handleSelectChapter}
        />
      )}

      <div className="pr-review-panels">
        {/* Left panel: file list */}
        {activeChapter && (
          <aside className="pr-review-panel pr-review-panel--left">
            <div className="pr-review-panel-header">
              <span className="pr-review-chapter-name">{activeChapter.name}</span>
              <span className="pr-review-chapter-count">
                {orderedFiles.filter(f => viewedFiles.has(f.path)).length} / {orderedFiles.length}
              </span>
            </div>
            <ChapterFileList
              repoRoot={repoRoot}
              prNumber={pr.number}
              headSHA={pr.headSHA}
              chapter={activeChapter}
              currentFilePath={activeFile?.path ?? null}
              onSelectFile={handleSelectFile}
            />
          </aside>
        )}

        {/* Centre panel: diff */}
        <main className="pr-review-panel pr-review-panel--centre">
          {activeFile && activeChapter ? (
            <ReviewDiffPane
              repoRoot={repoRoot}
              pr={pr}
              file={activeFile}
              chapterProgress={{ index: resolvedIndex, total: orderedFiles.length }}
              onMarkViewed={handleMarkViewed}
              onPrevFile={handlePrevFile}
              onNextFile={handleNextFile}
              onFinishChapter={handleFinishChapter}
              onPause={handlePause}
              onOpenSubmit={() => setShowSubmit(true)}
              onShowRisk={() => setShowRiskFor(activeFile.path)}
            />
          ) : (
            <div className="pr-review-empty-state">Select a file to review.</div>
          )}
        </main>

        {/* Right panel: risk breakdown (shown on demand) */}
        {showRiskFor && activeFile && activeFile.path === showRiskFor && (
          <aside className="pr-review-panel pr-review-panel--right">
            <button
              className="pr-review-panel-close"
              onClick={() => setShowRiskFor(null)}
              aria-label="Close risk panel"
            >×</button>
            <RiskBreakdownPanel filePath={activeFile.path} riskScore={activeFile.riskScore} />
          </aside>
        )}
      </div>

      {/* Submit review overlay */}
      {showSubmit && (
        <div className="pr-review-submit-overlay" role="dialog" aria-modal="true">
          <ReviewSubmitPanel
            repoRoot={repoRoot}
            prNumber={pr.number}
            commitId={pr.headSHA}
            onClose={() => setShowSubmit(false)}
          />
        </div>
      )}
    </div>
  )
}
