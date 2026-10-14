import { useCallback, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { githubAPI, type RawFileMetrics } from '../api/github'
import { usePrReviewStore, type PrReviewStore } from '../stores/pr-review.store'
import { PrReviewDetailSchema } from '../schemas/pr-review.schema'
import type { PrReviewDetail, IssueComment } from '../schemas/pr-review.schema'
import {
  measuredFiles,
  prRiskLevel,
  riskScores,
  scoredFiles,
  signalDots,
} from '../review/pr-signals'
import { mergeSessionStatuses, parsePrList } from './queue-sessions'

// ─── Queue loading ────────────────────────────────────────────────────────────

type Store = PrReviewStore

/** The store actions loading the queue drives. */
type QueueActions = Pick<
  Store,
  | 'setQueue'
  | 'appendQueue'
  | 'setQueueLoading'
  | 'setLoadingMorePrs'
  | 'setQueueError'
  | 'setRateLimitState'
  | 'setHasMorePrs'
  | 'setNextPrCursor'
  | 'setTotalPrCount'
  | 'setCurrentUserLogin'
>

interface QueueRequest {
  repoRoot: string
  cursor?: string
  search?: string
  append: boolean
  /** True once a later request has started: this one's results must be dropped. */
  isStale: () => boolean
}

interface QueuePage {
  prs: unknown[]
  hasMore: boolean
  nextCursor?: string
  totalCount?: number
}

const NOT_AUTHENTICATED =
  'Not authenticated. Add a GitHub token in Settings → Git Integration, or run: gh auth login'

function setLoading(actions: QueueActions, append: boolean, loading: boolean): void {
  if (append) actions.setLoadingMorePrs(loading)
  else actions.setQueueLoading(loading)
}

/** The signed-in login, best-effort and in parallel with the list. */
function loadCurrentUser(actions: QueueActions, request: QueueRequest): void {
  githubAPI
    .currentUser(request.repoRoot)
    .then((res) => {
      if (!request.isStale()) actions.setCurrentUserLogin((res as { login?: string }).login ?? null)
    })
    .catch(() => {
      /* non-critical */
    })
}

/** A failed list: a rate limit waits it out, missing auth says how to sign in. */
function showQueueError(actions: QueueActions, result: { error: string; resetAt?: number }): void {
  if (result.error === 'RATE_LIMITED') {
    actions.setRateLimitState({ resetAt: result.resetAt ?? Date.now() + 60_000 })
  } else if (result.error === 'NOT_AUTHENTICATED') {
    actions.setQueueError(NOT_AUTHENTICATED)
  } else {
    actions.setQueueError(result.error)
  }
}

async function applyQueuePage(actions: QueueActions, request: QueueRequest, page: QueuePage) {
  const prs = await mergeSessionStatuses(request.repoRoot, parsePrList(page.prs), request.append)
  if (request.isStale()) return
  if (request.append) actions.appendQueue(prs)
  else actions.setQueue(prs)
  actions.setHasMorePrs(page.hasMore)
  actions.setNextPrCursor(page.nextCursor)
  actions.setTotalPrCount(page.totalCount ?? null)
}

async function loadQueue(actions: QueueActions, request: QueueRequest): Promise<void> {
  setLoading(actions, request.append, true)
  if (!request.append) {
    actions.setQueueError(null)
    loadCurrentUser(actions, request)
  }
  try {
    const { repoRoot, cursor, search } = request
    const result = await githubAPI.listOpenPrs(repoRoot, { cursor, search })
    if (request.isStale()) return
    if ('error' in result)
      return showQueueError(actions, result as { error: string; resetAt?: number })
    await applyQueuePage(actions, request, result as QueuePage)
  } catch (e) {
    if (!request.isStale()) actions.setQueueError(String(e))
  } finally {
    if (!request.isStale()) setLoading(actions, request.append, false)
  }
}

/** The queue actions, as one object that changes only when an action does. */
function useQueueActions(): QueueActions {
  return usePrReviewStore(
    useShallow((s) => ({
      setQueue: s.setQueue,
      appendQueue: s.appendQueue,
      setQueueLoading: s.setQueueLoading,
      setLoadingMorePrs: s.setLoadingMorePrs,
      setQueueError: s.setQueueError,
      setRateLimitState: s.setRateLimitState,
      setHasMorePrs: s.setHasMorePrs,
      setNextPrCursor: s.setNextPrCursor,
      setTotalPrCount: s.setTotalPrCount,
      setCurrentUserLogin: s.setCurrentUserLogin,
    }))
  )
}

export function useLoadPrQueue(repoRoot: string | null) {
  const actions = useQueueActions()
  // Monotonic request id: a slower earlier request (e.g. a stale search) must not overwrite a
  // later one's results (TAV-7); a response whose id is no longer the latest is dropped.
  const latestRequestIdRef = useRef(0)
  return useCallback(
    async (options?: { cursor?: string; search?: string; append?: boolean }) => {
      if (!repoRoot) return
      const requestId = ++latestRequestIdRef.current
      const isStale = () => requestId !== latestRequestIdRef.current
      await loadQueue(actions, { repoRoot, ...options, append: Boolean(options?.append), isStale })
    },
    [repoRoot, actions]
  )
}

// ─── PR detail loading ────────────────────────────────────────────────────────

export function useLoadPrDetail(repoRoot: string | null) {
  const { setRateLimitState } = usePrReviewStore()

  return useCallback(
    async (prNumber: number, onSuccess: (detail: PrReviewDetail) => Promise<void>) => {
      if (!repoRoot) return
      try {
        const result = await githubAPI.prReviewDetail(repoRoot, prNumber)
        if ('error' in result) {
          if ((result as { error: string }).error === 'RATE_LIMITED') {
            setRateLimitState({
              resetAt: (result as { resetAt?: number }).resetAt ?? Date.now() + 60_000,
            })
          }
          return
        }
        const parsed = PrReviewDetailSchema.safeParse((result as { pr: unknown }).pr)
        if (parsed.success) {
          await onSuccess(parsed.data)
        } else {
          console.error('PR detail schema validation failed', parsed.error.issues)
        }
      } catch (e) {
        console.error('Failed to load PR detail', e)
      }
    },
    [repoRoot, setRateLimitState]
  )
}

// ─── File metrics loading ─────────────────────────────────────────────────────

/** Scores each file from its metrics, then the PR's risk and signal dots in the queue. */
async function scorePr(
  repoRoot: string,
  pr: PrReviewDetail,
  actions: Pick<Store, 'updateFileRiskScores' | 'updateQueuePrRisk'>
) {
  const files = scoredFiles(pr)
  if (files.length === 0) return
  const response = await githubAPI.filesMetrics(
    repoRoot,
    files.map((f) => f.path)
  )
  if ('error' in response) return
  const measured = measuredFiles(
    files,
    (response as { metrics: Record<string, RawFileMetrics> }).metrics
  )
  if (measured.length === 0) return
  const scores = riskScores(measured)
  actions.updateFileRiskScores(scores)
  actions.updateQueuePrRisk(pr.number, prRiskLevel(measured, scores), signalDots(measured, pr))
}

export function useFetchFileMetrics(repoRoot: string | null) {
  const { activePr, updateFileRiskScores, updateQueuePrRisk } = usePrReviewStore()
  return useCallback(
    async (prDetail?: PrReviewDetail) => {
      const pr = prDetail ?? activePr
      if (!repoRoot || !pr) return
      await scorePr(repoRoot, pr, { updateFileRiskScores, updateQueuePrRisk })
    },
    [repoRoot, activePr, updateFileRiskScores, updateQueuePrRisk]
  )
}

// ─── Issue (conversation) comments loading ────────────────────────────────────

export function useLoadIssueComments(repoRoot: string | null) {
  const { activePr, setIssueComments } = usePrReviewStore()
  // Depend on the number, not the object: every file open patches activePr.
  const activeNumber = activePr?.number

  return useCallback(
    async (prNumberOverride?: number) => {
      const prNumber = prNumberOverride ?? activeNumber
      if (!repoRoot || !prNumber) return
      try {
        const result = await githubAPI.prIssueComments(repoRoot, prNumber)
        if ('error' in result) return
        setIssueComments((result as { comments: IssueComment[] }).comments)
      } catch (e) {
        console.error('Failed to load issue comments', e)
      }
    },
    [repoRoot, activeNumber, setIssueComments]
  )
}

// ─── Inline comments loading ──────────────────────────────────────────────────

/** Each path's threads, those GitHub marks resolved flagged as such. */
async function threadsByPath(result: { comments: unknown[]; resolvedCommentIds?: number[] }) {
  const { buildThreads } = await import('../github/pr-review-service-renderer')
  const resolved = new Set(result.resolvedCommentIds ?? [])
  const threads = buildThreads(result.comments as Parameters<typeof buildThreads>[0]).map(
    (thread) => (resolved.has(thread.comments[0]?.id) ? { ...thread, resolved: true } : thread)
  )
  const byPath: Record<string, typeof threads> = {}
  for (const thread of threads) (byPath[thread.path] ??= []).push(thread)
  return byPath
}

export function useLoadInlineComments(repoRoot: string | null) {
  const { activePr, setThreads } = usePrReviewStore()
  // Depend on the number, not the object: every file open patches activePr.
  const activeNumber = activePr?.number

  return useCallback(async () => {
    const current = usePrReviewStore.getState().activePr
    if (!repoRoot || !current) return
    try {
      const result = await githubAPI.prInlineComments(repoRoot, current.number)
      if ('error' in result) return
      const byPath = await threadsByPath(
        result as { comments: unknown[]; resolvedCommentIds?: number[] }
      )
      for (const [path, pathThreads] of Object.entries(byPath)) setThreads(path, pathThreads)
    } catch (e) {
      console.error('Failed to load inline comments', e)
    }
    // activeNumber is a deliberate dependency: consumers re-run the loader when the PR changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoRoot, activeNumber, setThreads])
}
