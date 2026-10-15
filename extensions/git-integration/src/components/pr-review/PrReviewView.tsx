import React, { useEffect, useMemo, useState } from 'react'
import { Dialog, SegmentedControl } from '@terminator/extension-ui'
import { useShallow } from 'zustand/react/shallow'
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
import { ReviewHeader, type ChapterProgress } from './ReviewHeader'
import { ReviewFooter } from './ReviewFooter'
import { ReviewInspector, type InspectorTab } from './ReviewInspector'
import { useLoadInlineComments } from '../../hooks/usePrReview'
import { useAgentRuns } from '../../hooks/useAgentRuns'
import { useReviewKeys } from '../../hooks/useReviewKeys'
import { QUEUE_RISK_HIGH_LINES } from '../../github/pr-review-service'
import { useResizePanel } from '../../hooks/useResizePanel'
import type { PrReviewDetail, PrChangedFile, Chapter } from '../../schemas/pr-review.schema'
import type { AgentRun, AgentScope } from '../../schemas/review-agent.schema'
import { orderedFiles as orderedFilesOf, startAtChapter } from './file-rows'
import { choose } from '../text'
import './review-chrome.css'
import './review-layout.css'

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

const PR_SCOPE: AgentScope = {
  kind: 'pr',
  path: null,
  startLine: null,
  endLine: null,
  side: null,
  chapter: null,
}

const LIST_MODE_OPTIONS = [
  { value: 'full', label: 'Files' },
  { value: 'guided', label: 'Chapters' },
] as const

type ReviewStore = ReturnType<typeof usePrReviewStore.getState>
type FileOrder = ReviewStore['fileOrderOverrides']

/** In focus mode each chapter keeps only its medium and high risk files and an all-low chapter is
 *  dropped; if that would drop every chapter (the whole PR is low risk) all are shown. */
function focusedPr(pr: PrReviewDetail, focusMode: boolean): PrReviewDetail {
  if (!focusMode) return pr
  const filteredChapters = pr.chapters
    .map((c) => ({ ...c, files: c.files.filter((f) => f.riskScore.level !== 'low') }))
    .filter((c) => c.files.length > 0)
  return { ...pr, chapters: choose(filteredChapters.length > 0, filteredChapters, pr.chapters) }
}

/** The PR's changed lines and a reading estimate of 25 minutes per hundred lines. */
function largePrInfo(pr: PrReviewDetail, dismissed: boolean) {
  const loc = pr.chapters.flatMap((c) => c.files).reduce((s, f) => s + f.additions + f.deletions, 0)
  if (dismissed || loc < QUEUE_RISK_HIGH_LINES) return null
  return { loc, minutes: Math.round((loc / 100) * 25) }
}

/** The chapter and file being shown, resolved against the focus-filtered PR. */
interface Position {
  activeChapterId: string | null
  activeChapter: Chapter | null
  activeChapterIndex: number
  orderedFiles: PrChangedFile[]
  resolvedIndex: number
  activeFile: PrChangedFile | null
}

function fileIndex(files: PrChangedFile[], currentFilePath: string | null): number {
  if (!currentFilePath) return 0
  return Math.max(
    0,
    files.findIndex((f) => f.path === currentFilePath)
  )
}

function activeChapterIdOf(
  displayPr: PrReviewDetail,
  currentChapterId: string | null
): string | null {
  return currentChapterId ?? displayPr.chapters[0]?.id ?? null
}

function activeChapterOf(
  displayPr: PrReviewDetail,
  currentChapterId: string | null
): Chapter | null {
  const id = activeChapterIdOf(displayPr, currentChapterId)
  return displayPr.chapters.find((c) => c.id === id) ?? displayPr.chapters[0] ?? null
}

function resolvePosition(
  displayPr: PrReviewDetail,
  store: Pick<ReviewStore, 'currentChapterId' | 'currentFilePath'>,
  orderedFiles: PrChangedFile[]
): Position {
  const activeChapter = activeChapterOf(displayPr, store.currentChapterId)
  const resolvedIndex = fileIndex(orderedFiles, store.currentFilePath)
  return {
    activeChapterId: activeChapterIdOf(displayPr, store.currentChapterId),
    activeChapter,
    activeChapterIndex: displayPr.chapters.findIndex((c) => c.id === activeChapter?.id),
    orderedFiles,
    resolvedIndex,
    activeFile: orderedFiles[resolvedIndex] ?? null,
  }
}

