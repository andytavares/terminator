import type { Baseline } from '../../src/line/baseline.js'
import type { EnvironmentFacts } from '../../src/forge/readiness.js'
import type { StepOutcome } from '../../src/verify/ladder.js'

const RUNG_OF: Record<string, StepOutcome['rung']> = {
  Format: 'L0',
  Lint: 'L0',
  Tests: 'L1',
  Build: 'L5',
}

/** A step that ran on the base branch, passing unless `over` says otherwise. */
export function baseStep(name: string, over: Partial<StepOutcome> = {}): StepOutcome {
  return {
    rung: RUNG_OF[name] ?? 'L1',
    name,
    result: 'pass',
    reason: '',
    exitCode: 0,
    command: `npm run ${name.toLowerCase()}`,
    ...over,
  }
}

/** A base branch check that finished and passed everything it ran. */
export function provenBaseline(over: Partial<Baseline> = {}): Baseline {
  return {
    state: 'proven',
    startedAt: '2026-09-28T13:00:00.000Z',
    finishedAt: '2026-09-28T13:03:00.000Z',
    baseBranch: 'main',
    commit: 'b289028e5f1c',
    steps: [baseStep('Format'), baseStep('Lint'), baseStep('Tests'), baseStep('Build')],
    logs: {},
    mended: false,
    ...over,
  }
}

/** What a draft needs to be handed off: the base branch proven, nothing waived. */
export const PROVEN_ENVIRONMENT: EnvironmentFacts = { baseline: provenBaseline(), waivedAt: null }
