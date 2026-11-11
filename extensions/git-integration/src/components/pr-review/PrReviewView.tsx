import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { Button } from '@terminator/extension-ui'
import { useShallow } from 'zustand/react/shallow'
import { usePrReviewStore } from '../../stores/pr-review.store'
import { laterKey, useReviewUiStore } from '../../stores/review-ui.store'
import { ChapterNav } from './ChapterNav'
import { ReviewStream, type FileEntry, type StreamChapter } from './ReviewStream'
import { AgentPanel } from './AgentPanel'
import { SinceBanner } from './SinceBanner'
import { ResumeCard } from './ResumeCard'
import { KeyboardHelp } from './KeyboardHelp'
import { ReviewHeader, type ChapterProgress } from './ReviewHeader'
import { ReviewFooter } from './ReviewFooter'
import { ReviewInspector } from './ReviewInspector'
import { VerdictBar } from './VerdictBar'
import { useLoadInlineComments } from '../../hooks/usePrReview'
import { useAgentRuns } from '../../hooks/useAgentRuns'
import { useReviewKeys } from '../../hooks/useReviewKeys'
import { useResizePanel } from '../../hooks/useResizePanel'
import type { PrReviewDetail, Chapter } from '../../schemas/pr-review.schema'
import type { AgentRun, AgentScope } from '../../schemas/review-agent.schema'
import { orderedFiles as orderedFilesOf, startAtChapter } from './file-rows'
import { visiblePr } from '../../review/visible-pr'
import {
  chapterHunkProgress,
  filesHunkProgress,
  percentRead,
  reviewBand,
  type HunkSets,
  type ReviewBand,
} from '../../review/review-layout'
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

type ReviewStore = ReturnType<typeof usePrReviewStore.getState>
type FileOrder = ReviewStore['fileOrderOverrides']

/** Every displayed file in review order, each tagged with its chapter. */
function reviewSequence(displayPr: PrReviewDetail, overrides: FileOrder): FileEntry[] {
  return displayPr.chapters.flatMap((c) =>
    orderedFilesOf(c, overrides[c.id]).map((f) => ({ chapterId: c.id, path: f.path }))
  )
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
      takeLaterHunk: ui.takeLaterHunk,
      fileHunks: ui.fileHunks,
    }))
  )
}

/** The view's own toggles and panels. */
function useViewState(store: ReviewStore) {
  const [showResume, setShowResume] = useState(() => isStaleReviewSession(store.lastAccessedAt))
  const summaryRef = useRef<HTMLTextAreaElement>(null)
  const streamRef = useRef<HTMLDivElement>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [ownedOnly, setOwnedOnly] = useState(false)
  const [scrollTarget, setScrollTarget] = useState<{ path: string } | null>(null)
  return {
    showResume,
    setShowResume,
    summaryRef,
    streamRef,
    refreshing,
    setRefreshing,
    ownedOnly,
    setOwnedOnly,
    scrollTarget,
    setScrollTarget,
  }
}

/** The reader's place: the chapter open and the active file section, resolved against the PR. */
interface Position {
  sequence: FileEntry[]
  activeChapter: Chapter | null
  activeChapterIndex: number
  activeEntry: FileEntry | null
  shownChapters: Chapter[]
}

function stored(sequence: FileEntry[], store: ReviewStore): FileEntry | undefined {
  return sequence.find((e) => e.path === store.currentFilePath)
}

/** In the chapters band the open chapter decides the files shown; elsewhere the active file
 *  decides the chapter. */
function chapterIdOf(band: ReviewBand, displayPr: PrReviewDetail, store: ReviewStore) {
  const ids = displayPr.chapters.map((c) => c.id)
  if (band === 'chapters' && store.currentChapterId && ids.includes(store.currentChapterId)) {
    return store.currentChapterId
  }
  const sequence = reviewSequence(displayPr, store.fileOrderOverrides)
  return stored(sequence, store)?.chapterId ?? ids[0] ?? null
}

function resolvePosition(band: ReviewBand, displayPr: PrReviewDetail, store: ReviewStore) {
  const sequence = reviewSequence(displayPr, store.fileOrderOverrides)
  const chapterId = chapterIdOf(band, displayPr, store)
  const activeChapterIndex = displayPr.chapters.findIndex((c) => c.id === chapterId)
  const activeChapter = displayPr.chapters[activeChapterIndex] ?? null
  const inChapter = sequence.filter((e) => e.chapterId === chapterId)
  const entry = stored(sequence, store)
  const activeEntry = (entry?.chapterId === chapterId && entry) || inChapter[0] || null
  const shownChapters = band === 'chapters' && activeChapter ? [activeChapter] : displayPr.chapters
  return { sequence, activeChapter, activeChapterIndex, activeEntry, shownChapters }
}