interface FileEntry {
  chapterId: string
  path: string
}

/** Every displayed file in review order, each tagged with its chapter. */
function reviewSequence(displayPr: PrReviewDetail, overrides: FileOrder): FileEntry[] {
  return displayPr.chapters.flatMap((c) =>
    orderedFilesOf(c, overrides[c.id]).map((f) => ({ chapterId: c.id, path: f.path }))
  )
}

/** The first file after the current one, wrapping round, that has not been viewed. */
function nextUnviewed(
  displayPr: PrReviewDetail,
  currentFilePath: string | null,
  viewed: Set<string>
) {
  const allFiles = displayPr.chapters.flatMap((c) =>
    c.files.map((f) => ({ chapterId: c.id, path: f.path }))
  )
  const startAt = allFiles.findIndex((entry) => entry.path === currentFilePath)
  const rest = [...allFiles.slice(startAt + 1), ...allFiles.slice(0, Math.max(startAt, 0))]
  return rest.find((entry) => !viewed.has(entry.path))
}

/** The finished agent run for the panel's scope, if there is one. */
function finishedRunFor(agentRuns: AgentRun[], prNumber: number, scope: AgentScope | null) {
  if (!scope) return undefined
  const key = JSON.stringify(scope)
  return agentRuns.find(
    (r) => r.prNumber === prNumber && r.status === 'done' && JSON.stringify(r.scope) === key
  )
}

function openFindingCount(run: AgentRun | undefined): number {
  if (!run) return 0
  return run.findings.filter((f) => !f.dismissed).length
}

function inspectorFile(repoRoot: string, file: PrChangedFile | null) {
  if (!file) return null
  return {
    path: file.path,
    riskScore: file.riskScore,
    repoRoot,
  }
}

function isStaleReviewSession(lastAccessedAt: string | null | undefined): boolean {
  if (!lastAccessedAt) return false
  return Date.now() - new Date(lastAccessedAt).getTime() > RESUME_CARD_STALE_MS
}

function useUiState() {
  return useReviewUiStore(
    useShallow((ui) => ({
      keyboardHelpOpen: ui.keyboardHelpOpen,
      setKeyboardHelpOpen: ui.setKeyboardHelpOpen,
      agentRuns: ui.agentRuns,
      agentPanelScope: ui.agentPanelScope,
      openAgentPanel: ui.openAgentPanel,
      fileListHidden: ui.fileListHidden,
      toggleFileList: ui.toggleFileList,
    }))
  )
}

/** The view's own toggles and panels. */
function useViewState(store: ReviewStore) {
  const [showResume, setShowResume] = useState(() => isStaleReviewSession(store.lastAccessedAt))
  const [showSubmit, setShowSubmit] = useState(false)
  const [showRiskFor, setShowRiskFor] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'guided' | 'full'>('full')
  const [refreshing, setRefreshing] = useState(false)
  const [focusMode, setFocusMode] = useState(false)
  const [largePrDismissed, setLargePrDismissed] = useState(false)
  return {
    showResume,
    setShowResume,
    showSubmit,
    setShowSubmit,
    showRiskFor,
    setShowRiskFor,
    viewMode,
    setViewMode,
    refreshing,
    setRefreshing,
    focusMode,
    setFocusMode,
    largePrDismissed,
    setLargePrDismissed,
  }
}

/** The inspector's tab, switched to the agent whenever the agent panel gets a new scope. */
function useInspectorTab(agentPanelScope: AgentScope | null) {
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('agent')
  const [shownAgentScope, setShownAgentScope] = useState(agentPanelScope)
  if (shownAgentScope !== agentPanelScope) {
    setShownAgentScope(agentPanelScope)
    if (agentPanelScope) setInspectorTab('agent')
  }
  return { inspectorTab, setInspectorTab }
}

function useLayout() {
  const left = useResizePanel(240, { min: 120, max: 500 }, 1)
  return { left }
}

