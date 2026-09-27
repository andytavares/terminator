import { useEffect } from 'react'
import { reviewAgentAPI } from '../api/review-agent'
import { useReviewUiStore } from '../stores/review-ui.store'
import type { PrReviewDetail } from '../schemas/pr-review.schema'
import type { AgentRun } from '../schemas/review-agent.schema'

/** Loads persisted agent runs for the open PR and keeps them in sync with live events. */
export function useAgentRuns(repoRoot: string, pr: PrReviewDetail): void {
  useEffect(() => {
    let cancelled = false
    const { setAgentRuns, upsertAgentRun } = useReviewUiStore.getState()

    ;(async () => {
      try {
        const result = await reviewAgentAPI.list(repoRoot, pr.number, pr.headSHA)
        if (cancelled) return
        if (result && Array.isArray((result as { runs?: unknown }).runs)) {
          setAgentRuns((result as { runs: AgentRun[] }).runs)
        }
      } catch (e) {
        console.error('Failed to load agent runs', e)
      }
    })()

    const unsubscribe = reviewAgentAPI.onEvent(({ run }) => {
      if (run.repoRoot === repoRoot && run.prNumber === pr.number) {
        upsertAgentRun(run)
      }
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [repoRoot, pr.number, pr.headSHA])
}
