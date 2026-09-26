import { runIdFrom } from './ci.js'
import type { Check, CiVerdict } from './ci.js'
import type { Feedback } from './run-graph.js'
import type { CiState } from './ci-state.js'
import type { Recipe, Step } from '../recipe/parse.js'

// The tail end of shipping: watch a pull's CI, and if it goes red, send the
// failure back to the builder for a bounded number of automatic rounds before
// giving up and saying so.
//
// This is the design's G2: CI gets at most a handful of unattended fix
// attempts, then exactly one stop — never a loop that reworks forever, and
// never a ship that reports green on a run nobody watched.

export type CiOutcome =
  | { readonly kind: 'none' }
  | { readonly kind: 'green'; readonly checks: readonly Check[] }
  | { readonly kind: 'not_measured'; readonly reason: string }
  | {
      readonly kind: 'red'
      readonly checks: readonly Check[]
      readonly excerpt: string
      readonly rounds: number
    }
  | { readonly kind: 'halted'; readonly reason: string }

interface Pull {
  readonly url: string
  readonly cwd: string
}

interface CiRoundsInput {
  readonly pulls: readonly Pull[]
  readonly rounds: number | null
  readonly watch: (
    pull: Pull,
    onPoll: (checks: readonly Check[]) => void,
    judged: ReadonlySet<string>
  ) => Promise<CiVerdict>
  readonly failedLogs: (checks: readonly Check[], cwd: string) => Promise<string>
  readonly sendBack: (feedback: Feedback) => Promise<boolean>
  readonly record: (action: string, subject: string, reason: string) => Promise<void>
  readonly state: (state: Omit<CiState, 'at'>) => Promise<void>
}

interface Result {
  readonly pull: Pull
  readonly verdict: CiVerdict
}

type Combined =
  | { kind: 'green' }
  | { kind: 'not_measured'; reason: string }
  | { kind: 'red'; reds: readonly Result[] }

function combine(results: readonly Result[]): Combined {
  const reds = results.filter((r) => r.verdict.kind === 'red')
  if (reds.length > 0) return { kind: 'red', reds }
  const notMeasured = results.find((r) => r.verdict.kind === 'not_measured')
  if (notMeasured !== undefined && notMeasured.verdict.kind === 'not_measured') {
    return { kind: 'not_measured', reason: notMeasured.verdict.reason }
  }
  return { kind: 'green' }
}

function subjectOf(pulls: readonly Pull[]): string {
  return pulls.map((p) => p.url).join(', ')
}

export async function ciRounds(input: CiRoundsInput): Promise<CiOutcome> {
  if (input.rounds === null) return { kind: 'none' }
  const rounds = input.rounds
  const subject = subjectOf(input.pulls)
  const latest = new Map<string, readonly Check[]>()
  const judged = new Map<string, Set<string>>(input.pulls.map((p) => [p.url, new Set<string>()]))

  const snapshot = (): readonly { url: string; checks: readonly Check[] }[] =>
    input.pulls.map((p) => ({ url: p.url, checks: latest.get(p.url) ?? [] }))

  for (let round = 0; ; ) {
    await input.state({ round, max: rounds, status: 'watching', pulls: snapshot(), reason: '' })

    const results: Result[] = await Promise.all(
      input.pulls.map(async (pull) => {
        const verdict = await input.watch(
          pull,
          (checks) => {
            latest.set(pull.url, checks)
          },
          new Set(judged.get(pull.url))
        )
        latest.set(pull.url, verdict.checks)
        return { pull, verdict }
      })
    )

    const combined = combine(results)

    if (combined.kind === 'green') {
      const checks = results.flatMap((r) => r.verdict.checks)
      await input.record('ci.green', subject, 'CI is green')
      await input.state({ round, max: rounds, status: 'green', pulls: snapshot(), reason: '' })
      return { kind: 'green', checks }
    }

    if (combined.kind === 'not_measured') {
      await input.record('ci.not_measured', subject, combined.reason)
      await input.state({
        round,
        max: rounds,
        status: 'not_measured',
        pulls: snapshot(),
        reason: combined.reason,
      })
      return { kind: 'not_measured', reason: combined.reason }
    }

    const redChecks = combined.reds.flatMap((r) => r.verdict.checks)
    const names = redChecks
      .filter((c) => c.bucket === 'fail' || c.bucket === 'cancel')
      .map((c) => c.name)
      .join(', ')
    const excerpt = (
      await Promise.all(combined.reds.map((r) => input.failedLogs(r.verdict.checks, r.pull.cwd)))
    ).join('\n\n')

    if (round < rounds) {
      const feedback: Feedback = {
        from: 'ci',
        attempt: round + 1,
        source: 'ci',
        command: null,
        exitCode: null,
        excerpt,
        logPath: null,
      }

      await input.record(
        'ci.round',
        subject,
        `CI red on ${names}; round ${round + 1} of ${rounds}, back to the builder`
      )
      await input.state({
        round,
        max: rounds,
        status: 'reworking',
        pulls: snapshot(),
        reason: `CI red on ${names}`,
      })

      for (const { pull, verdict } of results) {
        for (const c of verdict.checks) {
          const id = runIdFrom(c.link)
          if (id !== null) (judged.get(pull.url) as Set<string>).add(id)
        }
      }
      const ok = await input.sendBack(feedback)
      if (!ok) return { kind: 'halted', reason: 'the fix round could not finish' }

      round += 1
      continue
    }

    const reason = `CI red on ${names} after ${rounds} rounds`
    await input.record('ci.exhausted', subject, reason)
    await input.state({ round, max: rounds, status: 'red', pulls: snapshot(), reason })
    return { kind: 'red', checks: redChecks, excerpt, rounds }
  }
}

/** A fan-out step's inner step, whose shape `StepSchema` leaves untyped. */
function fanoutRole(step: Step): string | undefined {
  const inner = step.step as { role?: unknown } | undefined
  return typeof inner?.role === 'string' ? inner.role : undefined
}

/**
 * The step a CI failure goes back to.
 *
 * Named by the recipe's own `onFail` where one exists — a step already told
 * `rework` what to do on its own failure, and CI is just another way that
 * step's output turned out wrong. Otherwise the first builder in the recipe,
 * because that is the role whose work a red check is almost always about.
 */
export function ciReworkTarget(recipe: Recipe): string | null {
  for (const step of recipe.steps) {
    if (step.onFail !== undefined) return step.onFail.rework
  }
  for (const step of recipe.steps) {
    if (step.kind === 'agent' && step.role === 'builder') return step.id
    if (step.kind === 'fanout' && fanoutRole(step) === 'builder') return step.id
  }
  return null
}

/** The id of the recipe's `ready-for-review` gate — the node CI rounds count. */
export function shipNodeId(recipe: Recipe): string | null {
  const gate = recipe.steps.find((step) => step.kind === 'gate' && step.rule === 'ready-for-review')
  return gate?.id ?? null
}
