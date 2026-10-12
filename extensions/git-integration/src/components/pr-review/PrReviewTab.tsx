import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { Button } from '@terminator/extension-ui'
import { githubAPI } from '../../api/github'
import { usePrReviewStore, sessionKey, legacySessionKey } from '../../stores/pr-review.store'
import { useReviewUiStore } from '../../stores/review-ui.store'
import { ReviewQueue } from './ReviewQueue'
import { PrReviewView } from './PrReviewView'
import type { SinceInfo } from './PrReviewView'
import { PrOverviewPanel } from './PrOverviewPanel'
import { MergeFlowView } from '../merge-flow/MergeFlowView'
import {
  useLoadPrQueue,
  useLoadPrDetail,
  useFetchFileMetrics,
  useLoadIssueComments,
} from '../../hooks/usePrReview'
import { ReviewSessionSchema } from '../../schemas/pr-review.schema'
import type { ReviewQueuePR, PrReviewDetail } from '../../schemas/pr-review.schema'
import { choose } from '../text'
import './pr-review.css'

type ReviewStore = ReturnType<typeof usePrReviewStore.getState>
type SessionStore = Pick<ReviewStore, 'initSession' | 'reconcileHead'>

interface HeadCompare {
  rewritten: boolean
  commits: number
  files: Array<{ path: string; status?: string }>
}

/** The stored session for the PR: the v2 (per-PR) key first, then the v1 (per-head) one. */
async function readStoredSession(repoRoot: string, detail: PrReviewDetail): Promise<unknown> {
  const result = await githubAPI.sessionGet(sessionKey(repoRoot, detail.number))
  const raw = (result as { session: unknown }).session
  if (raw) return raw
  const legacyKey = legacySessionKey(repoRoot, detail.number, detail.headSHA)
  const legacyResult = await githubAPI.sessionGet(legacyKey)
  return (legacyResult as { session: unknown }).session
}

/** Marks what changed between the session's head and the PR's, and says so for the S1 banner. */
async function reconcileWithHead(
  target: { repoRoot: string; detail: PrReviewDetail; storedHead: string },
  reconcileHead: SessionStore['reconcileHead']
): Promise<SinceInfo> {
  const { repoRoot, detail } = target
  const compare = (await githubAPI.prCompare(
    repoRoot,
    target.storedHead,
    detail.headSHA
  )) as HeadCompare
  const changed = choose<'all' | string[]>(
    compare.rewritten,
    'all',
    compare.files.map((f) => f.path)
  )
  const added = compare.files.filter((f) => f.status === 'added').map((f) => f.path)
  reconcileHead({ repoRoot, prNumber: detail.number, headSHA: detail.headSHA }, changed, added)
  return {
    commitCount: compare.commits,
    changedCount: compare.files.length,
    historyRewritten: compare.rewritten,
  }
}

/**
 * Reads a stored session for a PR, preferring the v2 (per-PR) key and
 * falling back to the v1 (per-head) key so a push doesn't start a blank
 * session. If the session's head is stale, reconciles it against the
 * fetched detail and returns the S1 banner info to show for it.
 */
async function loadAndReconcileSession(
  target: { repoRoot: string; detail: PrReviewDetail },
  store: SessionStore
): Promise<SinceInfo | null> {
  const raw = await readStoredSession(target.repoRoot, target.detail)
  if (!raw) return null
  const parsed = ReviewSessionSchema.safeParse(raw)
  if (!parsed.success) return null
  store.initSession(parsed.data)
  const storedHead = parsed.data.headSHA
  if (storedHead === target.detail.headSHA) return null
  return reconcileWithHead({ ...target, storedHead }, store.reconcileHead)
}

/** Saves a first session for a PR that has none, so it shows as in progress on the next load. */
async function ensureSessionSaved(repoRoot: string, detail: PrReviewDetail): Promise<void> {
  const key = sessionKey(repoRoot, detail.number)
  if ((await githubAPI.sessionGet(key)).session) return
  await githubAPI.sessionSet(key, {
    repoRoot,
    prNumber: detail.number,
    headSHA: detail.headSHA,
    currentChapterId: null,
    currentFilePath: null,
    viewedFiles: [],
    fileOrderOverrides: {},
    scrollPosition: null,
    pausedAt: null,
    lastAccessedAt: new Date().toISOString(),
  })
}

