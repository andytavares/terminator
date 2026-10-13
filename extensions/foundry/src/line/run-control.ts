import { interruptedRuns, interruptedGate } from './adopt.js'

import { orderStoreAt, gateStoreAt, readGraph } from '../state/live-index.js'
import { runtime, isLiveSession } from '../runtime/runtime-state.js'
import type { RunNode } from './run-graph.js'

/**
 * The orders an executor in this process is currently driving.
 *
 * Not decoration: a node is written down as `running` before its agent has
 * reported a session, so for a second or two it is indistinguishable from a
 * node whose agent is gone. Reclaiming it there would put a second agent into
 * the same worktree. While an order is in here, nothing reclaims its nodes.
 */
export const executingOrders = new Set<string>()
/**
 * Data roots already looked at for runs the last application left behind.
 *
 * Once per root rather than once per process: activation runs before there is
 * a workspace, and the records location follows the workspace, so the answer
 * to "what did the last session leave here" is per-root and changes when the
 * operator switches.
 */
export const adoptedRoots = new Set<string>()

/** Stops every node's agent that is still alive, and names the nodes it stopped. */
function stopLiveAgents(nodes: readonly RunNode[], reason: string): string[] {
  const stopped: string[] = []
  for (const node of nodes) {
    if (node.sessionId === null || !isLiveSession(node.sessionId)) continue
    // Told why first, so the agent's own transcript carries the reason rather
    // than ending mid-sentence for no stated cause.
    if (runtime.supervisedRunner?.stop(node.sessionId, reason) === true) {
      runtime.supervision?.finish(node.sessionId, Date.now())
      runtime.supervision?.runs.archive(node.sessionId, 'stopped', Date.now())
      stopped.push(node.id)
    }
  }
  return stopped
}

/**
 * Stop a run, and mean it.
 *
 * Every gate that offers "Stop here" said the order would be cancelled, and
 * nothing did it: the decision seam returned early on `stop`, the order stayed
 * `running` for ever, and `order.cancel` refuses a running order and tells you
 * to stop it at its gate — the gate that did nothing. There was no way out of
 * a run at all.
 *
 * The worktrees and their changes are deliberately left alone. Cancelling the
 * order is a decision about the order; throwing away work an agent already did
 * is a different decision, and nothing here is entitled to take it silently.
 */
export async function stopOrder(root: string, orderId: string, reason: string): Promise<void> {
  const store = orderStoreAt(root)
  const stopped = stopLiveAgents((await readGraph(root, orderId))?.nodes ?? [], reason)
  const order = await store.load(orderId)
  if (order !== null && order.status === 'running') {
    await store.save({ ...order, status: 'cancelled' })
  }
  await store.record({
    at: new Date().toISOString(),
    orderId,
    actor: 'operator',
    action: 'run.stopped',
    subject: orderId,
    reason:
      stopped.length === 0
        ? `${reason}; no agent was still running`
        : `${reason}; stopped ${stopped.join(', ')}`,
    evidence: [],
  })
}

/**
 * What the last application left behind, said out loud the first time this one
 * looks at a records location.
 *
 * An agent's terminal is a child of the process that started it, so a run in
 * flight when the application closed has no agents left — while its order, its
 * graph and every surface go on saying `running`. Nothing looked, so the only
 * way to find out was to come back hours later and notice nothing had moved.
 *
 * Once per records location rather than once per process: activation runs
 * before there is a workspace, and where the records live follows the
 * workspace.
 */
export async function adoptInterruptedRuns(root: string): Promise<void> {
  if (adoptedRoots.has(root)) return
  adoptedRoots.add(root)

  const store = orderStoreAt(root)
  const orders = await store.list()
  const onDisk = await Promise.all(
    orders.map(async (order) => ({ order, graph: await readGraph(root, order.id) }))
  )

  const gates = gateStoreAt(root)
  const at = new Date().toISOString()
  for (const run of interruptedRuns(onDisk, isLiveSession)) {
    // Keyed on the order, so opening the application five times over a run
    // nobody has answered leaves one row rather than five.
    await gates.save(interruptedGate(run, at))
    await store.record({
      at,
      orderId: run.orderId,
      actor: 'rule:run.interrupted',
      action: 'run.interrupted',
      subject: run.orderId,
      reason: `${run.stopped.join(', ')} had no agent left when the application reopened`,
      evidence: [],
    })
  }
}
