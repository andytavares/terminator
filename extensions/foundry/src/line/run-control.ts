import { interruptedRuns, interruptedGate } from './adopt.js'

import { orderStoreAt, gateStoreAt, readGraph } from '../state/live-index.js'
import { runtime, isLiveSession } from '../runtime/runtime-state.js'
import type { RunNode } from './run-graph.js'
import type { OrderStore } from '../order/store.js'
import type { WorkOrder } from '../order/schema.js'
import type { IssuesPort } from '../trackers/write-back.js'
import { writeBack } from '../trackers/write-back.js'
import { writeBackDepsFor } from '../trackers/issues-port.js'

// The orders this process's executor drives. A node is `running` a moment before its
// agent reports a session, looking like one whose agent is gone; reclaiming it would
// put a second agent in the worktree, so nothing reclaims these orders' nodes.
export const executingOrders = new Set<string>()
// Data roots already checked for runs the last application left. Per root, not per
// process: activation precedes the workspace, and the records follow the workspace.
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

// Stop a run and mean it: cancel the order, since "Stop here" once did nothing and
// `order.cancel` refuses a running order. Worktrees and changes are left alone:
// discarding an agent's work is a separate decision, never taken silently.
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

// A run that ended on a ready document before it settled the order left it `running`
// for good: nothing else is coming to finish it.
export async function settleFinishedDocuments(
  store: OrderStore,
  settled: (order: WorkOrder) => Promise<void> = async () => {}
): Promise<void> {
  for (const order of await store.list()) {
    if (order.status !== 'running') continue
    const entries = await store.entries(order.id)
    const lastRunEntry = entries.filter((entry) => entry.action.startsWith('run.')).at(-1)
    if (lastRunEntry?.action !== 'run.document_ready') continue
    const shipped: WorkOrder = { ...order, status: 'shipped' }
    await store.save(shipped)
    await store.record({
      at: new Date().toISOString(),
      orderId: order.id,
      actor: 'rule:run.document_ready',
      action: 'order.settled',
      subject: order.id,
      reason: 'its run ended on a ready document',
      evidence: [],
    })
    await settled(shipped)
  }
}

// What the last application left behind, said the first time this one looks at a
// records location: an agent's terminal dies with its process, while the graph goes
// on saying `running`. Per records location, which follows the workspace.
export async function adoptInterruptedRuns(root: string, issues: IssuesPort): Promise<void> {
  if (adoptedRoots.has(root)) return
  adoptedRoots.add(root)

  const store = orderStoreAt(root)
  await settleFinishedDocuments(store, (order) => toldDocumentReady(root, order, issues))
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

// The ticket hears what a run that finished in this process would have told it.
async function toldDocumentReady(root: string, order: WorkOrder, issues: IssuesPort) {
  if (order.document === null) return
  await writeBack(
    order,
    { event: 'document_ready', document: order.document },
    writeBackDepsFor(root, order, issues)
  )
}
