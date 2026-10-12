import { noPayload } from '@terminator/extension-sdk'

import { createInboxChannels, DecidePayload } from './inbox-channels.js'
import type { InboxChannels } from './inbox-channels.js'
import { foundryChannel } from './channel.js'
import { createLiveGateStore } from '../gates/store.js'
import { ruleInWords } from '../gates/rules.js'
import { countAttention, ordersWaiting, questionsByOrder } from '../gates/attention.js'
import { createLiveOrderStore } from '../order/store.js'
import { markReady, readPulls, finishShipping } from '../line/integrate.js'
import { ciRounds } from '../line/ship-tail.js'
import { sendBack } from '../line/scheduler.js'
import { resolveRecipe } from '../recipe/resolve.js'
import { finalCheckSendBacks, sendsBackFinalCheck } from '../line/refinery-state.js'
import { createRoleRegistry } from '../line/roles.js'
import { fixMessage } from '../forge/review-loop.js'
import { forgeDefectAnswer } from '../gates/act-decision.js'

import type { Gate } from '../gates/rules.js'
import type { RunChannels } from './run-channels.js'
import { reg } from './register.js'
import type { ActivationContext } from './register.js'
import { resolveSources } from '../workspace-root.js'
import { indexFor, orderStoreAt, gateStoreAt, readGraph, writeGraph } from '../state/live-index.js'
import { autonomyFor } from '../state/settings.js'
import { pendingPermissions } from '../runtime/runtime-state.js'
import {
  integrateDepsFor,
  ciRoundDepsFor,
  ciSendBackFor,
  settleShipNode,
} from '../line/ship-deps.js'
import { stopOrder, adoptInterruptedRuns } from '../line/run-control.js'
import { buildExecutorDeps } from '../line/executor-deps.js'
import { readLiveStandings } from './standing.js'
import type { LiveStandingSources } from './standing.js'
import type { ForgeLoop } from '../forge/forge-loop.js'

/** What answering a gate reaches beyond the host: the run channels and the Forge's loop. */
export interface InboxRegistrationDeps {
  readonly standingSources: LiveStandingSources
  readonly runs: RunChannels
  readonly loop: ForgeLoop
}

/**
 * The inbox — the one surface the operator is required to visit — and the
 * attention count every surface shows. Nothing reaches it that a named rule
 * did not raise, which is what makes "nothing needs you" a state worth
 * trusting rather than a state worth double-checking.
 */
export function registerInboxChannels(
  context: ActivationContext,
  deps: InboxRegistrationDeps
): void {
  const inbox = createInbox(context, deps)
  reg(
    context.api,
    foundryChannel('foundry:inbox.list', noPayload, async () => {
      // Before the list is composed, not after: a run the last application left
      // in flight has to be on it the first time it is read, not the second.
      await adoptInterruptedRuns(context.dataRoot())
      return inbox.list()
    }),
    foundryChannel('foundry:inbox.decide', DecidePayload, inbox.decide)
  )
  registerAttention(context, deps.standingSources)
}

function createInbox(context: ActivationContext, deps: InboxRegistrationDeps): InboxChannels {
  const { api, dataRoot } = context
  return createInboxChannels({
    gates: createLiveGateStore(dataRoot, indexFor),
    orders: createLiveOrderStore(dataRoot, indexFor),
    waiting: async () => {
      const { orders, waiting } = await readLiveStandings(dataRoot, deps.standingSources)
      return ordersWaiting(waiting, questionsByOrder(orders)).map(({ orderId, standing }) => ({
        orderId,
        title: orders.find((order) => order.id === orderId)?.title ?? orderId,
        headline: standing.headline,
        detail: standing.detail,
      }))
    },
    autonomy: () => autonomyFor(api),
    readPulls: (orderId) => readPulls(dataRoot(), orderId),
    now: () => new Date().toISOString(),
    record: async (orderId, action, subject, reason) => {
      await orderStoreAt(dataRoot()).record({
        at: new Date().toISOString(),
        orderId,
        actor: 'operator',
        action,
        subject,
        reason,
        evidence: [],
      })
    },
    act: (gate, option) => actOnDecision(context, deps, { gate, option }),
  })
}

