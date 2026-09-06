import { PHASE_ORDER } from '../types/speckit.types.js'
import type { BoardStage, PhaseId, PhaseState, RunMeta } from '../types/speckit.types.js'

const PHASE_STAGE: Record<PhaseId, BoardStage> = {
  constitution: 'in-progress',
  specify: 'in-progress',
  clarify: 'in-progress',
  plan: 'in-progress',
  checklist: 'in-progress',
  tasks: 'in-progress',
  analyze: 'in-progress',
  implement: 'in-progress',
  'self-review': 'in-review',
  'open-pr': 'in-review',
}

/**
 * Derive a card's board stage from its phase progress and run.
 *
 * Pure and total — always returns a valid BoardStage. Backlog is the only stage
 * that exists before a run; all other stages are derived from the current phase.
 */
export function deriveStage(phases: Record<PhaseId, PhaseState>, run: RunMeta | null): BoardStage {
  if (run === null) return 'backlog'

  if (run.status === 'completed') return 'done'

  const openPr = phases['open-pr']
  if (openPr && openPr.status === 'approved') return 'done'

  // First phase that is not yet finished (approved/skipped) is the "current" one.
  const current = PHASE_ORDER.find((id) => {
    const status = phases[id]?.status
    return status !== 'approved' && status !== 'skipped'
  })

  if (!current) return 'in-review'

  return PHASE_STAGE[current]
}
