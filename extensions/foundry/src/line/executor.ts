import { readyNodes, startReady, markPassed, markFailed, isComplete } from './scheduler.js'
import { withNode, stepFor } from './run-graph.js'
import type { RunGraph, RunNode } from './run-graph.js'
import { createRoleRegistry } from './roles.js'
import type { RoleRegistry } from './roles.js'
import { decideReadOnly } from '../runtime/read-only-policy.js'
import type { ResolveSources } from '../recipe/resolve.js'
import type { Recipe } from '../recipe/parse.js'
import type { Budgets, WorkOrder } from '../order/schema.js'
import { verdictFromExit, summarise } from '../verify/verdict.js'
import type { Verdict } from '../verify/verdict.js'
import { inspectionFor } from '../verify/inspection-triggers.js'

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
}

export type ExecutorEvent =
  | { type: 'started'; nodeId: string; sessionId: string }
  | { type: 'passed'; nodeId: string }
  | { type: 'failed'; nodeId: string; needsDecision: boolean }
  | { type: 'verdict'; verdict: Verdict }
  | { type: 'inspection'; required: boolean; triggers: readonly string[] }

export interface RunOutcome {
  readonly graph: RunGraph
  readonly verdicts: readonly Verdict[]
  readonly complete: boolean
  /** Nodes whose next attempt must be a decision rather than a retry. */
  readonly awaitingDecision: readonly string[]
}

function promptFor(recipe: Recipe, node: RunNode, roles: RoleRegistry): string {
  const step = stepFor(recipe, node)
  if (step === undefined) return ''
  if (step.kind === 'run') return step.command ?? ''
  const role = node.role === null ? null : roles.get(node.role)
  return role?.prompt ?? ''
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
  const verdicts: Verdict[] = []
  const awaitingDecision: string[] = []

  let current = graph

  while (!isComplete(current)) {
    const ready = readyNodes(current, budgets)
    if (ready.length === 0) break

    // A gate is not the executor's to answer. It stops this wave and waits for
    // a decision to arrive through the inbox.
    const runnable = ready.filter((node) => node.kind !== 'gate')
    if (runnable.length === 0) break

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
            prompt: promptFor(recipe, node, roles),
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
            command: promptFor(recipe, node, roles),
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
        if (failure.needsDecision) awaitingDecision.push(node.id)
        deps.onEvent?.({ type: 'failed', nodeId: node.id, needsDecision: failure.needsDecision })
      }
    }
  }

  // Over the accumulated change, so a unit finishing early cannot skip it.
  const touched = [...new Set(order.plan.units.flatMap((u) => u.touches))]
  const inspection = inspectionFor(order, {
    changedFiles: touched,
    linesChanged: 0,
    checkState: summarise(verdicts).ok ? 'passing' : 'failing',
  })
  deps.onEvent?.({
    type: 'inspection',
    required: inspection.required,
    triggers: inspection.triggers,
  })

  return {
    graph: current,
    verdicts,
    complete: isComplete(current),
    awaitingDecision,
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
