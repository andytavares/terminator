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
import { launchNode } from './execution-launch.js'
import { settleNode } from './execution-settle.js'

// Running everything that can run, one wave at a time, until nothing else can.
//
// A wave rather than a loop over nodes because the agent budget is a property
// of the whole graph: what may start depends on what is already running, so
// starting them one at a time and asking again is the only way the limit means
// anything.

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
    // A join is a synchronisation point, not work. Its dependencies are what
    // it was waiting for, and the scheduler only offered it because they are
    // done — so it passes here rather than being launched as an agent with
    // nothing to do, which is what it used to be.
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

/**
 * Nothing running, nothing runnable, and not finished: the graph cannot move
 * on its own. Said out loud, because reporting it as "waiting on a gate" when
 * no gate exists is a run that looks answerable and is not.
 */
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

/**
 * A gate node in the recipe is a stated pause. It is not the executor's to
 * answer: it is raised, and the run stops until the inbox comes back. True
 * when the run stops here.
 *
 * The rule is the recipe's own — every shipped recipe declares one, and
 * ignoring it in favour of a hardcoded rule would give the operator the wrong
 * question, the wrong options and the wrong default.
 */
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

/**
 * A recipe's terminal `ready-for-review` gate is its way of saying "shipping
 * happens here". It is not a pause: the real decision is raised once the
 * drafts exist, by whatever opens them, because "mark it ready?" asked before
 * there is anything to mark is a question with no answer. So it passes, and
 * the tail takes it from here.
 *
 * It is left `running`, not passed: the final check and the CI watch still
 * stand between here and the question, and a graph that reads complete while
 * minutes of work remain is a lie on the Floor. The tail marks it passed when
 * the ready gate is raised.
 */
async function holdForShipping(run: Execution, gate: RunNode): Promise<void> {
  await run.advance(
    withNode(run.current, gate.id, {
      state: 'running',
      startedAt: gate.startedAt ?? run.deps.now(),
      attempts: gate.attempts + 1,
    })
  )
}

/** Starts what may start, waits for it, and settles each node. False when the budget stopped it. */
async function runWave(run: Execution): Promise<boolean> {
  const started = startReady(run.current, run.order.budgets, run.deps.now())
  await run.advance(started.graph)
  const wave = Promise.all(
    started.started
      .map((id) => run.current.nodes.find((n) => n.id === id))
      .filter((n): n is RunNode => n !== undefined && n.kind !== 'gate')
      .map((node) => launchNode(run, node))
  )
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
  for (const launched of waved.results) await settleNode(run, launched)
  return true
}
