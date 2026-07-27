/**
 * A gate can only be approved once the artefact it approves exists — offering
 * "Approve spec" for an item that has no spec is a button that cannot mean
 * anything. Shared so the board and the main-process gate check cannot drift.
 */
export function gateIsReviewable(
  artifacts: { spec?: string; plan?: string },
  gate: 'spec_approved_by_human' | 'plan_approved_by_human'
): boolean {
  return gate === 'spec_approved_by_human'
    ? artifacts.spec !== undefined
    : artifacts.plan !== undefined
}
