import * as path from 'node:path'
import type { Run } from './run-registry.js'
import type { ReviewItem } from './review/review-queue.js'

// The palette over runs and cards.
//
// Three renderings of one question — what needs me, ranked — share this list
// with the panel and the toasts: a run you can see but cannot reach in one
// keystroke is one you check on by hunting for it.
//
// Pure, so the ordering and the wording are testable without a host: the
// extension host takes what this returns and registers it.

export interface PaletteEntry {
  /** Stable per run, so re-registering does not shuffle the list. */
  readonly id: string
  readonly label: string
  readonly description: string
  readonly category: string
  /** What the entry acts on, which is all the handler needs. */
  readonly sessionId: string
  readonly kind: 'run' | 'review'
}

const CATEGORY = 'Pilot'

/** The card's name, which is what a person searches by. */
function cardName(featureDir: string): string {
  return path.basename(featureDir)
}

/**
 * Runs first, worst state first; then the review queue, worst grade first.
 *
 * A palette sorted by name would be alphabetical noise: what belongs at the top
 * is what is blocked, and after that what is waiting on a decision.
 */
const STATE_RANK: Record<Run['state'], number> = {
  waiting: 0,
  stalled: 1,
  ready: 2,
  working: 3,
  finished: 4,
}

export function paletteEntries(
  runs: readonly Run[],
  review: readonly ReviewItem[]
): PaletteEntry[] {
  const runEntries = [...runs]
    .filter((run) => run.state !== 'finished')
    .sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state] || a.branch.localeCompare(b.branch))
    .map<PaletteEntry>((run) => ({
      id: `run.${run.sessionId}`,
      label: `Go to ${cardName(run.featureDir)}`,
      // The state, because "go to" is a different decision when it is stuck.
      description: `${run.state} · ${run.phase} · ${run.branch}`,
      category: CATEGORY,
      sessionId: run.sessionId,
      kind: 'run',
    }))

  // Already worst-first — the queue is kept in that order, and re-sorting here
  // would quietly disagree with the panel.
  const reviewEntries = review.map<PaletteEntry>((item) => ({
    id: `review.${item.sessionId}`,
    label: `Review ${path.basename(item.repoPath)}`,
    description: `${item.grade} · ${item.gradeTrigger} · ${item.diffSummary.files} file${item.diffSummary.files === 1 ? '' : 's'}`,
    category: CATEGORY,
    sessionId: item.sessionId,
    kind: 'review',
  }))

  return [...runEntries, ...reviewEntries]
}
