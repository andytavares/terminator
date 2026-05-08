import { useCallback } from 'react'
import { usePrReviewStore } from '../stores/pr-review.store'
import { ReviewQueuePRSchema, PrReviewDetailSchema } from '../schemas/pr-review.schema'
import type { PrReviewDetail } from '../schemas/pr-review.schema'

// ─── Queue loading ────────────────────────────────────────────────────────────

export function useLoadPrQueue(repoRoot: string | null) {
  const { setQueue, setQueueLoading, setQueueError, setRateLimitState } = usePrReviewStore()

  return useCallback(async () => {
    if (!repoRoot) return
    setQueueLoading(true)
    setQueueError(null)
    try {
      const result = await window.electronAPI.github.listOpenPrs(repoRoot)
      if ('error' in result) {
        if ((result as { error: string }).error === 'RATE_LIMITED') {
          setRateLimitState({ resetAt: (result as { resetAt?: number }).resetAt ?? Date.now() + 60_000 })
        } else {
          setQueueError((result as { error: string }).error)
        }
        return
      }
      const prs = ((result as { prs: unknown[] }).prs)
        .map(p => ReviewQueuePRSchema.safeParse(p))
        .filter(r => r.success)
        .map(r => r.data!)
      setQueue(prs)
    } catch (e) {
      setQueueError(String(e))
    } finally {
      setQueueLoading(false)
    }
  }, [repoRoot])
}

// ─── PR detail loading ────────────────────────────────────────────────────────

export function useLoadPrDetail(repoRoot: string | null) {
  const { setRateLimitState } = usePrReviewStore()

  return useCallback(async (
    prNumber: number,
    onSuccess: (detail: PrReviewDetail) => Promise<void>,
  ) => {
    if (!repoRoot) return
    try {
      const result = await window.electronAPI.github.prReviewDetail(repoRoot, prNumber)
      if ('error' in result) {
        if ((result as { error: string }).error === 'RATE_LIMITED') {
          setRateLimitState({ resetAt: (result as { resetAt?: number }).resetAt ?? Date.now() + 60_000 })
        }
        return
      }
      const parsed = PrReviewDetailSchema.safeParse((result as { pr: unknown }).pr)
      if (parsed.success) await onSuccess(parsed.data)
    } catch (e) {
      console.error('Failed to load PR detail', e)
    }
  }, [repoRoot])
}

// ─── File metrics loading ─────────────────────────────────────────────────────

export function useFetchFileMetrics(repoRoot: string | null) {
  const { activePr } = usePrReviewStore()

  return useCallback(async () => {
    if (!repoRoot || !activePr) return
    const allFiles = activePr.chapters.flatMap(c => c.files)

    for (const file of allFiles) {
      try {
        const result = await window.electronAPI.github.fileMetrics(repoRoot, file.path)
        if ('error' in result) continue
        // Metrics are stored on the file object via activePr update;
        // full wiring done when RiskBreakdownPanel requests per-file detail
      } catch {
        // non-blocking; individual file failures don't block others
      }
    }
  }, [repoRoot, activePr])
}

// ─── Inline comments loading ──────────────────────────────────────────────────

export function useLoadInlineComments(repoRoot: string | null) {
  const { activePr, setThreads } = usePrReviewStore()

  return useCallback(async () => {
    if (!repoRoot || !activePr) return
    try {
      const result = await window.electronAPI.github.prInlineComments(repoRoot, activePr.number)
      if ('error' in result) return
      const { buildThreads } = await import('../github/pr-review-service-renderer')
      const comments = (result as { comments: unknown[] }).comments
      const threads = buildThreads(comments as Parameters<typeof buildThreads>[0])
      // Group threads by file path
      const byPath: Record<string, typeof threads> = {}
      for (const thread of threads) {
        if (!byPath[thread.path]) byPath[thread.path] = []
        byPath[thread.path].push(thread)
      }
      for (const [path, pathThreads] of Object.entries(byPath)) {
        setThreads(path, pathThreads)
      }
    } catch (e) {
      console.error('Failed to load inline comments', e)
    }
  }, [repoRoot, activePr])
}