/** The PR a pop-out window was opened for, from its URL. */
function popoutPrFromUrl(): { prNumber: number; showOverview: boolean } | null {
  const urlParams = new URLSearchParams(window.location.search)
  const prNumberParam = urlParams.get('prNumber')
  if (!prNumberParam) return null
  const prNumber = parseInt(prNumberParam, 10)
  if (isNaN(prNumber)) return null
  return { prNumber, showOverview: urlParams.get('showOverview') === 'true' }
}

function popOutParams(repoRoot: string, activePr: PrReviewDetail | null, showOverview: boolean) {
  const params: Record<string, string> = { repoRoot }
  if (activePr) {
    params.prNumber = String(activePr.number)
    params.showOverview = String(showOverview)
  }
  return params
}

interface Props {
  repoRoot: string | null
}

/** Pages fetched automatically after the first, per queue load. */
const MAX_AUTO_PAGES = 10

/** Whether the review is open in its own window: this one, or one the main window heard of. */
function usePoppedOut(isPopoutWindow: boolean, activePr: PrReviewDetail | null): boolean {
  const [isPoppedOut, setIsPoppedOut] = useState(isPopoutWindow)
  useEffect(() => {
    if (!isPopoutWindow) return
    document.title = activePr ? `#${activePr.number} ${activePr.title} — Review` : 'Code Reviews'
  }, [isPopoutWindow, activePr])
  useEffect(() => {
    if (isPopoutWindow) return
    const bridge = window.electronAPI.extensionBridge
    const unsubOpen = bridge.on('window:pr-review-opened', () => setIsPoppedOut(true))
    const unsubClose = bridge.on('window:pr-review-closed', () => setIsPoppedOut(false))
    return () => {
      unsubOpen()
      unsubClose()
    }
  }, [isPopoutWindow])
  return isPoppedOut
}

/**
 * The queue is meant to be worked top to bottom, and "Load more pull
 * requests" made finishing it a manual chore — while the summary above it
 * could only count the rows already held, so it reported the page size as
 * the total. Pages follow on their own now, bounded so a repository with
 * thousands of open PRs cannot turn one screen into hundreds of API calls;
 * past the bound the summary still states the real total from `totalCount`,
 * and search reaches anything the list has not got to.
 */
function useAutoPaging(repoRoot: string | null, loadQueue: ReturnType<typeof useLoadPrQueue>) {
  const { nextPrCursor, hasMorePrs, queueLoading, loadingMorePrs } = usePrReviewStore()
  const autoPagesRef = useRef(0)
  useEffect(() => {
    autoPagesRef.current = 0
  }, [repoRoot])
  useEffect(() => {
    if (!hasMorePrs || !nextPrCursor) return
    if (queueLoading || loadingMorePrs) return
    if (autoPagesRef.current >= MAX_AUTO_PAGES) return
    autoPagesRef.current += 1
    void loadQueue({ cursor: nextPrCursor, append: true })
  }, [hasMorePrs, nextPrCursor, queueLoading, loadingMorePrs, loadQueue])
}

function useQueue(repoRoot: string | null) {
  const loadQueue = useLoadPrQueue(repoRoot)
  useEffect(() => {
    if (repoRoot) loadQueue()
  }, [repoRoot, loadQueue])
  useAutoPaging(repoRoot, loadQueue)
  const handleRefreshQueue = useCallback(
    async (options?: { search?: string }) => {
      await loadQueue({ search: options?.search })
    },
    [loadQueue]
  )
  return { loadQueue, handleRefreshQueue }
}

/** The view state of the tab: the open PR's overview flag, its queue row, banner info and merge flow. */
function useTabView() {
  const [showOverview, setShowOverview] = useState(false)
  const [activeQueuePr, setActiveQueuePr] = useState<ReviewQueuePR | null>(null)
  const [mergeFlowWorktree, setMergeFlowWorktree] = useState<string | null>(null)
  const [sinceInfo, setSinceInfo] = useState<SinceInfo | null>(null)
  return {
    showOverview,
    setShowOverview,
    activeQueuePr,
    setActiveQueuePr,
    mergeFlowWorktree,
    setMergeFlowWorktree,
    sinceInfo,
    setSinceInfo,
  }
}

type TabView = ReturnType<typeof useTabView>

