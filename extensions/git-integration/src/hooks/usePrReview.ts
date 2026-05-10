import { useCallback } from 'react'
import { usePrReviewStore } from '../stores/pr-review.store'
import { ReviewQueuePRSchema, PrReviewDetailSchema } from '../schemas/pr-review.schema'
import type { PrReviewDetail, FileMetrics, SignalDots } from '../schemas/pr-review.schema'
import { computeRiskScore } from '../github/pr-review-service'

// ─── Queue loading ────────────────────────────────────────────────────────────

function parsePrList(raw: unknown[]): ReturnType<typeof ReviewQueuePRSchema.safeParse>['data'][] {
  return raw
    .map(p => ReviewQueuePRSchema.safeParse(p))
    .filter(r => r.success)
    .map(r => r.data!)
}

export function useLoadPrQueue(repoRoot: string | null) {
  const {
    setQueue, appendQueue, setQueueLoading, setLoadingMorePrs,
    setQueueError, setRateLimitState, setHasMorePrs, setNextPrCursor,
    includeClosedPrs,
  } = usePrReviewStore()

  return useCallback(async (options?: { cursor?: string; search?: string; append?: boolean; includeClosedPrs?: boolean }) => {
    if (!repoRoot) return
    const isAppend = Boolean(options?.append)
    if (isAppend) {
      setLoadingMorePrs(true)
    } else {
      setQueueLoading(true)
      setQueueError(null)
    }
    try {
      const result = await window.electronAPI.github.listOpenPrs(repoRoot, {
        cursor:           options?.cursor,
        search:           options?.search,
        includeClosedPrs: options?.includeClosedPrs ?? includeClosedPrs,
      })
      if ('error' in result) {
        if ((result as { error: string }).error === 'RATE_LIMITED') {
          setRateLimitState({ resetAt: (result as { resetAt?: number }).resetAt ?? Date.now() + 60_000 })
        } else {
          setQueueError((result as { error: string }).error)
        }
        return
      }
      const res = result as { prs: unknown[]; hasMore: boolean; nextCursor?: string }
      const prs = parsePrList(res.prs)
      if (isAppend) {
        appendQueue(prs)
      } else {
        setQueue(prs)
      }
      setHasMorePrs(res.hasMore)
      setNextPrCursor(res.nextCursor)
    } catch (e) {
      setQueueError(String(e))
    } finally {
      if (isAppend) {
        setLoadingMorePrs(false)
      } else {
        setQueueLoading(false)
      }
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
  const { activePr, updateFileRiskScore, updateQueuePrRisk } = usePrReviewStore()

  return useCallback(async (prDetail?: PrReviewDetail) => {
    const pr = prDetail ?? activePr
    if (!repoRoot || !pr) return
    // Exclude lock files / generated files (tier 3) from risk scoring entirely
    const allFiles = pr.chapters.flatMap(c => c.files).filter(f => f.tier !== 3)

    // Fetch raw metrics for all files in parallel
    const results = await Promise.allSettled(
      allFiles.map(async file => {
        const result = await window.electronAPI.github.fileMetrics(repoRoot, file.path)
        if ('error' in result) return null
        const raw = result as {
          churn90d: number; blastRadius: number; topImporters: string[]
          importerCount: number; testFilePresent: boolean
        }
        const metrics: FileMetrics = {
          path:            file.path,
          additions:       file.additions,
          deletions:       file.deletions,
          churn90d:        raw.churn90d ?? null,
          blastRadius:     raw.blastRadius ?? null,
          testFilePresent: raw.testFilePresent ?? false,
          complexityDelta: null,
          patchCoverage:   raw.patchCoverage ?? null,
          topImporters:    raw.topImporters ?? [],
          importerCount:   raw.importerCount ?? 0,
        }
        return { file, metrics }
      })
    )

    const collected: Array<{ file: typeof allFiles[0]; metrics: FileMetrics }> = []
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value != null) collected.push(r.value)
    }

    if (collected.length === 0) return

    const allMetrics = collected.map(c => c.metrics)

    // Compute risk scores for each file and update the store
    for (const { file, metrics } of collected) {
      const chapter = pr.chapters.find(c => c.files.some(f => f.path === file.path))
      if (!chapter) continue
      const riskScore = computeRiskScore(metrics, allMetrics)
      updateFileRiskScore(chapter.id, file.path, riskScore)
    }

    // Weighted PR-level risk: high files always push to HIGH; medium files block LOW
    const riskLevels = collected.map(c => computeRiskScore(c.metrics, allMetrics).level)
    const highCount  = riskLevels.filter(l => l === 'high').length
    const medCount   = riskLevels.filter(l => l === 'medium').length
    const n          = riskLevels.length
    const prRiskLevel: 'low' | 'medium' | 'high' =
      highCount > 0                               ? 'high'
      : medCount >= 3 || (n > 0 && medCount / n >= 0.3) ? 'high'
      : medCount > 0                              ? 'medium'
      : 'low'

    const anyMissingTest = collected.some(c => !c.metrics.testFilePresent)
    const maxChurn = Math.max(...collected.map(c => c.metrics.churn90d ?? 0))
    const maxBlast = Math.max(...collected.map(c => c.metrics.blastRadius ?? 0))
    const covValues = collected.map(c => c.metrics.patchCoverage).filter((v): v is number => v != null)
    const avgCoverage = covValues.length > 0 ? covValues.reduce((a, b) => a + b, 0) / covValues.length : null

    const ciDot: SignalDots['ci'] =
      pr.ciStatus === 'passing' ? 'pass'
      : pr.ciStatus === 'failing' ? 'fail'
      : pr.ciStatus === 'pending' ? 'warn'
      : 'unknown'

    const signalDots: SignalDots = {
      tests:    anyMissingTest ? 'fail' : 'pass',
      coverage: avgCoverage == null ? 'unknown' : avgCoverage >= 80 ? 'pass' : avgCoverage >= 50 ? 'warn' : 'fail',
      ci:       ciDot,
      lint:     pr.lintStatus ?? 'unknown',
      churn:    maxChurn > 50 ? 'fail' : maxChurn > 20 ? 'warn' : 'pass',
      blast:    maxBlast > 20 ? 'fail' : maxBlast > 10 ? 'warn' : 'pass',
    }

    updateQueuePrRisk(pr.number, prRiskLevel, signalDots)
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
