import { runIdFrom } from './ci.js'
import type { Check, CiVerdict } from './ci.js'
import { nodeById, withNode } from './run-graph.js'
import type { Feedback, RunGraph } from './run-graph.js'
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
  const watch = new CiWatch(input, input.rounds)
  for (let round = 0; ; round += 1) {
    const results = await watch.watchRound(round)
    const combined = combine(results)
    if (combined.kind === 'green') return watch.green(round, results)
    if (combined.kind === 'not_measured') return watch.notMeasured(round, combined.reason)
    const red = await watch.redOf(combined.reds)
    if (round >= watch.max) return watch.exhausted(round, red)
    if (!(await watch.sendBack(round, red, results))) {
      return { kind: 'halted', reason: 'the fix round could not finish' }
    }
  }
}

/** What a red round found: the checks, the names of the failing ones, and their logs. */
interface Red {
  readonly checks: readonly Check[]
  readonly names: string
  readonly excerpt: string
}

/** One order's CI watch across its rounds: the latest checks per pull, and the runs judged. */
class CiWatch {
  private readonly subject: string
  private readonly latest = new Map<string, readonly Check[]>()
  private readonly judged: Map<string, Set<string>>

  constructor(
    private readonly input: CiRoundsInput,
    readonly max: number
  ) {
    this.subject = subjectOf(input.pulls)
    this.judged = new Map(input.pulls.map((p) => [p.url, new Set<string>()]))
  }

  private snapshot(): readonly { url: string; checks: readonly Check[] }[] {
    return this.input.pulls.map((p) => ({ url: p.url, checks: this.latest.get(p.url) ?? [] }))
  }

  private buckets(): string {
    return JSON.stringify(this.snapshot().map((p) => p.checks.map((c) => c.bucket)))
  }

  private state(round: number, status: CiState['status'], reason = ''): Promise<void> {
    return this.input.state({ round, max: this.max, status, pulls: this.snapshot(), reason })
  }

  async watchRound(round: number): Promise<Result[]> {
    await this.state(round, 'watching')
    await this.input.record('ci.watching', this.subject, 'Watching CI')
    const progress = { shown: this.buckets(), writes: [] as Promise<void>[] }
    const results = await Promise.all(
      this.input.pulls.map(async (pull) => {
        const verdict = await this.input.watch(
          pull,
          (checks) => this.polled(round, { pull, checks }, progress),
          new Set(this.judged.get(pull.url))
        )
        this.latest.set(pull.url, verdict.checks)
        return { pull, verdict }
      })
    )
    // Settled before the result is written, so a late poll cannot overwrite it.
    await Promise.all(progress.writes)
    return results
  }

  /** Written when what is passing changes, not on every poll. */
  private polled(
    round: number,
    { pull, checks }: { pull: Pull; checks: readonly Check[] },
    progress: { shown: string; writes: Promise<void>[] }
  ): void {
    this.latest.set(pull.url, checks)
    const seen = this.buckets()
    if (seen === progress.shown) return
    progress.shown = seen
    progress.writes.push(this.state(round, 'watching').catch(() => undefined))
  }

  async green(round: number, results: readonly Result[]): Promise<CiOutcome> {
    const checks = results.flatMap((r) => r.verdict.checks)
    await this.input.record('ci.green', this.subject, 'CI is green')
    await this.state(round, 'green')
    return { kind: 'green', checks }
  }

  async notMeasured(round: number, reason: string): Promise<CiOutcome> {
    await this.input.record('ci.not_measured', this.subject, reason)
    await this.state(round, 'not_measured', reason)
    return { kind: 'not_measured', reason }
  }

  async redOf(reds: readonly Result[]): Promise<Red> {
    const checks = reds.flatMap((r) => r.verdict.checks)
    const names = checks
      .filter((c) => c.bucket === 'fail' || c.bucket === 'cancel')
      .map((c) => c.name)
      .join(', ')
    const logs = await Promise.all(
      reds.map((r) => this.input.failedLogs(r.verdict.checks, r.pull.cwd))
    )
    return { checks, names, excerpt: logs.join('\n\n') }
  }

  async exhausted(round: number, red: Red): Promise<CiOutcome> {
    const reason = `CI red on ${red.names} after ${this.max} rounds`
    await this.input.record('ci.exhausted', this.subject, reason)
    await this.state(round, 'red', reason)
    return { kind: 'red', checks: red.checks, excerpt: red.excerpt, rounds: this.max }
  }

  /** Hands a red round back to the builder; false when that round could not finish. */
  async sendBack(round: number, red: Red, results: readonly Result[]): Promise<boolean> {
    await this.input.record(
      'ci.round',
      this.subject,
      `CI red on ${red.names}; round ${round + 1} of ${this.max}, back to the builder`
    )
    await this.state(round, 'reworking', `CI red on ${red.names}`)
    for (const { pull, verdict } of results) {
      for (const c of verdict.checks) {
        const id = runIdFrom(c.link)
        if (id !== null) (this.judged.get(pull.url) as Set<string>).add(id)
      }
    }
    return this.input.sendBack({
      from: 'ci',
      attempt: round + 1,
      source: 'ci',
      command: null,
      exitCode: null,
      excerpt: red.excerpt,
      logPath: null,
    })
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

/**
 * The ship node once the tail has finished with it.
 *
 * The executor leaves it `running` when it reaches the recipe's terminal
 * `ready-for-review` gate, because the final check and the CI watch still
 * stand between there and the question. It passes when the question is raised
 * and goes back to `waiting` when shipping stopped short of it, so a resume
 * owes the tail again. A node in any other state is returned untouched.
 */
export function settleShip(
  graph: RunGraph,
  shipId: string,
  { asked, at }: { asked: boolean; at: string }
): RunGraph {
  const node = nodeById(graph, shipId)
  if (node === undefined) return graph
  if (node.state !== 'running' && !(asked && node.state === 'waiting')) return graph
  return withNode(graph, shipId, {
    state: asked ? 'passed' : 'waiting',
    endedAt: asked ? at : null,
  })
}

/** A value settled exactly once; later calls to `settle` are ignored. */
export function settledOnce<T>(): { settled: Promise<T>; settle: (value: T) => void } {
  let resolve: (value: T) => void = () => {}
  let done = false
  const settled = new Promise<T>((r) => (resolve = r))
  return {
    settled,
    settle: (value) => {
      if (done) return
      done = true
      resolve(value)
    },
  }
}

/**
 * A CI send-back that waits for the final check (ADR 085). The check climbs
 * the same checkout a builder would edit, so a red round waits for it; when
 * the check failed, its own gate is the operator's next move and the round
 * sends nothing back.
 */
export function afterFinalCheck(
  finalCheckPassed: Promise<boolean>,
  sendBack: (feedback: Feedback) => Promise<boolean>
): (feedback: Feedback) => Promise<boolean> {
  return async (feedback) => ((await finalCheckPassed) ? sendBack(feedback) : false)
}