interface Decision {
  readonly gate: Gate
  readonly option: string
}

// What a decision actually does.
//
// Two things, and the second is the one that was missing: "mark ready"
// turns the drafts into review requests, and every other answer that
// unblocks work puts the run back on. A decision the operator takes that
// leaves the run stopped is a decision that did nothing.
async function actOnDecision(
  context: ActivationContext,
  deps: InboxRegistrationDeps,
  { gate, option }: Decision
): Promise<void> {
  const { dataRoot } = context
  if (gate.rule === 'ready-for-review') {
    if (option === 'mark_ready') await markPullsReady(context, gate)
    return
  }

  // A `ci.red` gate is not the run stopping — the run already finished
  // and shipped a draft. "Another round" is one more watch-fail-rework
  // cycle against the drafts that already exist, not a resume of a graph
  // that has nothing left waiting on it.
  if (gate.rule === 'ci.red') {
    if (option === 'send_back') await anotherCiRound(context, gate.orderId)
    return
  }

  // `stop` now stops. Every gate offering it promised the order would be
  // cancelled and nothing did it — the run stayed `running` for ever, and
  // `order.cancel` refuses a running order and points back at this gate.
  if (option === 'stop') {
    await stopOrder(
      dataRoot(),
      gate.orderId,
      `stopped at the decision about ${ruleInWords(gate.rule)}`
    )
    return
  }

  // `hold` means what it says: the run stays stopped until the operator
  // comes back to it. Everything else is a decision to carry on.
  if (option === 'hold') return

  if (gate.rule === 'forge-defect' && option === 'answer') {
    if (await answerForgeDefect(dataRoot, deps.loop, gate)) return
  }

  if (sendsBackFinalCheck(gate, option)) await sendBackFinalCheck(context, gate)

  const resumed = (await deps.runs.resume({
    id: gate.orderId,
    // "Send back" is a retry of the node that failed; the others resume
    // whatever the wave was doing.
    retry: option === 'send_back' && gate.nodeId !== null ? [gate.nodeId] : [],
  })) as { error?: string }
  if (resumed.error !== undefined) throw new Error(resumed.error)
}

async function markPullsReady({ api, dataRoot }: ActivationContext, gate: Gate): Promise<void> {
  const deps = integrateDepsFor(api, dataRoot(), gate.orderId)
  for (const pull of await readPulls(dataRoot(), gate.orderId)) {
    await markReady(pull, deps)
  }
}

async function anotherCiRound(
  { api, dataRoot }: ActivationContext,
  orderId: string
): Promise<void> {
  const root = dataRoot()
  const order = await orderStoreAt(root).load(orderId)
  if (order === null || order.recipe === null) return
  const resolved = resolveRecipe(order.recipe, resolveSources(api, root))
  if (!resolved.ok) return
  const recipe = resolved.resolved.value
  const graph = await readGraph(root, orderId)
  if (graph === null) return
  const pulls = await readPulls(root, orderId)
  const { deps: executorDeps, exec } = await buildExecutorDeps(api, { root, order, recipe, graph })
  const integrateDeps = integrateDepsFor(api, root, order.id)
  const graphRef = { current: graph }
  const outcome = await ciRounds({
    pulls: pulls.map((pull) => ({ url: pull.url, cwd: pull.cwd })),
    rounds: 1,
    ...ciRoundDepsFor(root, order.id, exec),
    sendBack: ciSendBackFor(root, order, recipe, executorDeps, integrateDeps, graphRef),
  })
  const gates = createLiveGateStore(dataRoot, indexFor)
  const finished = await finishShipping(
    order,
    { verdicts: [], findings: [] },
    pulls,
    pulls.map((pull) => pull.bodyPath),
    outcome,
    {
      ...integrateDeps,
      raiseGate: async (g) => {
        await gates.save(g)
      },
    }
  )
  await settleShipNode(root, recipe, graphRef, finished.gate?.rule === 'ready-for-review')
}

