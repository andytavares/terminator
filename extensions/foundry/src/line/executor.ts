import {
  readyNodes,
  startReady,
  markPassed,
  markFailed,
  isComplete,
  budgetBreach,
} from './scheduler.js'
import { withNode, stepFor } from './run-graph.js'
import type { RunGraph, RunNode } from './run-graph.js'
import { createRoleRegistry } from './roles.js'
import type { RoleRegistry } from './roles.js'
import { brief } from './brief.js'
import { decideReadOnly } from '../runtime/read-only-policy.js'
import type { ResolveSources } from '../recipe/resolve.js'
import type { Recipe, Rule } from '../recipe/parse.js'
import type { Budgets, WorkOrder } from '../order/schema.js'
import { verdictFromExit, summarise } from '../verify/verdict.js'
import type { Verdict } from '../verify/verdict.js'
import { inspectionFor } from '../verify/inspection-triggers.js'
import { ladderFor, climb } from '../verify/ladder.js'
import type { LadderOutcome, LadderStep } from '../verify/ladder.js'
import { raiseGate } from '../gates/rules.js'
import type { Gate, GateRuleId } from '../gates/rules.js'
import { isLive } from '../gates/autonomy.js'
import type { Autonomy } from '../gates/autonomy.js'

// The thing that joins the pieces.
//
// The scheduler says what may start, the role registry says how it is allowed
// to run, and a session actually runs it. Each of those was testable alone and
// none of them did anything on its own — this is where a run happens.
//
// Everything the executor enforces is enforced here rather than asked for in a
// prompt: a role that may not resume is refused a session to resume, a role
// that may not write gets a read-only decision on every tool call, and a
// verdict that came from the working session is rejected outright.

export interface StartedRun {
  readonly sessionId: string
  /** Null when the run produced no exit status — "not measured", not a failure. */
  readonly exitCode: number | null
}

export interface ExecutorDeps {
  /** Runs one node and resolves when its turn is over. */
  readonly run: (input: {
    node: RunNode
    role: string | null
    prompt: string
    /** Undefined for a role that may not resume, always. */
    resumeSessionId: string | undefined
    /** True when this role may not write; the caller installs the policy. */
    readOnly: boolean
  }) => Promise<StartedRun>
  readonly now: () => string
  readonly sources: ResolveSources
  readonly onEvent?: (event: ExecutorEvent) => void

  /**
   * Put a raised gate where the operator will see it.
   *
   * A seam rather than a store, so the executor knows nothing about disk. A
   * run with no way to raise a gate does not silently continue past one: it
   * halts, and says which rule it could not put in front of anybody.
   */
  readonly raise?: (gate: Gate) => Promise<void>

  /** Which rules are live. Without one, everything is asked — the safe end. */
  readonly autonomy?: Autonomy

  /** The house rules in force here, for the brief. Loaded by the caller. */
  readonly rules?: readonly Rule[]

  /**
   * Run one rung of the verification ladder, returning its exit status.
   *
   * Null means it did not run, which the ladder reports as "not measured" and
   * never as a pass. Absent entirely means the whole climb is not measured —
   * honest, and visible, rather than a silent green.
   */
  readonly runStep?: (step: LadderStep) => Promise<number | null>

  /** Minutes elapsed and files touched, for the budget rules. */
  readonly observe?: () => { elapsedMinutes: number; filesTouched: number }
}

export type ExecutorEvent =
  | { type: 'started'; nodeId: string; sessionId: string }
  | { type: 'passed'; nodeId: string }
  | { type: 'failed'; nodeId: string; needsDecision: boolean }
  | { type: 'verdict'; verdict: Verdict }
  | { type: 'inspection'; required: boolean; triggers: readonly string[] }
  | { type: 'gate'; gate: Gate }
  | { type: 'ladder'; outcome: LadderOutcome }

export interface RunOutcome {
  readonly graph: RunGraph
  readonly verdicts: readonly Verdict[]
  readonly complete: boolean
  /** Nodes whose next attempt must be a decision rather than a retry. */
  readonly awaitingDecision: readonly string[]
  /** Gates this run raised. Empty when nothing needed anybody. */
  readonly gates: readonly Gate[]
  /** The climb, or null when the units never got far enough to warrant one. */
  readonly ladder: LadderOutcome | null
  /** What the accumulated change was graded, and whether it warrants a look. */
  readonly inspection: { required: boolean; triggers: readonly string[]; reason: string }
  /**
   * True when the work is finished *and* nothing is waiting on a person, so
   * the caller may ship. Distinct from `complete`: a graph with every node
   * passed and an open gate is complete and must not ship.
   */
  readonly shippable: boolean
}

/**
 * What this node's agent is told.
 *
 * The role's prompt plus whatever that role declared it may read, resolved
 * against this order and this unit. The bare prompt on its own describes a
 * job and names no work, which is every "it built the wrong thing" failure.
 */
