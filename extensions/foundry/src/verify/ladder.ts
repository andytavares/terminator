import type { Toolchain, CheckName } from './toolchain-probe.js'
import type { RiskAssessment } from '../order/schema.js'

// The verification ladder.
//
// Seven rungs, each running as early as it can rather than everything at the
// end. Two properties matter more than the ordering itself.
//
// A failure stops the climb at its own rung. A lint error should never cost a
// security scan, and a failed criterion should never reach a merge gate.
//
// And a rung with no command reports "not measured", with the reason, and is
// never counted as a pass. That is what makes the whole thing honest in a
// repository nobody configured for it.

export const RUNGS = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6'] as const
export type Rung = (typeof RUNGS)[number]

export type RungStatus = 'runnable' | 'unavailable' | 'not_triggered' | 'elsewhere'

export interface LadderStep {
  readonly rung: Rung
  readonly name: string
  /** What to run, or null when this repository has nothing for it. */
  readonly command: string | null
  readonly status: RungStatus
  /** Why it cannot run, or why it was not triggered. Empty when runnable. */
  readonly reason: string
  /** Which probed check this rung came from, where it came from one. */
  readonly check: CheckName | null
}

function step(
  rung: Rung,
  name: string,
  found: { command: string } | null,
  check: CheckName | null
): LadderStep {
  return found === null
    ? {
        rung,
        name,
        command: null,
        status: 'unavailable',
        reason: `this repository has no ${check ?? name} command`,
        check,
      }
    : { rung, name, command: found.command, status: 'runnable', reason: '', check }
}

export interface LadderInput {
  readonly toolchain: Toolchain
  readonly risk: RiskAssessment
  /** True when the change alters something a person looks at. */
  readonly touchesUi: boolean
}

/**
 * The rungs for this repository and this change.
 *
 * L0–L2 run whatever the probe found; L4 runs only on a risk trigger and says
 * so when it does not (FR-044) — a security inspection on every change is how
 * people learn to skim security findings.
 */
export function ladderFor(input: LadderInput): LadderStep[] {
  const { toolchain, risk, touchesUi } = input

  const inspection: LadderStep =
    risk.triggers.length > 0
      ? {
          rung: 'L4',
          name: 'Security inspection',
          command: null,
          status: 'elsewhere',
          reason: `triggered by ${risk.triggers.join(', ')} — see the findings`,
          check: null,
        }
      : {
          rung: 'L4',
          name: 'Security inspection',
          command: null,
          status: 'not_triggered',
          reason: 'this change touches nothing that warrants one',
          check: null,
        }

  const integration: LadderStep = touchesUi
    ? step('L5', 'Integration and a picture of the running application', toolchain.e2e, 'e2e')
    : step('L5', 'Integration', toolchain.e2e, 'e2e')

  return [
    step('L0', 'Format', toolchain.format, 'format'),
    step('L0', 'Lint', toolchain.lint, 'lint'),
    step('L1', "The unit's own tests", toolchain.test, 'test'),
    step('L2', 'Repository gate', toolchain.coverage, 'coverage'),
    {
      rung: 'L3',
      name: 'Independent verification',
      command: null,
      // Not a command, and not a gap: the verifier runs as its own node on
      // every unit, and its exit status is in the criteria table. Calling this
      // "not measured" put three phantom gaps in every pull request body and
      // taught the operator to skim the one signal that matters.
      status: 'elsewhere',
      reason: 'by the verifier on each unit — see the criteria table',
      check: null,
    },
    inspection,
    integration,
    {
      rung: 'L6',
      name: 'Human decision',
      command: null,
      status: 'elsewhere',
      reason: 'only what a rule raised — see the decision below',
      check: null,
    },
  ]
}

export interface StepOutcome {
  readonly rung: Rung
  readonly name: string
  readonly result: 'pass' | 'fail' | 'not_measured' | 'not_triggered' | 'elsewhere'
  readonly reason: string
  readonly exitCode: number | null
}

export interface LadderOutcome {
  readonly steps: readonly StepOutcome[]
  /** Where it stopped, or null when it climbed the whole way. */
  readonly stoppedAt: Rung | null
  /** Every rung that could not run. Never counted as passing. */
  readonly unmeasured: readonly string[]
  readonly ok: boolean
}

export type RunStep = (step: LadderStep) => Promise<number | null>

/**
 * Climb, stopping at the first failure.
 *
 * The runner is injected: in the application these are steps inside the
 * supervised session, and in a test they are a function. Either way the
 * verdict comes from the exit status the runner returns, never from anything
 * it printed.
 */
export async function climb(steps: readonly LadderStep[], run: RunStep): Promise<LadderOutcome> {
  const outcomes: StepOutcome[] = []
  let stoppedAt: Rung | null = null

  for (const step of steps) {
    if (stoppedAt !== null) break

    if (step.status === 'not_triggered') {
      outcomes.push({
        rung: step.rung,
        name: step.name,
        result: 'not_triggered',
        reason: step.reason,
        exitCode: null,
      })
      continue
    }

    if (step.status === 'elsewhere') {
      // Decided, but not here. Neither a pass this climb can claim nor a gap
      // it should report.
      outcomes.push({
        rung: step.rung,
        name: step.name,
        result: 'elsewhere',
        reason: step.reason,
        exitCode: null,
      })
      continue
    }

    if (step.status === 'unavailable') {
      // Not a failure — the climb continues. But it is never a pass either,
      // and it is carried all the way out so nothing downstream can read the
      // absence as a green.
      outcomes.push({
        rung: step.rung,
        name: step.name,
        result: 'not_measured',
        reason: step.reason,
        exitCode: null,
      })
      continue
    }

    const exitCode = await run(step)
    if (exitCode === null) {
      outcomes.push({
        rung: step.rung,
        name: step.name,
        result: 'not_measured',
        reason: 'the step did not run',
        exitCode: null,
      })
      continue
    }

    const passed = exitCode === 0
    outcomes.push({
      rung: step.rung,
      name: step.name,
      result: passed ? 'pass' : 'fail',
      reason: passed ? '' : `exited ${exitCode}`,
      exitCode,
    })
    if (!passed) stoppedAt = step.rung
  }

  return {
    steps: outcomes,
    stoppedAt,
    unmeasured: outcomes.filter((o) => o.result === 'not_measured').map((o) => o.name),
    ok: stoppedAt === null && outcomes.every((o) => o.result !== 'fail'),
  }
}
