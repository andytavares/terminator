// A diagnostic for a hung e2e launch (ADR 123): which readiness step never answered.

export const LAUNCH_STEPS = ['firstWindow', 'size', 'drawn', 'focused', 'sidebar'] as const
export type LaunchStep = (typeof LAUNCH_STEPS)[number]

export interface LaunchSteps {
  /** Records that `step` has settled. */
  reached(step: LaunchStep): void
  /** The first step not yet reached and the ones that were, for a launch error. */
  describe(): string
}

export function createLaunchSteps(): LaunchSteps {
  const settled = new Set<LaunchStep>()
  return {
    reached: (step) => void settled.add(step),
    describe() {
      const reached = LAUNCH_STEPS.filter((step) => settled.has(step))
      const waiting = LAUNCH_STEPS.find((step) => !settled.has(step))
      if (waiting === undefined) return `every step was reached (${reached.join(', ')})`
      return `waiting on: ${waiting} (reached: ${reached.join(', ') || 'nothing'})`
    },
  }
}