/** The data loaders the tab uses for an opened PR. */
function usePrLoaders(repoRoot: string | null) {
  return {
    loadPrDetail: useLoadPrDetail(repoRoot),
    fetchFileMetrics: useFetchFileMetrics(repoRoot),
    loadIssueComments: useLoadIssueComments(repoRoot),
  }
}

type PrLoaders = ReturnType<typeof usePrLoaders>

interface TabContext {
  repoRoot: string
  store: ReviewStore
  view: TabView
  loaders: PrLoaders
}

/** Shows an opened PR: its session first, then the overview, with metrics and comments loading behind. */
async function showOpenedPr(ctx: TabContext, pr: ReviewQueuePR, detail: PrReviewDetail) {
  const { repoRoot, store, view, loaders } = ctx
  const since = await loadAndReconcileSession({ repoRoot, detail }, store)
  view.setSinceInfo(since)
  if (!since) await ensureSessionSaved(repoRoot, detail)
  // Persist the PR snapshot so it always appears in the in-progress section,
  // even if it falls beyond the first page on next load.
  void githubAPI.saveActiveReview(repoRoot, pr)
  // Immediately reflect in-progress in the queue without waiting for a refresh.
  store.markPrInProgress(pr.number)
  useReviewUiStore.getState().resetForPr()
  store.setActivePr(detail)
  view.setShowOverview(true)
  // Kick off risk score computation in the background (non-blocking).
  loaders.fetchFileMetrics(detail)
  // Load conversation comments in the background (pass prNumber directly to avoid stale closure).
  void loaders.loadIssueComments(detail.number)
}

/**
 * Leaves the PR. The store writes the whole session (notes, drafts, viewed marks included)
 * before reset(), so mergeSessionStatuses on the next queue load finds it as paused.
 */
function closePr(ctx: TabContext, loadQueue: ReturnType<typeof useLoadPrQueue>): void {
  const { repoRoot, store, view } = ctx
  const { activePr } = store
  if (activePr) {
    const head = { repoRoot, prNumber: activePr.number, headSHA: activePr.headSHA }
    store.setPaused(head, new Date().toISOString())
  }
  view.setShowOverview(false)
  view.setActiveQueuePr(null)
  store.setActivePr(null)
  view.setSinceInfo(null)
  store.reset()
  useReviewUiStore.getState().resetForPr()
  void loadQueue({ search: undefined })
}

