import React, { useEffect, useMemo, useState } from 'react'
import { Dialog } from '@terminator/extension-ui'
import { usePrReviewStore } from '../../stores/pr-review.store'
import { useReviewUiStore } from '../../stores/review-ui.store'
import { ChapterNav } from './ChapterNav'
import { ChapterFileList } from './ChapterFileList'
import { FullFileList } from './FullFileList'
import { ReviewDiffPane } from './ReviewDiffPane'
import { ReviewSubmitPanel } from './ReviewSubmitPanel'
import { AgentPanel } from './AgentPanel'
import { SinceBanner } from './SinceBanner'
import { ResumeCard } from './ResumeCard'
import { KeyboardHelp } from './KeyboardHelp'
import { ReviewHeader } from './ReviewHeader'
import { ReviewFooter } from './ReviewFooter'
import { ReviewInspector, type InspectorTab } from './ReviewInspector'
import { useLoadInlineComments } from '../../hooks/usePrReview'
import { useAgentRuns } from '../../hooks/useAgentRuns'
import { useReviewKeys } from '../../hooks/useReviewKeys'
import { QUEUE_RISK_HIGH_LINES } from '../../github/pr-review-service'
import { useResizePanel } from '../../hooks/useResizePanel'
import type { PrReviewDetail, PrChangedFile, Chapter } from '../../schemas/pr-review.schema'
import './review-chrome.css'

/** S1 banner info, computed by PrReviewTab from a prCompare against the stored session's head. */
export interface SinceInfo {
  commitCount: number
  changedCount: number
  historyRewritten: boolean
}

interface Props {
  repoRoot: string
  pr: PrReviewDetail
  onClose: () => void
  onRefresh: () => Promise<void>
  onShowOverview?: () => void
  onPopOut?: () => void
  onApproved?: () => void
  sinceInfo?: SinceInfo | null
}

const RESUME_CARD_STALE_MS = 15 * 60 * 1000