/** The PR as displayed and the reader's position in it. */
function usePosition(pr: PrReviewDetail, store: ReviewStore, focusMode: boolean) {
  const displayPr = useMemo(() => focusedPr(pr, focusMode), [pr, focusMode])
  const activeChapter = activeChapterOf(displayPr, store.currentChapterId)
  const { fileOrderOverrides } = store
  const orderedFiles = useMemo(() => {
    if (!activeChapter) return []
    return orderedFilesOf(activeChapter, fileOrderOverrides[activeChapter.id])
  }, [activeChapter, fileOrderOverrides])
  const position = resolvePosition(displayPr, store, orderedFiles)
  const { setCurrentFile, currentFilePath } = store
  useEffect(() => {
    if (!currentFilePath && orderedFiles.length > 0) setCurrentFile(orderedFiles[0].path)
  }, [position.activeChapterId, currentFilePath, orderedFiles, setCurrentFile])
  const displayedPaths = useMemo(
    () => new Set(displayPr.chapters.flatMap((c) => c.files.map((f) => f.path))),
    [displayPr]
  )
  return { displayPr, position, displayedPaths }
}

function useReviewState(props: Props) {
  const { repoRoot, pr } = props
  const store = usePrReviewStore()
  const ui = useUiState()
  useAgentRuns(repoRoot, pr)
  const view = useViewState(store)
  const inspector = useInspectorTab(ui.agentPanelScope)
  const layout = useLayout()
  const { displayPr, position, displayedPaths } = usePosition(pr, store, view.focusMode)
  const loadInlineComments = useLoadInlineComments(repoRoot)
  useEffect(() => {
    loadInlineComments()
  }, [pr.number, loadInlineComments])
  return { props, store, ui, view, inspector, layout, displayPr, position, displayedPaths }
}

type ReviewState = ReturnType<typeof useReviewState>

function headOf(r: ReviewState) {
  const { repoRoot, pr } = r.props
  return { repoRoot, prNumber: pr.number, headSHA: pr.headSHA }
}

/** Moves to `target`, switching chapter when it lies in another. */
function goToFile(r: ReviewState, target: FileEntry): void {
  if (target.chapterId !== r.position.activeChapterId) r.store.setCurrentChapter(target.chapterId)
  r.store.setCurrentFile(target.path)
}

function selectChapterIn(r: ReviewState, id: string): void {
  startAtChapter(r.store, r.displayPr.chapters, id)
}

function stepChapter(r: ReviewState, delta: 1 | -1): void {
  const target = r.displayPr.chapters[r.position.activeChapterIndex + delta]
  if (target) selectChapterIn(r, target.id)
}

function stepFile(r: ReviewState, delta: 1 | -1): void {
  const all = reviewSequence(r.displayPr, r.store.fileOrderOverrides)
  const { activeChapterId, activeFile } = r.position
  const at = all.findIndex((e) => e.chapterId === activeChapterId && e.path === activeFile?.path)
  const target = all[at + delta]
  if (at < 0 || !target) return
  goToFile(r, target)
}

function markOpenFileViewed(r: ReviewState): void {
  const { activeFile } = r.position
  if (!activeFile) return
  r.store.markFileViewed(headOf(r), activeFile.path)
  stepFile(r, 1)
}

/** Marks the chapter's unviewed files viewed, then opens the next chapter, or the submit dialog. */
function finishChapter(r: ReviewState): void {
  const { activeChapter, activeChapterId, orderedFiles } = r.position
  if (!activeChapter) return
  const unviewed = orderedFiles.map((f) => f.path).filter((path) => !r.store.viewedFiles.has(path))
  r.store.markFilesViewed(headOf(r), unviewed)
  const chapterIndex = r.displayPr.chapters.findIndex((c) => c.id === activeChapterId)
  const nextChapter = r.displayPr.chapters[chapterIndex + 1]
  if (nextChapter) selectChapterIn(r, nextChapter.id)
  else r.view.setShowSubmit(true)
}

/** Moving through the files and chapters. */
function navHandlers(r: ReviewState) {
  const { store, view } = r
  return {
    selectChapter: (id: string) => selectChapterIn(r, id),
    prevFile: () => stepFile(r, -1),
    nextFile: () => stepFile(r, 1),
    selectFile: (path: string) => {
      store.setCurrentFile(path)
      view.setShowRiskFor(null)
    },
    selectFileFromFull: (path: string, chapterId: string) => {
      goToFile(r, { chapterId, path })
      view.setShowRiskFor(null)
    },
    nextUnviewedFile: () => {
      const next = nextUnviewed(r.displayPr, store.currentFilePath, store.viewedFiles)
      if (next) goToFile(r, next)
    },
  }
}