/** A pop-out window opened with a PR number in its URL opens that PR. */
function usePopoutAutoOpen(ctx: TabContext | null, isPopoutWindow: boolean) {
  useEffect(() => {
    if (!isPopoutWindow || !ctx) return
    const target = popoutPrFromUrl()
    if (!target) return
    const { repoRoot, store, view, loaders } = ctx
    loaders.loadPrDetail(target.prNumber, async (detail) => {
      view.setSinceInfo(await loadAndReconcileSession({ repoRoot, detail }, store))
      useReviewUiStore.getState().resetForPr()
      store.setActivePr(detail)
      view.setShowOverview(target.showOverview)
      loaders.fetchFileMetrics(detail)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

function usePrReviewTab(repoRoot: string | null) {
  const store = usePrReviewStore()
  const isPopoutWindow = new URLSearchParams(window.location.search).get('view') === 'pr-review'
  const isPoppedOut = usePoppedOut(isPopoutWindow, store.activePr)
  const view = useTabView()
  const { loadQueue, handleRefreshQueue } = useQueue(repoRoot)
  const loaders = usePrLoaders(repoRoot)
  const ctx: TabContext | null = repoRoot ? { repoRoot, store, view, loaders } : null
  usePopoutAutoOpen(ctx, isPopoutWindow)
  const { dismissPr } = store
  const handleDismissPr = useCallback(
    async (prNumber: number) => {
      if (!repoRoot) return
      dismissPr(prNumber)
      await githubAPI.removeActiveReview(repoRoot, prNumber)
    },
    [repoRoot, dismissPr]
  )
  return {
    store,
    isPopoutWindow,
    isPoppedOut,
    view,
    loadQueue,
    handleRefreshQueue,
    loaders,
    ctx,
    handleDismissPr,
  }
}

type PrReviewTabState = ReturnType<typeof usePrReviewTab>

/** The tab's handlers for an open project. */
function tabHandlers(t: PrReviewTabState, ctx: TabContext) {
  const { store, view, loaders } = t
  const handleClosePr = () => closePr(ctx, t.loadQueue)
  return {
    handleOpenPr: async (pr: ReviewQueuePR) => {
      view.setActiveQueuePr(pr)
      await loaders.loadPrDetail(pr.number, (detail) => showOpenedPr(ctx, pr, detail))
    },
    handleClosePr,
    handleApproved: () => {
      void window.electronAPI.extensionBridge.invoke('window:review-submitted', {})
      // The pop-out sits over the main window's review list, so closing it is the way back.
      if (t.isPopoutWindow) return window.close()
      handleClosePr()
    },
    handleRefreshPr: async () => {
      if (!store.activePr) return
      await loaders.loadPrDetail(store.activePr.number, async (detail) => {
        store.setActivePr(detail)
        loaders.fetchFileMetrics(detail)
      })
    },
    handlePopOut: () => {
      const params = popOutParams(ctx.repoRoot, store.activePr, view.showOverview)
      void window.electronAPI.extensionBridge.invoke('window:open-pr-review', params)
    },
  }
}

type TabHandlers = ReturnType<typeof tabHandlers>

function popOutHandler(t: PrReviewTabState, h: TabHandlers) {
  if (t.isPoppedOut) return undefined
  return h.handlePopOut
}

interface OpenPrProps {
  t: PrReviewTabState
  h: TabHandlers
  repoRoot: string
  pr: PrReviewDetail
}

function OverviewScreen({ t, h, repoRoot, pr }: OpenPrProps) {
  const { view } = t
  return (
    <PrOverviewPanel
      repoRoot={repoRoot}
      pr={pr}
      sessionStatus={view.activeQueuePr?.sessionStatus ?? 'not-started'}
      onStartReview={() => view.setShowOverview(false)}
      onClose={h.handleClosePr}
      onRefresh={h.handleRefreshPr}
      onPopOut={popOutHandler(t, h)}
      onStartMergeFlow={(worktreePath) => view.setMergeFlowWorktree(worktreePath)}
    />
  )
}

function OpenPr(props: OpenPrProps) {
  const { t, h, repoRoot, pr } = props
  const { view } = t
  if (view.showOverview) return <OverviewScreen {...props} />
  return (
    <PrReviewView
      key={pr.number}
      repoRoot={repoRoot}
      pr={pr}
      onClose={h.handleClosePr}
      onRefresh={h.handleRefreshPr}
      onShowOverview={() => view.setShowOverview(true)}
      onPopOut={popOutHandler(t, h)}
      onApproved={h.handleApproved}
      sinceInfo={view.sinceInfo}
    />
  )
}

function QueueScreen(props: { t: PrReviewTabState; h: TabHandlers; repoRoot: string }) {
  const { t, h } = props
  return (
    <div className="pr-review-tab-wrap">
      {!t.isPoppedOut && (
        <div className="pr-review-tab-toolbar">
          <Button
            variant="ghost"
            size="sm"
            icon={ExternalLink}
            onClick={h.handlePopOut}
            title="Open in new window"
          >
            Pop out
          </Button>
        </div>
      )}
      <ReviewQueue
        repoRoot={props.repoRoot}
        onOpenPr={h.handleOpenPr}
        onRefresh={t.handleRefreshQueue}
        onDismissPr={t.handleDismissPr}
      />
    </div>
  )
}

function ProjectTab({ t, ctx }: { t: PrReviewTabState; ctx: TabContext }) {
  const h = tabHandlers(t, ctx)
  const { mergeFlowWorktree, setMergeFlowWorktree } = t.view
  const { activePr } = t.store
  if (mergeFlowWorktree) {
    return <MergeFlowView repoRoot={mergeFlowWorktree} onExit={() => setMergeFlowWorktree(null)} />
  }
  if (activePr) return <OpenPr t={t} h={h} repoRoot={ctx.repoRoot} pr={activePr} />
  return <QueueScreen t={t} h={h} repoRoot={ctx.repoRoot} />
}

export function PrReviewTab({ repoRoot }: Props) {
  const t = usePrReviewTab(repoRoot)
  if (!t.ctx) {
    return (
      <div className="pr-review-empty">
        <p>Open a project to view pull requests.</p>
      </div>
    )
  }
  return <ProjectTab t={t} ctx={t.ctx} />
}
