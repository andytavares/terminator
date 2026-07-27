/**
 * The all-clear. FR-024 and the automation-complacency argument: the console
 * must assert that everything is fine rather than imply it by saying nothing —
 * silence is indistinguishable from a console that has crashed.
 *
 * Shared because both the attention queue and the status bar answer the same
 * question, and two copies of this rule would drift.
 */
export function allClearMessage(attentionCount: number, workingCount: number): string | null {
  if (attentionCount > 0) return null
  return workingCount === 0
    ? 'Nothing needs you, and nothing is running.'
    : `Nothing needs you. ${workingCount} ${workingCount === 1 ? 'session is' : 'sessions are'} working.`
}
