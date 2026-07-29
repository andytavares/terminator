import { gradeRisk, type ChangeSummary, type GradedChange, type RiskGrade } from './risk-grader.js'
import type { DiffSummary } from './diff-summary.js'

// The review queue. Ordered worst-first rather than by arrival (FR-046),
// because the whole premise is that review capacity is the scarce resource:
// the operator should spend it on what can hurt, not on what arrived first.

export const REVIEW_STEPS = ['intent', 'risk', 'structure', 'tests'] as const
export type ReviewStep = (typeof REVIEW_STEPS)[number]

export interface ReviewItem {
  readonly sessionId: string
  readonly repoPath: string
  readonly branch: string
  readonly grade: RiskGrade
  readonly gradeTrigger: string
  readonly queuedAt: number
  readonly diffSummary: DiffSummary
  readonly step: ReviewStep
}

const GRADE_ORDER: Record<RiskGrade, number> = { P0: 0, P1: 1, P2: 2, P3: 3 }

export interface QueueCandidate {
  sessionId: string
  repoPath: string
  branch: string
  diffSummary: DiffSummary
  change: ChangeSummary
  queuedAt: number
}

export interface ReviewQueue {
  enqueue(candidate: QueueCandidate): ReviewItem | null
  remove(sessionId: string): void
  advance(sessionId: string): ReviewStep | null
  list(): ReviewItem[]
  count(): number
}

export function createReviewQueue(): ReviewQueue {
  const items = new Map<string, ReviewItem>()

  return {
    enqueue(candidate: QueueCandidate): ReviewItem | null {
      // A session that changed nothing has nothing to review, so it must not
      // occupy a slot in the queue the backpressure gate counts (FR-045).
      if (candidate.diffSummary.files === 0) return null

      const graded: GradedChange = gradeRisk(candidate.change)
      const item: ReviewItem = {
        sessionId: candidate.sessionId,
        repoPath: candidate.repoPath,
        branch: candidate.branch,
        grade: graded.grade,
        gradeTrigger: graded.trigger,
        queuedAt: candidate.queuedAt,
        diffSummary: candidate.diffSummary,
        // Intent first: the step every diff viewer skips, and the one that
        // catches work the request never asked for (FR-051).
        step: 'intent',
      }
      items.set(candidate.sessionId, item)
      return item
    },

    remove(sessionId: string): void {
      items.delete(sessionId)
    },

    advance(sessionId: string): ReviewStep | null {
      const item = items.get(sessionId)
      if (item === undefined) return null
      const index = REVIEW_STEPS.indexOf(item.step)
      // Already at the last step: the flow is complete, not wrapped around.
      if (index === REVIEW_STEPS.length - 1) return null
      const step = REVIEW_STEPS[index + 1]
      items.set(sessionId, { ...item, step })
      return step
    },

    list(): ReviewItem[] {
      return [...items.values()].sort(
        (a, b) =>
          GRADE_ORDER[a.grade] - GRADE_ORDER[b.grade] ||
          // Within a grade, oldest first — it has been waiting longest.
          a.queuedAt - b.queuedAt
      )
    },

    count(): number {
      return items.size
    },
  }
}