/** Keeps the store's chapter and file on the active section, for the panels that read them. */
function useSyncPosition(store: ReviewStore, position: Position) {
  const chapterId = position.activeChapter?.id ?? null
  const path = position.activeEntry?.path ?? null
  const { currentChapterId, currentFilePath, setCurrentChapter, setCurrentFile } = store
  useEffect(() => {
    if (chapterId !== currentChapterId) setCurrentChapter(chapterId)
    if (path !== currentFilePath) setCurrentFile(path)
  }, [chapterId, path, currentChapterId, currentFilePath, setCurrentChapter, setCurrentFile])
}

/** The PR as displayed, its layout band and the reader's position in it. */
function usePosition(pr: PrReviewDetail, store: ReviewStore, ownedOnly: boolean) {
  const displayPr = useMemo(() => visiblePr(pr, { ownedOnly }), [pr, ownedOnly])
  const band = useMemo(() => reviewBand(pr.chapters.flatMap((c) => c.files)), [pr.chapters])
  const position = resolvePosition(band, displayPr, store)
  useSyncPosition(store, position)
  const displayedPaths = useMemo(
    () => new Set(displayPr.chapters.flatMap((c) => c.files.map((f) => f.path))),
    [displayPr]
  )
  return { displayPr, band, position, displayedPaths }
}

function useReviewState(props: Props) {
  const { repoRoot, pr } = props
  const store = usePrReviewStore()
  const ui = useUiState()
  useAgentRuns(repoRoot, pr)
  const view = useViewState(store)
  const left = useResizePanel(240, { min: 120, max: 500 }, 1)
  const { displayPr, band, position, displayedPaths } = usePosition(pr, store, view.ownedOnly)
  const loadInlineComments = useLoadInlineComments(repoRoot)
  useEffect(() => {
    loadInlineComments()
  }, [pr.number, loadInlineComments])
  return { props, store, ui, view, left, displayPr, band, position, displayedPaths }
}

type ReviewState = ReturnType<typeof useReviewState>

function headOf(r: ReviewState) {
  const { repoRoot, pr } = r.props
  return { repoRoot, prNumber: pr.number, headSHA: pr.headSHA }
}

function hunkSetsOf(r: ReviewState): HunkSets {
  return { viewedHunks: r.store.viewedHunks, fileHunks: r.ui.fileHunks }
}

/** Makes `target` the active file, opening its chapter, and scrolls the stream to it. */
function goToFile(r: ReviewState, target: FileEntry): void {
  r.store.setCurrentChapter(target.chapterId)
  r.store.setCurrentFile(target.path)
  r.view.setScrollTarget({ path: target.path })
}

/** The section the reader scrolled to the top becomes the active one. */
function activate(r: ReviewState, entry: FileEntry): void {
  if (entry.path === r.store.currentFilePath) return
  r.store.setCurrentChapter(entry.chapterId)
  r.store.setCurrentFile(entry.path)
}

function selectChapterIn(r: ReviewState, id: string): void {
  startAtChapter(r.store, r.displayPr.chapters, id)
  const first = r.position.sequence.find((e) => e.chapterId === id)
  if (first) r.view.setScrollTarget({ path: first.path })
}

/** Moves one file along the review order; false when there is no file there. */
function stepFile(r: ReviewState, delta: 1 | -1): boolean {
  const { sequence, activeEntry } = r.position
  const at = sequence.findIndex((e) => e.path === activeEntry?.path)
  const target = sequence[at + delta]
  if (at < 0 || !target) return false
  goToFile(r, target)
  return true
}

/** Past the last hunk of the review, opens the first hunk put off with `l`. */
function revisitLaterHunk(r: ReviewState): void {
  const hunk = r.ui.takeLaterHunk(laterKey(r.props.repoRoot, r.props.pr.number))
  if (!hunk) return
  const entry = r.position.sequence.find((e) => e.path === hunk.path)
  if (entry) goToFile(r, entry)
}

function nextFileOrLaterHunk(r: ReviewState): void {
  if (!stepFile(r, 1)) revisitLaterHunk(r)
}

function focusVerdictBar(r: ReviewState): void {
  r.view.summaryRef.current?.focus()
}

