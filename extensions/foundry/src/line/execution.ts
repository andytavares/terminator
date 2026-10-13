import * as path from 'node:path'
import { budgetBreach } from './scheduler.js'
import type { BudgetBreach } from './scheduler.js'
import { withNode } from './run-graph.js'
import type { RunGraph, RunNode } from './run-graph.js'
import { createRoleRegistry } from './roles.js'
import type { RoleRegistry } from './roles.js'
import { collectableWrites, rungOutputPath } from './rung-output.js'
import { orderDir } from '../data-root.js'
import type { Recipe } from '../recipe/parse.js'
import type { WorkOrder } from '../order/schema.js'
import type { Verdict, Evidence } from '../verify/verdict.js'
import { raiseGate } from '../gates/rules.js'
import type { Gate, GateRuleId } from '../gates/rules.js'
import { isLive } from '../gates/autonomy.js'
import type { ExecutorDeps } from './executor.js'

// One run of an order, while it runs: the graph as it stands, what it has
// judged and raised so far, and whether it has stopped. Everything that moves
// the graph or raises a gate goes through here, so there is one place that can
// be wrong rather than fifteen.

/** What a gate this run raises says, beyond its rule. */
export interface GateAsk {
  readonly summary: string
  readonly why: string
  readonly nodeId?: string | null
  readonly blockedUnits?: number
  /**
   * Minutes before this gate takes its stated default. A recipe's own
   * `deadlineMinutes`, when the step declared one — without this the field
   * parsed and reached nothing, so "what happens when nobody answers" was a
   * promise no gate could keep.
   */
  readonly deadlineMinutes?: number
  readonly breach?: BudgetBreach
  readonly evidence?: readonly Evidence[]
  readonly omitOptions?: readonly string[]
}

type Breach = NonNullable<ReturnType<typeof budgetBreach>>

export class Execution {
  readonly roles: RoleRegistry
  current: RunGraph
  /**
   * The order as later briefs see it, which is not the order the run is judged
   * against. See `RungCollection.order`.
   */
  briefed: WorkOrder
  readonly verdicts: Verdict[] = []
  /** unit id → the session that did the work, so a checker is never it. */
  readonly producedUnit = new Map<string, string>()
  readonly awaitingDecision: string[] = []
  readonly gates: Gate[] = []
  readonly priorGates: readonly Gate[]
  halted = false
  stalled = false
  /** Past what is already on file, so a new gate never overwrites a decided one. */
  private gateSeq: number
  /** Nodes whose session is already on the graph, so a late write is not a second start. */
  private readonly announced = new Set<string>()

  constructor(
    readonly plan: { readonly order: WorkOrder; readonly recipe: Recipe; readonly graph: RunGraph },
    readonly deps: ExecutorDeps
  ) {
    this.roles = createRoleRegistry(deps.sources)
    this.current = plan.graph
    this.briefed = plan.order
    this.priorGates = deps.priorGates.filter((g) => g.orderId === plan.order.id)
    this.gateSeq = this.priorGates.length
  }

  get order(): WorkOrder {
    return this.plan.order
  }

  get recipe(): Recipe {
    return this.plan.recipe
  }

  /** The order's own directory under the data root. */
  recordsDir(): string {
    return orderDir(this.deps.sources.dataRoot, this.order.id)
  }

  /**
   * Move to the next state of the graph, and say so. Never fatal: a run that
   * cannot write its graph down is still a run, and failing it here would
   * turn a reporting problem into a lost agent.
   */
  async advance(next: RunGraph): Promise<void> {
    this.current = next
    await this.deps.persist(this.current).catch(() => undefined)
  }

  /**
   * Put a node's session on the graph, and say it started.
   *
   * Called the moment the agent exists rather than when its turn ends. Both
   * happen: `run` reports the session as it comes up, and the result names it
   * again for a caller that reports nothing — the set is what makes the second
   * one a no-op instead of a second start.
   *
   * The Floor renders Watch and Attach on `node.sessionId !== null`, so before
   * this a running rung had no controls at all and the only agent you could
   * reach was one that had already finished.
   */
  async noteStarted(nodeId: string, sessionId: string): Promise<void> {
    if (this.announced.has(nodeId)) return
    this.announced.add(nodeId)
    await this.advance(withNode(this.current, nodeId, { sessionId }))
    this.deps.onEvent({ type: 'started', nodeId, sessionId })
  }

