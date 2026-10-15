import type { StepOutcome } from '../verify/ladder.js'

// Kept apart from baseline.ts, which reads files: the Forge's renderer imports these two.

/** The sentence for a step that failed on the base branch, shared with the Forge. */
export function failedStepSentence(step: StepOutcome, baseBranch: string): string {
  return `${step.name} failed on ${baseBranch} with exit code ${step.exitCode}: \`${step.command}\`.`
}

/** The test step is the one on rung L1; callers do not match on its label. */
export function isTestStep(step: StepOutcome): boolean {
  return step.rung === 'L1'
}