/** Marks every hunk of the open chapter read and its files viewed, then opens the next chapter. */
function finishChapter(r: ReviewState): void {
  const { activeChapter, activeChapterIndex } = r.position
  if (!activeChapter) return
  const paths = activeChapter.files.map((f) => f.path)
  const headersByPath = Object.fromEntries(paths.map((p) => [p, r.ui.fileHunks[p] ?? []]))
  r.store.markHunksViewed(headOf(r), headersByPath)
  r.store.markFilesViewed(
    headOf(r),
    paths.filter((p) => !r.store.viewedFiles.has(p))
  )
  const nextChapter = r.displayPr.chapters[activeChapterIndex + 1]
  if (nextChapter) selectChapterIn(r, nextChapter.id)
}

/** Moving through the stream and the chapters. */
function navHandlers(r: ReviewState) {
  return {
    activate: (entry: FileEntry) => activate(r, entry),
    selectChapter: (id: string) => selectChapterIn(r, id),
    prevFile: () => void stepFile(r, -1),
    nextFile: () => nextFileOrLaterHunk(r),
    finishChapter: () => finishChapter(r),
    focusVerdictBar: () => focusVerdictBar(r),
  }
}

/** Pausing and refreshing. */
function actionHandlers(r: ReviewState) {
  const { store, view, props } = r
  return {
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

function progressOf(r: ReviewState) {
  const { displayPr, store } = r
  return {
    viewedCount: reviewedCount(r),
    totalFiles: totalFilesOf(displayPr),
    chapters: chapterProgressOf(displayPr, store.viewedFiles),
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
      onPause={h.pause}
      onAskAgent={() => ui.openAgentPanel(PR_SCOPE, 'review')}
      onShowOverview={r.props.onShowOverview}
      onPopOut={r.props.onPopOut}
      onRefresh={h.refresh}
      refreshing={view.refreshing}
      onOpenKeyboardHelp={() => ui.setKeyboardHelpOpen(true)}
      onClose={r.props.onClose}
    />
  )
}

/** Shows only the changed files the viewer owns by CODEOWNERS; absent when they own none. */
function OwnedOnlyToggle({ r }: { r: ReviewState }) {
  const { view } = r
  if (r.props.pr.ownedPaths.length === 0) return null
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-pressed={view.ownedOnly}
      onClick={() => view.setOwnedOnly((on) => !on)}
    >
      Only my files
    </Button>
  )
}

function chapterProgressById(r: ReviewState) {
  const sets = hunkSetsOf(r)
  return Object.fromEntries(r.displayPr.chapters.map((c) => [c.id, chapterHunkProgress(c, sets)]))
}

/** The chapter rail of the stream and chapters bands: Only my files, then every chapter. */
function ChapterRail({ r, h }: { r: ReviewState; h: Handlers }) {
  return (
    <aside
      aria-label="Chapters"
      className="pr-review-panel pr-review-panel--left"
      style={{ '--pr-left-width': `${r.left.size}px` } as React.CSSProperties}
    >
      <div className="pr-review-panel-header">
        <span className="pr-review-chapter-name">Chapters</span>
        <OwnedOnlyToggle r={r} />
      </div>
      <ChapterNav
        chapters={r.displayPr.chapters}
        progress={chapterProgressById(r)}
        activeId={r.position.activeChapter?.id ?? null}
        onSelectChapter={h.selectChapter}
      />
    </aside>
  )
}

/** The chapters the stream shows, each with its files in the reader's order and its progress. */
function streamChapters(r: ReviewState): StreamChapter[] {
  const sets = hunkSetsOf(r)
  return r.position.shownChapters.map((chapter) => ({
    chapter,
    files: orderedFilesOf(chapter, r.store.fileOrderOverrides[chapter.id]),
    progress: chapterHunkProgress(chapter, sets),
  }))
}

/** The chapters band's end of chapter: marks it read and opens the next. */
function DoneButton({ r, h }: { r: ReviewState; h: Handlers }) {
  const { activeChapterIndex } = r.position
  const hasNext = activeChapterIndex < r.displayPr.chapters.length - 1
  return (
    <Button variant="primary" icon={hasNext ? ArrowRight : undefined} onClick={h.finishChapter}>
      {hasNext ? 'Done, next chapter' : 'Done'}
    </Button>
  )
}

function Stream({ r, h }: { r: ReviewState; h: Handlers }) {
  if (r.position.sequence.length === 0) {
    return <div className="pr-review-empty-state">No changed files to review.</div>
  }
  return (
    <ReviewStream
      repoRoot={r.props.repoRoot}
      pr={r.props.pr}
      chapters={streamChapters(r)}
      showChapterHeaders={r.band === 'stream'}
      activePath={r.position.activeEntry?.path ?? null}
      scrollTarget={r.view.scrollTarget}
      scrollRef={r.view.streamRef}
      onActivate={h.activate}
      onPrevFile={h.prevFile}
      onNextFile={h.nextFile}
      end={r.band === 'chapters' && <DoneButton r={r} h={h} />}
    />
  )
}

/** S2: where the reviewer left off, over the stream until dismissed. */
function Resume({ r }: { r: ReviewState }) {
  const { store, props } = r
  return (
    <ResumeCard
      pr={props.pr}
      lastAccessedAt={store.lastAccessedAt ?? new Date().toISOString()}
      viewedCount={reviewedCount(r)}
      totalFiles={totalFilesOf(r.displayPr)}
      currentChapterId={r.position.activeChapter?.id ?? null}
      currentFilePath={store.currentFilePath}
      lastLine={null}
      drafts={store.drafts}
      agentRuns={r.ui.agentRuns}
      changedSinceCount={store.changedSince.size}
      onContinue={() => r.view.setShowResume(false)}
      onReviewDrafts={() => focusVerdictBar(r)}
    />
  )
}

/** "40% read" on one page, else "Chapter 2 of 5 · 40% read". */
function positionText(r: ReviewState): string {
  const paths = r.position.sequence.map((e) => e.path)
  const read = `${percentRead(filesHunkProgress(paths, hunkSetsOf(r)))}% read`
  if (r.band === 'page') return read
  const { activeChapterIndex } = r.position
  return `Chapter ${activeChapterIndex + 1} of ${r.displayPr.chapters.length} · ${read}`
}

function CentrePane({ r, h }: { r: ReviewState; h: Handlers }) {
  return (
    <main className="pr-review-panel pr-review-panel--centre">
      {r.band === 'page' && r.props.pr.ownedPaths.length > 0 && (
        <div className="rs-page-toolbar">
          <OwnedOnlyToggle r={r} />
        </div>
      )}
      <Stream r={r} h={h} />
      {r.view.showResume && <Resume r={r} />}
      <ReviewFooter
        position={positionText(r)}
        onOpenShortcuts={() => r.ui.setKeyboardHelpOpen(true)}
      />
      <Verdict r={r} />
    </main>
  )
}

function InspectorPane({ r }: { r: ReviewState }) {
  const { repoRoot, pr } = r.props
  const { ui } = r
  const run = finishedRunFor(ui.agentRuns, pr.number, ui.agentPanelScope)
  return (
    <aside className="ri-drawer">
      <ReviewInspector
        onClose={() => ui.openAgentPanel(null)}
        agentFindingCount={openFindingCount(run)}
        agent={
          <AgentPanel
            repoRoot={repoRoot}
            pr={pr}
            currentFilePath={r.position.activeEntry?.path ?? null}
          />
        }
      />
    </aside>
  )
}

function Panels({ r, h }: { r: ReviewState; h: Handlers }) {
  const hasRail = r.band !== 'page'
  return (
    <div className="pr-review-panels">
      {hasRail && <ChapterRail r={r} h={h} />}
      {hasRail && <div className="pr-resize-handle" onMouseDown={r.left.handleMouseDown} />}
      <CentrePane r={r} h={h} />
      {r.ui.agentPanelScope && <InspectorPane r={r} />}
    </div>
  )
}

function Verdict({ r }: { r: ReviewState }) {
  const { repoRoot, pr, onApproved } = r.props
  const { currentUserLogin } = r.store
  return (
    <VerdictBar
      repoRoot={repoRoot}
      prNumber={pr.number}
      headSHA={pr.headSHA}
      isOwnPr={!!currentUserLogin && currentUserLogin === pr.author}
      onApproved={onApproved}
      summaryRef={r.view.summaryRef}
    />
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
  useReviewKeys({ focusVerdictBar: h.focusVerdictBar })
  const { ui } = r
  return (
    <div className="pr-review-view">
      <Header r={r} h={h} />
      {props.sinceInfo && <Since r={r} info={props.sinceInfo} />}
      <Panels r={r} h={h} />
      {/* S3: keyboard shortcut sheet */}
      {ui.keyboardHelpOpen && <KeyboardHelp onClose={() => ui.setKeyboardHelpOpen(false)} />}
    </div>
  )
}
