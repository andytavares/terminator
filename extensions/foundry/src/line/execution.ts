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

// One run of an order while it runs: the graph, what it judged and raised, whether it
// stopped. Everything that moves the graph or raises a gate goes through here.

/** What a gate this run raises says, beyond its rule. */
export interface GateAsk {
  readonly summary: string
  readonly why: string
  readonly nodeId?: string | null
  readonly blockedUnits?: number
  /** Minutes before this gate takes its default: the recipe step's `deadlineMinutes`. */
  readonly deadlineMinutes?: number
  readonly breach?: BudgetBreach
  readonly evidence?: readonly Evidence[]
  readonly omitOptions?: readonly string[]
  readonly finalCheck?: boolean
}

type Breach = NonNullable<ReturnType<typeof budgetBreach>>

export class Execution {
  readonly roles: RoleRegistry
  current: RunGraph
  /** The order as later briefs see it, not the one the run is judged against. */
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
  /** The graph write in flight, which the next one waits for. */
  private writing: Promise<void> = Promise.resolve()

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

  // Move to the graph's next state and say so. Never fatal: a run that cannot write
  // its graph is still a run.
  // Writes wait for the one before: steps running at once advance at once, and a write that
  // finished late put an older graph on disk last, losing a session the graph had named.
  async advance(next: RunGraph): Promise<void> {
    this.current = next
    this.writing = this.writing.then(() => this.deps.persist(next)).catch(() => undefined)
    await this.writing
  }

  // Put a node's session on the graph as soon as the agent exists, so the Floor's
  // Watch and Attach appear while it runs. The result names it again; the set makes
  // that a no-op rather than a second start.
  async noteStarted(nodeId: string, sessionId: string): Promise<void> {
    if (this.announced.has(nodeId)) return
    this.announced.add(nodeId)
    await this.advance(withNode(this.current, nodeId, { sessionId }))
    this.deps.onEvent({ type: 'started', nodeId, sessionId })
  }

  /** Where this node files what it found; null for a checkout-only role or a command. */
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

  // Raise one if this autonomy setting asks about it; true when the run must stop. A
  // silenced rule raises and stops nothing; an asked one with nowhere to ask still
  // stops, since continuing past an untakeable decision is what gates prevent.
  async stopAtGate(rule: GateRuleId, ask: GateAsk): Promise<boolean> {
    if (!isLive(rule, this.deps.autonomy)) return false
    const nodeId = ask.nodeId ?? null
    const settled = this.priorGates.some(
      (g) =>
        g.rule === rule &&
        g.nodeId === nodeId &&
        // A debt settles only the final check; on a stall it would leave a run with no gate.
        (g.decision?.option === 'approve' ||
          (g.decision?.option === 'accept_debt' &&
            g.finalCheck === true &&
            ask.finalCheck === true))
    )
    if (settled) return false
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
      finalCheck: ask.finalCheck,
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

  // Wait for the wave, or for a budget breach while it runs: checking only between
  // waves misses the agent that never returns (FR-030). Agents are not killed; their
  // terminals and worktrees stay, and the run stops asking for more.
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