/** Marking progress, pausing and refreshing. */
function actionHandlers(r: ReviewState) {
  const { store, view, props } = r
  return {
    markViewed: () => markOpenFileViewed(r),
    finishChapter: () => finishChapter(r),
    pause: () => {
      store.setPaused(headOf(r), new Date().toISOString())
      props.onClose()
    },
    refresh: async () => {
      view.setRefreshing(true)
      try {
        await props.onRefresh()
      } finally {
        view.setRefreshing(false)
      }
    },
  }
}

/** The view's handlers, over the review state. */
function reviewHandlers(r: ReviewState) {
  return { ...navHandlers(r), ...actionHandlers(r) }
}

type Handlers = ReturnType<typeof reviewHandlers>

function useKeys(r: ReviewState, h: Handlers): void {
  const { onShowOverview } = r.props
  useReviewKeys({
    nextFile: h.nextFile,
    prevFile: h.prevFile,
    nextChapter: () => stepChapter(r, 1),
    prevChapter: () => stepChapter(r, -1),
    nextUnviewedFile: h.nextUnviewedFile,
    markViewed: h.markViewed,
    toggleInsights: () => onShowOverview?.(),
    openSubmit: () => r.view.setShowSubmit(true),
  })
}

function reviewedCount(r: ReviewState): number {
  return [...r.store.viewedFiles].filter((p) => r.displayedPaths.has(p)).length
}

function totalFilesOf(displayPr: PrReviewDetail): number {
  return displayPr.chapters.flatMap((c) => c.files).length
}

function chapterProgressOf(displayPr: PrReviewDetail, viewed: Set<string>): ChapterProgress[] {
  return displayPr.chapters.map((c) => ({
    id: c.id,
    fileCount: c.files.length,
    viewedCount: c.files.filter((f) => viewed.has(f.path)).length,
  }))
}

/** Reading time still ahead: the estimate of every displayed file not yet viewed. */
function minutesLeftOf(displayPr: PrReviewDetail, viewed: Set<string>): number {
  return displayPr.chapters
    .flatMap((c) => c.files)
    .filter((f) => !viewed.has(f.path))
    .reduce((sum, f) => sum + f.estimatedMinutes, 0)
}

function baseName(path: string | undefined): string | null {
  return path?.split('/').pop() ?? null
}

/** The base names of the files either side of the open one, in review order across chapters. */
function neighbourNames(r: ReviewState) {
  const all = reviewSequence(r.displayPr, r.store.fileOrderOverrides)
  const { activeChapterId, activeFile } = r.position
  const at = all.findIndex((e) => e.chapterId === activeChapterId && e.path === activeFile?.path)
  if (at < 0) return { previousFileName: null, nextFileName: null }
  return {
    previousFileName: baseName(all[at - 1]?.path),
    nextFileName: baseName(all[at + 1]?.path),
  }
}

function progressOf(r: ReviewState) {
  const { displayPr, store } = r
  return {
    viewedCount: reviewedCount(r),
    totalFiles: totalFilesOf(displayPr),
    chapters: chapterProgressOf(displayPr, store.viewedFiles),
    minutesLeft: minutesLeftOf(displayPr, store.viewedFiles),
    draftCount: store.drafts.length,
  }
}

function Header({ r, h }: { r: ReviewState; h: Handlers }) {
  const { pr } = r.props
  const { view, ui } = r
  return (
    <ReviewHeader
      prNumber={pr.number}
      title={pr.title}
      isDraft={!!pr.isDraft}
      checks={pr.statusChecks ?? []}
      {...progressOf(r)}
      onSubmit={() => view.setShowSubmit(true)}
      onPause={h.pause}
      largePr={largePrInfo(pr, view.largePrDismissed)}
      onDismissLargePr={() => view.setLargePrDismissed(true)}
      focusMode={view.focusMode}
      onToggleFocusMode={() => view.setFocusMode((v) => !v)}
      onAskAgent={() => ui.openAgentPanel(PR_SCOPE, 'review')}
      onShowOverview={r.props.onShowOverview}
      onPopOut={r.props.onPopOut}
      onRefresh={h.refresh}
      refreshing={view.refreshing}
      onToggleFileList={ui.toggleFileList}
      onOpenKeyboardHelp={() => ui.setKeyboardHelpOpen(true)}
      onClose={r.props.onClose}
    />
  )
}

