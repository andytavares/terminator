import {
  readyNodes,
  startReady,
  markPassed,
  isComplete,
  hasStalled,
  stalledWhy,
} from './scheduler.js'
import { withNode, stepFor, nodeLabel, nodeById } from './run-graph.js'
import type { RunNode } from './run-graph.js'
import type { GateRuleId } from '../gates/rules.js'
import { isGateRule } from './execution-parts.js'
import type { Execution } from './execution.js'
import { launchNode, type Launched } from './execution-launch.js'
import { settleNode } from './execution-settle.js'

// Runs everything that can run, a wave at a time: the agent budget is the whole
// graph's, so what may start depends on what already runs.

export async function runWaves(run: Execution): Promise<void> {
  while (!isComplete(run.current) && !run.halted) {
    // Budgets are part of the agreement, not advice. Checked before a wave
    // rather than after, so a breach stops the next agent instead of being
    // discovered once it has spent its turn.
    if (await stoppedByBudget(run)) break
    const ready = readyNodes(run.current, run.order.budgets)
    if (ready.length === 0) {
      await noteStall(run)
      break
    }
    // A join is a synchronisation point, not work: the scheduler offered it because
    // its dependencies are done, so it passes here instead of launching an agent.
    const joins = ready.filter((node) => node.kind === 'join')
    if (joins.length > 0) {
      for (const join of joins) await run.advance(markPassed(run.current, join.id, run.deps.now()))
      continue
    }
    const blocking = ready.find((node) => node.kind === 'gate')
    if (blocking !== undefined) {
      if (await stopsAt(run, blocking)) break
      continue
    }
    if (!(await runWave(run))) break
  }
}

async function stoppedByBudget(run: Execution): Promise<boolean> {
  const breach = await run.currentBreach()
  if (breach === null) return false
  run.halted = await run.stopAtGate('budget.exceeded', {
    summary: `${run.order.title} has gone past its ${breach.kind.replace('_', ' ')} budget`,
    why: `The order budgets ${breach.limit} and this run is at ${Math.round(breach.actual)}.`,
    breach,
  })
  return run.halted
}

// Nothing running, nothing runnable, not finished: the graph cannot move. Said out
// loud, not as "waiting on a gate" when no gate exists.
async function noteStall(run: Execution): Promise<void> {
  const { current, order } = run
  if (!hasStalled(current, order.budgets)) return
  run.halted = await run.stopAtGate('verify.repeat-fail', {
    summary: `${order.title} cannot go any further on its own`,
    why: stalledWhy(current, (id) => `**${nodeLabel(order, nodeById(current, id) as RunNode)}**`),
    // The node the Inbox's "Send back" should retry — not just that
    // *something* failed. Null only when nothing here is actually failed,
    // which a cycle can still produce.
    nodeId: current.nodes.find((n) => n.state === 'failed')?.id ?? null,
  })
  run.stalled = true
}

// A gate node is a stated pause, the recipe's own rule, options and default: raised,
// and the run stops until the inbox answers. True when the run stops here.
async function stopsAt(run: Execution, blocking: RunNode): Promise<boolean> {
  const step = stepFor(run.recipe, blocking)
  const declared = step?.rule
  if (declared === 'ready-for-review') {
    await holdForShipping(run, blocking)
    return true
  }
  const rule: GateRuleId = isGateRule(declared) ? declared : 'unit.boundary'
  run.halted = await run.stopAtGate(rule, {
    summary: `${run.order.title} reached the "${blocking.stepId}" checkpoint`,
    why: `The "${run.recipe.id}" shape of work stops here by design.`,
    nodeId: blocking.id,
    deadlineMinutes: step?.deadlineMinutes,
  })
  // A silenced checkpoint is a checkpoint that does not stop anything — but
  // the node still has to leave the graph, or the wave loops on it.
  await run.advance(markPassed(run.current, blocking.id, run.deps.now()))
  return run.halted
}

// A terminal `ready-for-review` gate means "shipping happens here": the question is
// raised once the drafts exist. Left `running` meanwhile, since the final check and
// CI still stand before it; the tail marks it passed when the ready gate is raised.
async function holdForShipping(run: Execution, gate: RunNode): Promise<void> {
  await run.advance(
    withNode(run.current, gate.id, {
      state: 'running',
      startedAt: gate.startedAt ?? run.deps.now(),
      attempts: gate.attempts + 1,
    })
  )
}

/** Starts what may start, settles each node as it ends, and starts what that frees. False when the budget stopped it. */
async function runWave(run: Execution): Promise<boolean> {
  const wave = drainWave(run).then(() => [])
  const waved = await run.waveOrBreach(wave)
  if ('breach' in waved) {
    const { breach } = waved
    run.halted = await run.stopAtGate('budget.exceeded', {
      summary: `${run.order.title} has gone past its ${breach.kind.replace('_', ' ')} budget`,
      why:
        `The order budgets ${breach.limit} and this run is at ${Math.round(breach.actual)}. ` +
        `Its agents are still in their terminals — nothing was thrown away.`,
      breach,
    })
    // Even where the rule is silenced, a run past its budget stops asking for
    // more. The budget is part of what was agreed, not a preference.
    return false
  }
  return true
}

// A slot freed by one node goes to the next ready one at once, not when the whole
// wave ends. Settlements run one at a time: each reads and rewrites the graph. One
// that throws does not stop the others; the first error fails the run after them.
async function drainWave(run: Execution): Promise<void> {
  const flights: Promise<void>[] = []
  const failures: unknown[] = []
  let turn: Promise<void> = Promise.resolve()
  const settleInTurn = (launched: Launched): Promise<void> => {
    const mine = turn.then(async () => {
      await settleNode(run, launched)
      if (await canRefill(run)) await launchReady()
    })
    turn = mine.catch(() => undefined)
    return mine.catch((error: unknown) => void failures.push(error))
  }
  const launchReady = async (): Promise<void> => {
    const started = startReady(run.current, run.order.budgets, run.deps.now())
    await run.advance(started.graph)
    for (const id of started.started) {
      const node = nodeById(run.current, id)
      if (node === undefined || node.kind === 'gate') continue
      flights.push(
        launchNode(run, node).then(settleInTurn, (error: unknown) => void failures.push(error))
      )
    }
  }
  await launchReady()
  for (let next = 0; next < flights.length; next++) await flights[next]
  if (failures.length > 0) throw failures[0]
}

// Joins pass on the spot. Work is offered only when no gate stands ready: a gate
// stops the run, and the loop in `runWaves` handles it once the agents in flight end.
async function canRefill(run: Execution): Promise<boolean> {
  for (;;) {
    // A breach stops new agents even when its gate is silenced and the run is not halted.
    if (run.halted || (await run.currentBreach()) !== null) return false
    const ready = readyNodes(run.current, run.order.budgets)
    const join = ready.find((node) => node.kind === 'join')
    if (join === undefined) return ready.length > 0 && !ready.some((n) => n.kind === 'gate')
    await run.advance(markPassed(run.current, join.id, run.deps.now()))
  }
}
