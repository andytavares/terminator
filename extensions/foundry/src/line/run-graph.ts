import { fanoutTargets, evaluateWhen } from '../recipe/step-kinds.js'
import type { Recipe, Step, StepKind } from '../recipe/parse.js'
import type { PlanUnit, WorkOrder } from '../order/schema.js'

// An agreed order plus a recipe becomes a run graph.
//
// The graph is derived, never authored and never the truth: it is recomputable
// from the order and the recipe plus each node's state, which is what lets the
// order stay immutable while work runs. An order that changed while its own
// work was running would mean the agreement moved under the work.

export type NodeState =
  | 'waiting'
  | 'ready'
  | 'running'
  | 'verifying'
  | 'passed'
  | 'failed'
  | 'blocked'
  | 'skipped'

export interface RunNode {
  /** `step`, or `step:unit` for a child of a fan-out. */
  readonly id: string
  readonly stepId: string
  readonly kind: StepKind
  readonly state: NodeState
  /**
   * Every unit this node is responsible for, in the order to do them.
   *
   * A list rather than one id because a fan-out `by lane` gives one node a
   * whole lane's work — see `fanoutTargets`. Empty for a step that is not
   * about a unit at all.
   */
  readonly unitIds: readonly string[]
  readonly lane: number | null
  readonly role: string | null
  readonly dependsOn: readonly string[]
  /** Two failures and the third attempt becomes a decision, not a retry. */
  readonly attempts: number
  readonly sessionId: string | null
  readonly worktreePath: string | null
  readonly startedAt: string | null
  readonly endedAt: string | null
}

export interface RunGraph {
  readonly orderId: string
  readonly recipe: string
  readonly nodes: readonly RunNode[]
}

function node(over: Partial<RunNode> & Pick<RunNode, 'id' | 'stepId' | 'kind'>): RunNode {
  return {
    state: 'waiting',
    unitIds: [],
    lane: null,
    role: null,
    dependsOn: [],
    attempts: 0,
    sessionId: null,
    worktreePath: null,
    startedAt: null,
    endedAt: null,
    ...over,
  }
}

/** Every node a step produced, so a dependent step can wait on all of them. */
function nodesOfStep(nodes: readonly RunNode[], stepId: string): string[] {
  return nodes.filter((n) => n.stepId === stepId).map((n) => n.id)
}

export function buildRunGraph(order: WorkOrder, recipe: Recipe): RunGraph {
  const nodes: RunNode[] = []

  for (const step of recipe.steps) {
    // A condition that is false skips the step rather than removing it: the
    // record has to show that the inspector did not run, and why (FR-044).
    const applies = evaluateWhen(step.when, order)

    if (step.kind === 'fanout') {
      const targets = fanoutTargets(step.over ?? '', order)
      const inner = (step.step ?? {}) as { role?: string }
      // Which node ended up carrying each unit, so a dependency on a unit
      // resolves to the node doing it — the same id under a plain fan-out,
      // and the lane's node under `by lane`.
      const nodeOfUnit = new Map<string, string>()
      for (const target of targets) {
        for (const unit of target.units) nodeOfUnit.set(unit.id, `${step.id}:${target.id}`)
      }

      for (const target of targets) {
        const id = `${step.id}:${target.id}`
        const outside = target.units
          .flatMap((unit) => unit.dependsOn)
          .map((unitId) => nodeOfUnit.get(unitId))
          // A dependency this node already carries is its own internal order,
          // not something to wait for; a node that waited on itself would
          // never become ready.
          .filter(
            (dependency): dependency is string => dependency !== undefined && dependency !== id
          )

        nodes.push(
          node({
            id,
            stepId: step.id,
            kind: 'fanout',
            state: applies ? 'waiting' : 'skipped',
            unitIds: target.units.map((unit) => unit.id),
            lane: target.lane,
            role: inner.role ?? target.units[0]?.role ?? null,
            // A fan-out child waits on the steps its parent waits on, and on
            // whatever carries its units' dependencies. That second half is
            // what makes `depends_on` in the plan mean anything.
            dependsOn: [
              ...step.after.flatMap((after) => nodesOfStep(nodes, after)),
              ...new Set(outside),
            ],
          })
        )
      }
      continue
    }

    nodes.push(
      node({
        id: step.id,
        stepId: step.id,
        kind: step.kind,
        state: applies ? 'waiting' : 'skipped',
        role: step.role ?? null,
        dependsOn: step.after.flatMap((after) => nodesOfStep(nodes, after)),
      })
    )
  }

  return { orderId: order.id, recipe: recipe.id, nodes }
}

/** The step a node came from, for anything that needs the recipe's own words. */
export function stepFor(recipe: Recipe, node: RunNode): Step | undefined {
  return recipe.steps.find((step) => step.id === node.stepId)
}

export function nodeById(graph: RunGraph, id: string): RunNode | undefined {
  return graph.nodes.find((n) => n.id === id)
}

export function withNode(graph: RunGraph, id: string, change: Partial<RunNode>): RunGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((n) => (n.id === id ? { ...n, ...change } : n)),
  }
}

/**
 * What to call a node, to somebody watching the run.
 *
 * `n2` is the handle the graph and the ledger use, and it is the wrong thing
 * to put in front of an operator: watching a run means knowing what is being
 * built, not which array slot it came from. The unit's own title is the best
 * answer, the role is the next best, and the step it came from after that —
 * the id is the last resort rather than the default.
 */
export function nodeLabel(order: WorkOrder | null, node: RunNode): string {
  const units = unitsOf(order, node)

  // A lane node covers a whole lane, and naming it after the first of seven
  // units would describe a seventh of what it is doing. The count and the
  // repository are what an operator watching a run actually needs.
  if (units.length > 1) {
    const repo = order?.plan.lanes.find((lane) => lane.ord === node.lane)?.repo
    const what = `${units.length} units${repo === undefined ? '' : ` in ${repo}`}`
    return node.role === null ? what : `${node.role} · ${what}`
  }

  const unit = units[0]
  if (unit !== undefined) {
    return node.role === null
      ? `${unit.id} ${unit.title}`
      : `${node.role} · ${unit.id} ${unit.title}`
  }
  if (node.role !== null) return node.role
  if (node.stepId.trim() !== '') return node.stepId
  return node.id
}

/** The plan units a node is responsible for, in the order it should do them. */
export function unitsOf(order: WorkOrder | null, node: RunNode): PlanUnit[] {
  if (order === null) return []
  return node.unitIds
    .map((id) => order.plan.units.find((unit) => unit.id === id))
    .filter((unit): unit is PlanUnit => unit !== undefined)
}

/** Every node's label, keyed by id, for a surface that renders many at once. */
export function nodeLabels(order: WorkOrder | null, graph: RunGraph): Record<string, string> {
  return Object.fromEntries(graph.nodes.map((node) => [node.id, nodeLabel(order, node)]))
}

/**
 * Whether this node's step asked for a conversation of its own.
 *
 * A fan-out declares its child's shape in `step:`, so `context: fresh` sits on
 * the inner object rather than on the step itself — which is exactly where
 * five of the six built-in shapes put it, on their verify step.
 */
export function wantsFreshContext(recipe: Recipe, node: RunNode): boolean {
  const step = stepFor(recipe, node)
  if (step === undefined) return false
  if (step.context === 'fresh') return true
  const inner = (step.step ?? {}) as { context?: string }
  return inner.context === 'fresh'
}
