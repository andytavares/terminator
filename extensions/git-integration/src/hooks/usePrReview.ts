import { useCallback, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { githubAPI, type RawFileMetrics } from '../api/github'
import { usePrReviewStore, type PrReviewStore } from '../stores/pr-review.store'
import { PrReviewDetailSchema } from '../schemas/pr-review.schema'
import type { PrReviewDetail, IssueComment } from '../schemas/pr-review.schema'
import { mergeSessionStatuses, parsePrList } from './queue-sessions'
import { NO_REPOSITORY } from '../review/open-status'

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

const UNREADABLE_DETAIL = 'GitHub sent pull request data this view cannot read'

interface DetailRequest {
  repoRoot: string
  prNumber: number
  setRateLimitState: Store['setRateLimitState']
}

/** "14:30": the local time a rate limit lifts at. */
function clockTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
}

/** The message for a channel error. A rate limit also starts the wait the queue shows. */
function detailErrorMessage(reply: { error: string; resetAt?: number }, request: DetailRequest) {
  if (reply.error !== 'RATE_LIMITED') return reply.error
  const resetAt = reply.resetAt ?? Date.now() + 60_000
  request.setRateLimitState({ resetAt })
  return `GitHub limited requests until ${clockTime(resetAt)}`
}

/** Loads and parses the detail, then hands it to `onSuccess`: null when that ran, else the reason. */
async function openDetail(
  request: DetailRequest,
  onSuccess: (detail: PrReviewDetail) => Promise<void>
): Promise<string | null> {
  const result = await githubAPI.prReviewDetail(request.repoRoot, request.prNumber)
  if ('error' in result) return detailErrorMessage(result, request)
  const parsed = PrReviewDetailSchema.safeParse(result.pr)
  if (!parsed.success) {
    console.error('PR detail schema validation failed', parsed.error.issues)
    return UNREADABLE_DETAIL
  }
  await onSuccess(parsed.data)
  return null
}

/** Loads a pull request's detail. Resolves to null when it opened, else a message for people. */
export function useLoadPrDetail(repoRoot: string | null) {
  const { setRateLimitState } = usePrReviewStore()

  return useCallback(
    async (
      prNumber: number,
      onSuccess: (detail: PrReviewDetail) => Promise<void>
    ): Promise<string | null> => {
      if (!repoRoot) return NO_REPOSITORY
      let message: string | null
      try {
        message = await openDetail({ repoRoot, prNumber, setRateLimitState }, onSuccess)
      } catch (e) {
        message = e instanceof Error && e.message ? e.message : String(e)
      }
      if (message !== null)
        console.error('Could not open pull request', {
          channel: 'github:pr-review-detail',
          repoRoot,
          prNumber,
          message,
        })
      return message
    },
    [repoRoot, setRateLimitState]
  )
}

// ─── File metrics loading ─────────────────────────────────────────────────────

/** Fetches each changed file's 90-day commit count into the open PR. */
async function loadChurn(
  repoRoot: string,
  pr: PrReviewDetail,
  store: Pick<Store, 'updateFileChurn'>
) {
  const paths = pr.chapters.flatMap((c) => c.files.map((f) => f.path))
  if (paths.length === 0) return
  const response = await githubAPI.filesMetrics(repoRoot, paths)
  if ('error' in response) return
  const { metrics } = response as { metrics: Record<string, RawFileMetrics> }
  store.updateFileChurn(Object.fromEntries(paths.map((p) => [p, metrics[p]?.churn90d ?? 0])))
}

export function useFetchFileMetrics(repoRoot: string | null) {
  const { activePr, updateFileChurn } = usePrReviewStore()
  return useCallback(
    async (prDetail?: PrReviewDetail) => {
      const pr = prDetail ?? activePr
      if (!repoRoot || !pr) return
      await loadChurn(repoRoot, pr, { updateFileChurn })
    },
    [repoRoot, activePr, updateFileChurn]
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

export function useLoadInlineComments(repoRoot: string) {
  const { activePr, setThreads } = usePrReviewStore()
  // Depend on the number, not the object: every file open patches activePr.
  const activeNumber = activePr?.number

  return useCallback(async () => {
    const current = usePrReviewStore.getState().activePr
    if (!current) return
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