/**
 * "Answer" on `forge-defect` used to call `resume` no matter what — but
 * the finding that raised it already sent the order back to `draft`,
 * and `resume` refuses anything that is not `running`. Read the order
 * first: a drafted order gets the architect, in one turn, on every open
 * blocking finding; a still-running order resumes as it always did.
 *
 * True when the architect was asked, so there is nothing to resume.
 */
async function answerForgeDefect(
  dataRoot: () => string,
  loop: ForgeLoop,
  gate: Gate
): Promise<boolean> {
  const order = await orderStoreAt(dataRoot()).load(gate.orderId)
  const decision = forgeDefectAnswer({
    order,
    fixMessage: order === null ? null : fixMessage(order),
    gateRule: gate.rule,
  })
  if (decision.kind !== 'converge' || order === null) return false
  // Recorded, or the ledger shows no turn running while the architect
  // amends the order and every surface reads it as idle.
  const started = await loop.convergeWithFollowUps(order, decision.message, 0, 1)
  await orderStoreAt(dataRoot()).record({
    at: new Date().toISOString(),
    orderId: order.id,
    actor: 'role:architect',
    action: started.ok ? 'converge.started' : 'converge.refused',
    subject: started.ok ? started.sessionId : order.id,
    reason: started.ok ? `answering ${ruleInWords(gate.rule)}` : started.reason,
    evidence: [],
  })
  return true
}

// The final check fails after every node has passed, so there is no node
// to retry: "Send back" gives the failure to the nodes that wrote the
// work and reruns everything after them. Retrying nothing only re-ran the
// same failing check.
async function sendBackFinalCheck({ api, dataRoot }: ActivationContext, gate: Gate): Promise<void> {
  const root = dataRoot()
  const graph = await readGraph(root, gate.orderId)
  if (graph === null) return
  const roles = createRoleRegistry(resolveSources(api, root))
  const writers = graph.nodes
    .filter((n) => n.role !== null && roles.mayWrite(n.role))
    .map((n) => n.id)
  const output = gate.evidence.find((e) => e.kind === 'stdout')
  await writeGraph(
    root,
    sendBack(graph, writers, {
      from: 'final check',
      // Counts this decision too: it is saved before it is acted on.
      attempt: finalCheckSendBacks(
        (await gateStoreAt(root).list()).filter((g) => g.orderId === gate.orderId)
      ),
      source: 'check',
      command: null,
      exitCode: output?.exitCode ?? null,
      excerpt: [gate.why, output?.excerpt ?? ''].filter(Boolean).join('\n\n'),
      logPath: output?.path ?? null,
    })
  )
}

// How much is waiting for the operator, and where.
//
// Read by the surfaces themselves so the answer to "is anything waiting" is
// on screen wherever you are. Foundry holds work in three places and used to
// announce it on none of them: an open question sat third down the Forge's
// rail and a held tool call sat under a whole run graph, so the only way to
// find either was to already be looking at it.
function registerAttention(
  { api, dataRoot }: ActivationContext,
  standingSources: LiveStandingSources
): void {
  const attentionGates = createLiveGateStore(dataRoot, indexFor)
  reg(
    api,
    foundryChannel('foundry:attention', noPayload, async () => {
      // The chrome polls this from the moment the application opens, which makes
      // it the earliest place a run the last one left behind can be noticed. A
      // dead run that announces itself in four seconds is the whole difference
      // between this and finding out hours later that nothing had moved.
      await adoptInterruptedRuns(dataRoot())
      const { orders, waiting } = await readLiveStandings(dataRoot, standingSources)
      return countAttention({
        gates: await attentionGates.list(),
        autonomy: autonomyFor(api),
        orders,
        pendingAsks: pendingPermissions.list().length,
        waiting,
      })
    })
  )
}