function ListHeader({ r }: { r: ReviewState }) {
  const { view, displayPr, position } = r
  const viewedInChapter = position.orderedFiles.filter((f) =>
    r.store.viewedFiles.has(f.path)
  ).length
  return (
    <div className="pr-review-panel-header">
      {displayPr.chapters.length > 1 && (
        <SegmentedControl
          label="File list mode"
          size="sm"
          options={[...LIST_MODE_OPTIONS]}
          value={view.viewMode}
          onChange={view.setViewMode}
        />
      )}
      {displayPr.chapters.length <= 1 && <span className="pr-review-chapter-name">Files</span>}
      {view.viewMode === 'guided' && position.activeChapter && (
        <>
          <span className="pr-review-chapter-count">
            Chapter {position.activeChapterIndex + 1} of {displayPr.chapters.length}
          </span>
          <span className="pr-review-chapter-count">
            {viewedInChapter}/{position.orderedFiles.length}
          </span>
        </>
      )}
    </div>
  )
}

function GuidedList({ r, h, chapter }: { r: ReviewState; h: Handlers; chapter: Chapter }) {
  const { repoRoot, pr } = r.props
  return (
    <>
      <div className="pr-rail-chapters">
        <ChapterNav chapters={r.displayPr.chapters} onSelectChapter={h.selectChapter} />
      </div>
      <ChapterFileList
        repoRoot={repoRoot}
        prNumber={pr.number}
        headSHA={pr.headSHA}
        chapter={chapter}
        currentFilePath={r.position.activeFile?.path ?? null}
        onSelectFile={h.selectFile}
      />
    </>
  )
}

function LeftPanel({ r, h }: { r: ReviewState; h: Handlers }) {
  const { activeChapter } = r.position
  const guided = r.view.viewMode === 'guided' && activeChapter
  return (
    <aside
      className="pr-review-panel pr-review-panel--left"
      style={{ '--pr-left-width': `${r.layout.left.size}px` } as React.CSSProperties}
    >
      <ListHeader r={r} />
      {guided && <GuidedList r={r} h={h} chapter={activeChapter} />}
      {!guided && (
        <FullFileList
          pr={r.displayPr}
          repoRoot={r.props.repoRoot}
          headSHA={r.props.pr.headSHA}
          currentFilePath={r.store.currentFilePath}
          onSelectFile={h.selectFileFromFull}
          showChapterHeaders={r.displayPr.chapters.length > 1}
        />
      )}
    </aside>
  )
}

function DiffArea({ r, h }: { r: ReviewState; h: Handlers }) {
  const { activeFile, activeChapter } = r.position
  if (!activeFile || !activeChapter) {
    return <div className="pr-review-empty-state">Select a file to review.</div>
  }
  const showRisk = () => {
    r.view.setShowRiskFor(activeFile.path)
    r.inspector.setInspectorTab('file')
  }
  return (
    <ReviewDiffPane
      repoRoot={r.props.repoRoot}
      pr={r.props.pr}
      file={activeFile}
      onMarkViewed={h.markViewed}
      onPrevFile={h.prevFile}
      onNextFile={h.nextFile}
      onShowRisk={showRisk}
    />
  )
}

/** S2: where the reviewer left off, over the diff area until dismissed. */
function Resume({ r }: { r: ReviewState }) {
  const { store, props } = r
  return (
    <ResumeCard
      pr={props.pr}
      lastAccessedAt={store.lastAccessedAt ?? new Date().toISOString()}
      viewedCount={reviewedCount(r)}
      totalFiles={totalFilesOf(r.displayPr)}
      currentChapterId={r.position.activeChapterId}
      currentFilePath={store.currentFilePath}
      lastLine={null}
      notes={store.notes}
      drafts={store.drafts}
      agentRuns={r.ui.agentRuns}
      changedSinceCount={store.changedSince.size}
      onContinue={() => r.view.setShowResume(false)}
      onReviewDrafts={() => r.view.setShowSubmit(true)}
    />
  )
}