  /**
   * Where this node writes what it found, or null when it has nothing to file.
   *
   * Null for a role whose product is the checkout and for a bare command.
   */
  outputFor(node: RunNode, roleId: string | null): string | null {
    if (roleId === null) return null
    const role = this.roles.get(roleId)
    if (role === null || collectableWrites(role).length === 0) return null
    try {
      return rungOutputPath(this.recordsDir(), node.id)
    } catch {
      // A node id a recipe gave that would not sit under this order. Refusing
      // the channel is right; failing the run over it is not.
      return null
    }
  }

  /** The order's `outputs/` directory, for a role that hands back a document. */
  outputsDirFor(roleId: string | null): string | null {
    if (roleId === null) return null
    const role = this.roles.get(roleId)
    if (!collectableWrites(role).includes('document')) return null
    return path.join(this.recordsDir(), 'outputs')
  }

  /**
   * Raise one, if this autonomy setting is asking about it.
   *
   * Returns true when the run must stop. A rule this setting silences raises
   * nothing and stops nothing — that is what the dial *is*. A rule it asks
   * about, with nowhere to put the question, still stops: continuing past a
   * decision nobody could take is the failure the gates exist to prevent.
   */
  async stopAtGate(rule: GateRuleId, ask: GateAsk): Promise<boolean> {
    if (!isLive(rule, this.deps.autonomy)) return false
    const nodeId = ask.nodeId ?? null
    const approved = this.priorGates.some(
      (g) => g.rule === rule && g.nodeId === nodeId && g.decision?.option === 'approve'
    )
    if (approved) return false
    this.gateSeq += 1
    const gate = this.newGate(rule, { ...ask, nodeId })
    this.gates.push(gate)
    this.deps.onEvent({ type: 'gate', gate })
    await this.deps.raise(gate)
    return true
  }

  private newGate(rule: GateRuleId, ask: GateAsk & { nodeId: string | null }): Gate {
    return raiseGate({
      id: `${this.order.id}-${rule}-${this.gateSeq}`,
      rule,
      orderId: this.order.id,
      nodeId: ask.nodeId,
      summary: ask.summary,
      why: ask.why,
      riskGrade: this.order.risk.grade,
      blockedUnits:
        ask.blockedUnits ?? this.current.nodes.filter((n) => n.state === 'waiting').length,
      at: this.deps.now(),
      deadline:
        ask.deadlineMinutes === undefined
          ? null
          : new Date(Date.parse(this.deps.now()) + ask.deadlineMinutes * 60_000).toISOString(),
      breach: ask.breach ?? null,
      evidence: ask.evidence,
      omitOptions: ask.omitOptions,
    })
  }

  /** The budget, read against what is happening right now. */
  async currentBreach(): Promise<Breach | null> {
    const observed = await this.deps.observe()
    return budgetBreach(this.order.budgets, {
      ...observed,
      agents: this.current.nodes.filter((n) => n.state === 'running' && n.kind !== 'gate').length,
    })
  }

  /**
   * Wait for the wave, or for the budget to be exceeded while it runs.
   *
   * Checking budgets only *between* waves means a single agent that never
   * returns is the one case the check cannot catch — and it is the case the
   * budget exists for. FR-030 asks for a pause when the budget is exceeded,
   * not for one when the wave that exceeded it happens to end.
   *
   * The agents are not killed: their terminals are still there and their work
   * is still in the worktree, which is what "preserving work in progress"
   * means. The run stops asking for more.
   */
  async waveOrBreach<T>(wave: Promise<T[]>): Promise<{ results: T[] } | { breach: Breach }> {
    const pollMs = this.deps.budgetPollMs ?? 15_000
    let settled = false
    const done = wave.then((results) => {
      settled = true
      return results
    })
    for (;;) {
      const raced = await Promise.race([
        done.then((results) => ({ results })),
        this.deps.wait(pollMs).then(() => null),
      ])
      if (raced !== null) return raced
      if (settled) return { results: await done }
      const breach = await this.currentBreach()
      if (breach !== null) return { breach }
    }
  }
}
