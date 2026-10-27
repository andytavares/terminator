import type { StepOutcome } from '../verify/ladder.js'

// Kept apart from baseline.ts, which reads files: the Forge's renderer imports this.

/** The sentence for a step that failed on the base branch, shared with the Forge. */
export function failedStepSentence(step: StepOutcome, baseBranch: string): string {
  return `${step.name} failed on ${baseBranch} with exit code ${step.exitCode}: \`${step.command}\`.`
}