function CentrePane({ r, h }: { r: ReviewState; h: Handlers }) {
  const { position, view } = r
  return (
    <main className="pr-review-panel pr-review-panel--centre">
      <DiffArea r={r} h={h} />
      {view.showResume && <Resume r={r} />}
      <ReviewFooter
        {...neighbourNames(r)}
        isLastFile={position.resolvedIndex === position.orderedFiles.length - 1}
        isLastChapter={position.activeChapterIndex === r.displayPr.chapters.length - 1}
        onPrevFile={h.prevFile}
        onMarkViewed={h.markViewed}
        onFinishChapter={h.finishChapter}
        onOpenShortcuts={() => r.ui.setKeyboardHelpOpen(true)}
      />
    </main>
  )
}

function InspectorPane({ r }: { r: ReviewState }) {
  const { repoRoot, pr } = r.props
  const { ui } = r
  const run = finishedRunFor(ui.agentRuns, pr.number, ui.agentPanelScope)
  const closeAgentPanel = () => {
    ui.openAgentPanel(null)
    r.view.setShowRiskFor(null)
  }
  return (
    <aside className="ri-drawer">
      <ReviewInspector
        tab={r.inspector.inspectorTab}
        onTabChange={r.inspector.setInspectorTab}
        onClose={closeAgentPanel}
        agentAvailable={!!ui.agentPanelScope}
        agentFindingCount={openFindingCount(run)}
        agent={
          <AgentPanel
            repoRoot={repoRoot}
            pr={pr}
            currentFilePath={r.position.activeFile?.path ?? null}
          />
        }
        file={inspectorFile(repoRoot, r.position.activeFile)}
      />
    </aside>
  )
}

/** The inspector shows while the agent has a scope or the risk breakdown is open for this file. */
function inspectorOpen(r: ReviewState): boolean {
  const { activeFile } = r.position
  const riskOpen = !!activeFile && r.view.showRiskFor === activeFile.path
  return !!r.ui.agentPanelScope || riskOpen
}

function Panels({ r, h }: { r: ReviewState; h: Handlers }) {
  const showList = !r.ui.fileListHidden
  return (
    <div className="pr-review-panels">
      {showList && <LeftPanel r={r} h={h} />}
      {showList && <div className="pr-resize-handle" onMouseDown={r.layout.left.handleMouseDown} />}
      <CentrePane r={r} h={h} />
      {inspectorOpen(r) && <InspectorPane r={r} />}
    </div>
  )
}

/** ReviewSubmitPanel carries its own submit controls, so the dialog adds none of its own. */
function SubmitDialog({ r }: { r: ReviewState }) {
  const { repoRoot, pr, onApproved } = r.props
  const { currentUserLogin } = r.store
  const closeSubmit = () => r.view.setShowSubmit(false)
  return (
    <Dialog title="Submit review" onDismiss={closeSubmit} actions={[]}>
      <ReviewSubmitPanel
        repoRoot={repoRoot}
        prNumber={pr.number}
        headSHA={pr.headSHA}
        isOwnPr={!!currentUserLogin && currentUserLogin === pr.author}
        viewedCount={reviewedCount(r)}
        totalFiles={totalFilesOf(r.displayPr)}
        onClose={closeSubmit}
        onApproved={onApproved}
      />
    </Dialog>
  )
}

/** S1: commits since the stored session was last opened. */
function Since({ r, info }: { r: ReviewState; info: SinceInfo }) {
  return (
    <SinceBanner
      commitCount={info.commitCount}
      changedCount={info.changedCount}
      stillViewedCount={r.store.viewedFiles.size}
      lastAccessedAt={r.store.lastAccessedAt}
      historyRewritten={info.historyRewritten}
    />
  )
}

export function PrReviewView(props: Props) {
  const r = useReviewState(props)
  const h = reviewHandlers(r)
  useKeys(r, h)
  const { ui } = r
  return (
    <div className="pr-review-view">
      <Header r={r} h={h} />
      {props.sinceInfo && <Since r={r} info={props.sinceInfo} />}
      <Panels r={r} h={h} />
      {r.view.showSubmit && <SubmitDialog r={r} />}
      {/* S3: keyboard shortcut sheet */}
      {ui.keyboardHelpOpen && <KeyboardHelp onClose={() => ui.setKeyboardHelpOpen(false)} />}
    </div>
  )
}