function promptFor(
  order: WorkOrder,
  recipe: Recipe,
  node: RunNode,
  roles: RoleRegistry,
  rules: readonly Rule[]
): string {
  const step = stepFor(recipe, node)
  if (step === undefined) return ''
  return brief({
    order,
    role: node.role === null ? null : roles.get(node.role),
    unit:
      node.unitId === null ? null : (order.plan.units.find((u) => u.id === node.unitId) ?? null),
    rules,
    command: step.kind === 'run' ? (step.command ?? '') : undefined,
  })
}

/**
 * Run everything that can run, one wave at a time, until nothing else can.
 *
 * A wave rather than a loop over nodes because the agent budget is a property
 * of the whole graph: what may start depends on what is already running, so
 * starting them one at a time and asking again is the only way the limit means
 * anything.
 */
export async function execute(
  order: WorkOrder,
  recipe: Recipe,
  graph: RunGraph,
  deps: ExecutorDeps
): Promise<RunOutcome> {
  const roles = createRoleRegistry(deps.sources)
  const budgets: Budgets = order.budgets
  const rules = deps.rules ?? []
  const autonomy: Autonomy = deps.autonomy ?? 'escorted'
  const verdicts: Verdict[] = []
  const awaitingDecision: string[] = []
  const gates: Gate[] = []

  let current = graph
  let gateSeq = 0

  /**
   * Raise one, if this autonomy setting is asking about it.
   *
   * Returns true when the run must stop. A rule this setting silences raises
   * nothing and stops nothing — that is what the dial *is*. A rule it asks
   * about, with nowhere to put the question, still stops: continuing past a
   * decision nobody could take is the failure the gates exist to prevent.
   */
  async function raise(
    rule: GateRuleId,
    input: { summary: string; why: string; nodeId?: string | null; blockedUnits?: number }
  ): Promise<boolean> {
    if (!isLive(rule, autonomy)) return false
    gateSeq += 1
    const gate = raiseGate({
      id: `${order.id}-${rule}-${gateSeq}`,
      rule,
      orderId: order.id,
      nodeId: input.nodeId ?? null,
      summary: input.summary,
      why: input.why,
      riskGrade: order.risk.grade,
      blockedUnits: input.blockedUnits ?? current.nodes.filter((n) => n.state === 'waiting').length,
      at: deps.now(),
    })
    gates.push(gate)
    deps.onEvent?.({ type: 'gate', gate })
    await deps.raise?.(gate)
    return true
  }

  let halted = false

  while (!isComplete(current) && !halted) {
    // Budgets are part of the agreement, not advice. Checked before a wave
    // rather than after, so a breach stops the next agent instead of being
    // discovered once it has spent its turn.
    const observed = deps.observe?.() ?? { elapsedMinutes: 0, filesTouched: 0 }
    const breach = budgetBreach(budgets, {
      ...observed,
      agents: current.nodes.filter((n) => n.state === 'running').length,
    })
    if (breach !== null) {
      halted = await raise('budget.exceeded', {
        summary: `${order.title} has gone past its ${breach.kind.replace('_', ' ')} budget`,
        why: `The order budgets ${breach.limit} and this run is at ${breach.actual}.`,
      })
      if (halted) break
    }

    const ready = readyNodes(current, budgets)
    if (ready.length === 0) break

    // A join is a synchronisation point, not work. Its dependencies are what
    // it was waiting for, and the scheduler only offered it because they are
    // done — so it passes here rather than being launched as an agent with
    // nothing to do, which is what it used to be.
    const joins = ready.filter((node) => node.kind === 'join')
    if (joins.length > 0) {
      for (const join of joins) current = markPassed(current, join.id, deps.now())
      continue
    }

    // A gate node in the recipe is a stated pause. It is not the executor's to
    // answer: it is raised, and the run stops until the inbox comes back.
    const blocking = ready.find((node) => node.kind === 'gate')
    if (blocking !== undefined) {
      halted = await raise('unit.boundary', {
        summary: `${order.title} reached the "${blocking.stepId}" checkpoint`,
        why: `The "${recipe.id}" shape of work stops here by design.`,
        nodeId: blocking.id,
      })
      // A silenced checkpoint is a checkpoint that does not stop anything —
      // but the node still has to leave the graph, or the wave loops on it.
      current = markPassed(current, blocking.id, deps.now())
      if (halted) break
      continue
    }

    const started = startReady(current, budgets, deps.now())
    current = started.graph

    const results = await Promise.all(
      started.started
        .map((id) => current.nodes.find((n) => n.id === id))
        .filter((n): n is RunNode => n !== undefined && n.kind !== 'gate')
        .map(async (node) => {
          const roleId = node.role
          // Structural, not advisory. A role that may not resume is never
          // handed a session to resume, whatever a prompt might ask for.
          if (roleId !== null) roles.assertResumable(roleId, undefined)
          const readOnly = roleId !== null && !roles.mayWrite(roleId)

          const result = await deps.run({
            node,
            role: roleId,
            prompt: promptFor(order, recipe, node, roles, rules),
            resumeSessionId: undefined,
            readOnly,
          })
          return { node, result }
        })
    )

    for (const { node, result } of results) {
      current = withNode(current, node.id, { sessionId: result.sessionId })
      deps.onEvent?.({ type: 'started', nodeId: node.id, sessionId: result.sessionId })

      // The verdict comes from the exit status. Whatever the run printed is
      // evidence, never the decision.
      if (node.unitId !== null) {
        const criteria = order.plan.units.find((u) => u.id === node.unitId)?.satisfies ?? []
        for (const criterionId of criteria) {
          const verdict = verdictFromExit({
            nodeId: node.id,
            criterionId,
            command: `${node.role ?? node.stepId} on ${node.unitId}`,
            exitCode: result.exitCode,
            // The checking party is never the working session.
            nodeSessionId: result.sessionId,
            producedBy: { role: 'verifier', sessionId: `${result.sessionId}-verify` },
            at: deps.now(),
          })
          verdicts.push(verdict)
          deps.onEvent?.({ type: 'verdict', verdict })
        }
      }

      if (result.exitCode === 0) {
        current = markPassed(current, node.id, deps.now())
        deps.onEvent?.({ type: 'passed', nodeId: node.id })
      } else {
        const failure = markFailed(current, node.id, deps.now())
        current = failure.graph
        deps.onEvent?.({ type: 'failed', nodeId: node.id, needsDecision: failure.needsDecision })

        if (failure.needsDecision) {
          awaitingDecision.push(node.id)
          // Two failures is a pattern, not bad luck. The third attempt is a
          // decision rather than a retry, and this is where it is asked for.
          halted =
            (await raise('verify.repeat-fail', {
              summary: `${node.unitId ?? node.id} failed twice`,
              why: `Attempt ${node.attempts + 1} of ${node.id} exited ${result.exitCode ?? 'without a status'}. A third try is a decision, not a retry.`,
              nodeId: node.id,
            })) || halted
        }
      }
    }
  }

  // The accumulated change, not any single unit — which is what stops a unit
  // finishing early from skipping the inspection.
  const touched = [...new Set(order.plan.units.flatMap((u) => u.touches))]
  const summary = summarise(verdicts)
  const inspection = inspectionFor(order, {
    changedFiles: touched,
    linesChanged: 0,
    checkState: summary.ok ? 'passing' : 'failing',
  })
  deps.onEvent?.({
    type: 'inspection',
    required: inspection.required,
    triggers: inspection.triggers,
  })

  // The ladder runs over the finished work, and only when there is finished
  // work to climb over: a run that halted at a gate has not earned a verdict
  // on the whole change, and reporting one would be inventing it.
  let ladder: LadderOutcome | null = null
  if (!halted && isComplete(current)) {
    ladder = await climb(
      ladderFor({
        toolchain: order.context.toolchain,
        risk: { ...order.risk, triggers: [...inspection.triggers] },
        touchesUi: touched.some((path) => /\.(tsx|css|html|svelte|vue)$/.test(path)),
      }),
      deps.runStep ?? (() => Promise.resolve(null))
    )
    deps.onEvent?.({ type: 'ladder', outcome: ladder })
  }

  // The three rules that fire on what the change turned out to be, rather than
  // on what the plan said it would be. Raised after the work, because that is
  // when the answer exists.
  if (!halted && ladder !== null) {
    if (inspection.required) {
      halted = await raise('risk.p0', {
        summary: `${order.title} graded ${inspection.grade} once it was done`,
        why: `${inspection.reason} Triggered by ${inspection.triggers.join(', ')}.`,
      })
    }
    if (!halted && !ladder.ok) {
      halted = await raise('verify.repeat-fail', {
        summary: `${order.title} did not pass verification`,
        why:
          ladder.stoppedAt === null
            ? `Nothing failed, but ${ladder.unmeasured.join(', ')} could not be measured here.`
            : `The climb stopped at ${ladder.stoppedAt}: ${ladder.steps.find((s) => s.result === 'fail')?.reason ?? 'a step failed'}.`,
      })
    }
  }

  const complete = isComplete(current)
  return {
    graph: current,
    verdicts,
    complete,
    awaitingDecision,
    gates,
    ladder,
    inspection: {
      required: inspection.required,
      triggers: inspection.triggers,
      reason: inspection.reason,
    },
    // Everything done, nothing waiting on a person, and the climb either
    // passed or was never owed. A complete graph with an open gate is not
    // shippable, which is the distinction this field exists to make.
    shippable: complete && !halted && gates.length === 0 && (ladder?.ok ?? false),
  }
}

/**
 * Whether a tool call a read-only role made is allowed.
 *
 * Exposed so the caller can hand it to the `PreToolUse` hook: a verifier that
 * decided to fix what it found is refused by the hook, not by a reminder in
 * its prompt.
 */
export function readOnlyDecision(
  toolName: string,
  input: unknown
): { allow: boolean; reason: string } {
  const decision = decideReadOnly(toolName, input)
  return { allow: decision.allow, reason: decision.reason }
}