export function PrReviewView({
  repoRoot,
  pr,
  onClose,
  onRefresh,
  onShowOverview,
  onPopOut,
  onApproved,
  sinceInfo,
}: Props) {
  const {
    currentChapterId,
    currentFilePath,
    setCurrentChapter,
    setCurrentFile,
    viewedFiles,
    fileOrderOverrides,
    markFileViewed,
    markFilesViewed,
    setPaused,
    currentUserLogin,
    changedSince,
    lastAccessedAt,
    notes,
    drafts,
  } = usePrReviewStore()

  const keyboardHelpOpen = useReviewUiStore((s) => s.keyboardHelpOpen)
  const setKeyboardHelpOpen = useReviewUiStore((s) => s.setKeyboardHelpOpen)
  const agentRuns = useReviewUiStore((s) => s.agentRuns)
  const agentPanelScope = useReviewUiStore((s) => s.agentPanelScope)
  const openAgentPanel = useReviewUiStore((s) => s.openAgentPanel)
  const fileListHidden = useReviewUiStore((s) => s.fileListHidden)
  const toggleFileList = useReviewUiStore((s) => s.toggleFileList)

  useAgentRuns(repoRoot, pr)

  const [showResume, setShowResume] = useState(
    () => !!lastAccessedAt && Date.now() - new Date(lastAccessedAt).getTime() > RESUME_CARD_STALE_MS
  )
  useEffect(() => {
    setShowResume(
      !!lastAccessedAt && Date.now() - new Date(lastAccessedAt).getTime() > RESUME_CARD_STALE_MS
    )
    // Only re-evaluate when a different PR opens, not on every persist.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pr.number])

  const loadInlineComments = useLoadInlineComments(repoRoot)
  const [showSubmit, setShowSubmit] = useState(false)
  const { size: leftWidth, handleMouseDown: handleLeftDividerMouseDown } = useResizePanel(
    240,
    120,
    500,
    1
  )
  const { size: rightWidth, handleMouseDown: handleRightDividerMouseDown } = useResizePanel(
    280,
    160,
    600,
    -1
  )
  const [showRiskFor, setShowRiskFor] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'guided' | 'full'>('full')
  const [refreshing, setRefreshing] = useState(false)
  const [focusMode, setFocusMode] = useState(false)
  const [largePrDismissed, setLargePrDismissed] = useState(false)
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('agent')

  useEffect(() => {
    if (agentPanelScope) setInspectorTab('agent')
  }, [agentPanelScope])

  // When focus mode is active, filter each chapter to only medium/high risk files.
  // Chapters where every file is low-risk are dropped entirely; if all chapters
  // would be dropped (entire PR is low-risk) fall back to showing everything.
  const displayPr = useMemo<PrReviewDetail>(() => {
    if (!focusMode) return pr
    const filteredChapters = pr.chapters
      .map((c) => ({ ...c, files: c.files.filter((f) => f.riskScore.level !== 'low') }))
      .filter((c) => c.files.length > 0)
    return { ...pr, chapters: filteredChapters.length > 0 ? filteredChapters : pr.chapters }
  }, [pr, focusMode])

  const showMultipleChapters = displayPr.chapters.length > 1

  const totalLoc = pr.chapters
    .flatMap((c) => c.files)
    .reduce((s, f) => s + f.additions + f.deletions, 0)
  const estimatedReviewMinutes = Math.round((totalLoc / 100) * 25)
  const isLargePr = totalLoc >= QUEUE_RISK_HIGH_LINES
  const showLargePrPill = isLargePr && !largePrDismissed

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await onRefresh()
    } finally {
      setRefreshing(false)
    }
  }

  // Resolve active chapter and file from the focus-filtered displayPr
  const activeChapterId = currentChapterId ?? displayPr.chapters[0]?.id ?? null
  const activeChapter =
    displayPr.chapters.find((c) => c.id === activeChapterId) ?? displayPr.chapters[0] ?? null

  const orderedFiles = useMemo<PrChangedFile[]>(() => {
    if (!activeChapter) return []
    const overrideOrder = fileOrderOverrides[activeChapter.id]
    if (overrideOrder) {
      return overrideOrder
        .map((p) => activeChapter.files.find((f) => f.path === p))
        .filter((f): f is PrChangedFile => !!f)
    }
    return activeChapter.files
  }, [activeChapter, fileOrderOverrides])

  const currentFileIndex = currentFilePath
    ? orderedFiles.findIndex((f) => f.path === currentFilePath)
    : 0
  const resolvedIndex = Math.max(0, currentFileIndex)
  const activeFile = orderedFiles[resolvedIndex] ?? null

  useEffect(() => {
    if (!currentFilePath && orderedFiles.length > 0) {
      setCurrentFile(orderedFiles[0].path)
    }
  }, [activeChapterId, currentFilePath, orderedFiles, setCurrentFile])

  useEffect(() => {
    loadInlineComments()
  }, [pr.number, loadInlineComments])

  const orderedFilesOf = (chapter: Chapter): PrChangedFile[] => {
    const overrideOrder = fileOrderOverrides[chapter.id]
    return overrideOrder
      ? overrideOrder
          .map((p) => chapter.files.find((f) => f.path === p))
          .filter((f): f is PrChangedFile => !!f)
      : chapter.files
  }

  const handleSelectChapter = (id: string) => {
    setCurrentChapter(id)
    const chapter = displayPr.chapters.find((c) => c.id === id)
    if (chapter) setCurrentFile(orderedFilesOf(chapter)[0]?.path ?? null)
  }

  const stepChapter = (delta: 1 | -1) => {
    const target = displayPr.chapters[activeChapterIndex + delta]
    if (target) handleSelectChapter(target.id)
  }

  // Every displayed file in review order, each tagged with its chapter.
  const stepFile = (delta: 1 | -1) => {
    const all = displayPr.chapters.flatMap((c) =>
      orderedFilesOf(c).map((f) => ({ chapterId: c.id, path: f.path }))
    )
    const at = all.findIndex((e) => e.chapterId === activeChapterId && e.path === activeFile?.path)
    const target = all[at + delta]
    if (at < 0 || !target) return
    if (target.chapterId !== activeChapterId) setCurrentChapter(target.chapterId)
    setCurrentFile(target.path)
  }

  const handleSelectFile = (path: string) => {
    setCurrentFile(path)
    setShowRiskFor(null)
  }

  // Used by FullFileList: selecting a file also switches active chapter
  const handleSelectFileFromFull = (path: string, chapterId: string) => {
    if (chapterId !== activeChapterId) setCurrentChapter(chapterId)
    setCurrentFile(path)
    setShowRiskFor(null)
  }

  const handleMarkViewed = () => {
    if (!activeFile) return
    markFileViewed(repoRoot, pr.number, pr.headSHA, activeFile.path)
    stepFile(1)
  }

  const handlePrevFile = () => stepFile(-1)

  const handleNextFile = () => stepFile(1)

  const handleNextUnviewedFile = () => {
    const allFiles = displayPr.chapters.flatMap((c) => c.files.map((f) => ({ chapterId: c.id, f })))
    const startAt = allFiles.findIndex((entry) => entry.f.path === currentFilePath)
    const rest = [...allFiles.slice(startAt + 1), ...allFiles.slice(0, Math.max(startAt, 0))]
    const next = rest.find((entry) => !viewedFiles.has(entry.f.path))
    if (next) {
      if (next.chapterId !== activeChapterId) setCurrentChapter(next.chapterId)
      setCurrentFile(next.f.path)
    }
  }

  const handleContinueResume = () => setShowResume(false)

  const handleFinishChapter = () => {
    if (!activeChapter) return
    markFilesViewed(
      repoRoot,
      pr.number,
      pr.headSHA,
      orderedFiles.map((f) => f.path).filter((path) => !viewedFiles.has(path))
    )
    const chapterIndex = displayPr.chapters.findIndex((c) => c.id === activeChapterId)
    const nextChapter = displayPr.chapters[chapterIndex + 1]
    if (nextChapter) {
      handleSelectChapter(nextChapter.id)
    } else {
      setShowSubmit(true)
    }
  }

  const handlePause = () => {
    setPaused(repoRoot, pr.number, pr.headSHA, new Date().toISOString())
    onClose()
  }

  const activeChapterIndex = displayPr.chapters.findIndex((c) => c.id === activeChapter?.id)
  const isLastChapter = activeChapterIndex === displayPr.chapters.length - 1

  const totalFiles = displayPr.chapters.flatMap((c) => c.files).length
  const displayedPaths = useMemo(
    () => new Set(displayPr.chapters.flatMap((c) => c.files.map((f) => f.path))),
    [displayPr]
  )
  const reviewedCount = [...viewedFiles].filter((p) => displayedPaths.has(p)).length
  useReviewKeys({
    nextFile: handleNextFile,
    prevFile: handlePrevFile,
    nextChapter: () => stepChapter(1),
    prevChapter: () => stepChapter(-1),
    nextUnviewedFile: handleNextUnviewedFile,
    markViewed: handleMarkViewed,
    toggleInsights: () => (onShowOverview ? onShowOverview() : undefined),
    openSubmit: () => setShowSubmit(true),
  })

  const viewedInActiveChapter = orderedFiles.filter((f) => viewedFiles.has(f.path)).length

  const leftPanel = fileListHidden ? null : (
    <aside className="pr-review-panel pr-review-panel--left" style={{ width: leftWidth }}>
      <div className="pr-review-panel-header">
        {showMultipleChapters ? (
          <div className="pr-rail-switch" role="group" aria-label="File list mode">
            <button
              type="button"
              aria-pressed={viewMode === 'full'}
              onClick={() => setViewMode('full')}
            >
              Files
            </button>
            <button
              type="button"
              aria-pressed={viewMode === 'guided'}
              onClick={() => setViewMode('guided')}
            >
              Chapters
            </button>
          </div>
        ) : (
          <span className="pr-review-chapter-name">Files</span>
        )}
        {viewMode === 'guided' && activeChapter && (
          <>
            <span className="pr-review-chapter-count">
              Chapter {activeChapterIndex + 1} of {displayPr.chapters.length}
            </span>
            <span className="pr-review-chapter-count">
              {viewedInActiveChapter}/{orderedFiles.length}
            </span>
          </>
        )}
      </div>
      {viewMode === 'guided' && activeChapter ? (
        <>
          <div className="pr-rail-chapters">
            <ChapterNav chapters={displayPr.chapters} onSelectChapter={handleSelectChapter} />
          </div>
          <ChapterFileList
            repoRoot={repoRoot}
            prNumber={pr.number}
            headSHA={pr.headSHA}
            chapter={activeChapter}
            currentFilePath={activeFile?.path ?? null}
            onSelectFile={handleSelectFile}
          />
        </>
      ) : (
        <FullFileList
          pr={displayPr}
          repoRoot={repoRoot}
          headSHA={pr.headSHA}
          currentFilePath={currentFilePath}
          onSelectFile={handleSelectFileFromFull}
          showChapterHeaders={showMultipleChapters}
        />
      )}
    </aside>
  )

  const riskOpenForActiveFile = !!activeFile && showRiskFor === activeFile.path
  const inspectorOpen = !!agentPanelScope || riskOpenForActiveFile
  const currentAgentRun = agentPanelScope
    ? agentRuns.find(
        (r) =>
          r.prNumber === pr.number &&
          r.status === 'done' &&
          JSON.stringify(r.scope) === JSON.stringify(agentPanelScope)
      )
    : undefined
  const agentFindingCount = currentAgentRun
    ? currentAgentRun.findings.filter((f) => !f.dismissed).length
    : 0
  const dryViolationCount =
    activeFile && pr.dryViolations?.length
      ? pr.dryViolations.filter((v) => v.files.includes(activeFile.path)).length
      : undefined

  const handleShowRisk = () => {
    if (!activeFile) return
    setShowRiskFor(activeFile.path)
    setInspectorTab('file')
  }

  const handleCloseInspector = () => {
    openAgentPanel(null)
    setShowRiskFor(null)
  }

  return (
    <div className="pr-review-view">
      <ReviewHeader
        prNumber={pr.number}
        title={pr.title}
        isDraft={!!pr.isDraft}
        checks={pr.statusChecks ?? []}
        viewedCount={reviewedCount}
        totalFiles={totalFiles}
        estimatedMinutes={displayPr.chapters.reduce((n, c) => n + c.estimatedMinutes, 0)}
        largePr={showLargePrPill ? { loc: totalLoc, minutes: estimatedReviewMinutes } : null}
        onDismissLargePr={() => setLargePrDismissed(true)}
        focusMode={focusMode}
        onToggleFocusMode={() => setFocusMode((v) => !v)}
        onAskAgent={() =>
          openAgentPanel(
            { kind: 'pr', path: null, startLine: null, endLine: null, side: null, chapter: null },
            'review'
          )
        }
        onShowOverview={onShowOverview}
        onPopOut={onPopOut}
        onRefresh={handleRefresh}
        refreshing={refreshing}
        onToggleFileList={toggleFileList}
        onOpenKeyboardHelp={() => setKeyboardHelpOpen(true)}
        onClose={onClose}
      />

      {/* S1: commits since the stored session was last opened */}
      {sinceInfo && (
        <SinceBanner
          commitCount={sinceInfo.commitCount}
          changedCount={sinceInfo.changedCount}
          stillViewedCount={viewedFiles.size}
          lastAccessedAt={lastAccessedAt}
          historyRewritten={sinceInfo.historyRewritten}
        />
      )}

      <div className="pr-review-panels">
        {leftPanel}

        {leftPanel && <div className="pr-resize-handle" onMouseDown={handleLeftDividerMouseDown} />}

        <main className="pr-review-panel pr-review-panel--centre">
          {activeFile && activeChapter ? (
            <ReviewDiffPane
              repoRoot={repoRoot}
              pr={pr}
              file={activeFile}
              onMarkViewed={handleMarkViewed}
              onPrevFile={handlePrevFile}
              onNextFile={handleNextFile}
              onShowRisk={handleShowRisk}
            />
          ) : (
            <div className="pr-review-empty-state">Select a file to review.</div>
          )}

          {/* S2: resume card, over the diff area until dismissed */}
          {showResume && (
            <ResumeCard
              pr={pr}
              lastAccessedAt={lastAccessedAt ?? new Date().toISOString()}
              viewedCount={reviewedCount}
              totalFiles={totalFiles}
              currentChapterId={activeChapterId}
              currentFilePath={currentFilePath}
              lastLine={null}
              notes={notes}
              drafts={drafts}
              agentRuns={agentRuns}
              changedSinceCount={changedSince.size}
              onContinue={handleContinueResume}
            />
          )}

          <ReviewFooter
            drafts={drafts}
            isLastFile={resolvedIndex === orderedFiles.length - 1}
            isLastChapter={isLastChapter}
            onPause={handlePause}
            onPrevFile={handlePrevFile}
            onMarkViewed={handleMarkViewed}
            onFinishChapter={handleFinishChapter}
            onOpenSubmit={() => setShowSubmit(true)}
            onOpenShortcuts={() => setKeyboardHelpOpen(true)}
          />
        </main>

        {inspectorOpen && (
          <>
            <div className="pr-resize-handle" onMouseDown={handleRightDividerMouseDown} />
            <aside className="pr-review-panel pr-review-panel--right" style={{ width: rightWidth }}>
              <ReviewInspector
                tab={inspectorTab}
                onTabChange={setInspectorTab}
                onClose={handleCloseInspector}
                agentAvailable={!!agentPanelScope}
                agentFindingCount={agentFindingCount}
                agent={<AgentPanel repoRoot={repoRoot} pr={pr} />}
                file={
                  activeFile
                    ? {
                        path: activeFile.path,
                        riskScore: activeFile.riskScore,
                        repoRoot,
                        ciStatus: pr.ciStatus,
                        lintStatus: pr.lintStatus,
                        coverageStatus: pr.coverageStatus,
                        dryViolationCount,
                      }
                    : null
                }
              />
            </aside>
          </>
        )}
      </div>

      {/* Submit review overlay */}
      {showSubmit && (
        <Dialog title="Submit review" onDismiss={() => setShowSubmit(false)} actions={[]}>
          {/* ReviewSubmitPanel carries its own submit controls, so the dialog
              adds none of its own rather than showing a second set. */}
          <ReviewSubmitPanel
            repoRoot={repoRoot}
            prNumber={pr.number}
            headSHA={pr.headSHA}
            isOwnPr={!!currentUserLogin && currentUserLogin === pr.author}
            onClose={() => setShowSubmit(false)}
            onApproved={onApproved}
          />
        </Dialog>
      )}

      {/* S3: keyboard shortcut sheet */}
      {keyboardHelpOpen && <KeyboardHelp onClose={() => setKeyboardHelpOpen(false)} />}
    </div>
  )
}
