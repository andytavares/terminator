import { recordUsage } from '@terminator/extension-sdk/renderer'
import { reviewAgentAPI } from '../api/review-agent'
import type { DraftResult } from '../schemas/review-agent.schema'

const DRAFT_UNAVAILABLE = 'Could not draft from the staged changes. Write the message yourself.'

/** Asks the review agent to draft the commit and PR text for the staged changes; never throws. */
export async function requestDraft(repoRoot: string): Promise<DraftResult> {
  recordUsage('draft-change')
  try {
    const result = await reviewAgentAPI.draftChange(repoRoot)
    return 'error' in result && result.error === 'VALIDATION_ERROR'
      ? { error: DRAFT_UNAVAILABLE }
      : result
  } catch {
    return { error: DRAFT_UNAVAILABLE }
  }
}
