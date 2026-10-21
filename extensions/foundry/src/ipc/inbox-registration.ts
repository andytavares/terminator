import { issuesPortFor } from '../trackers/issues-port.js'
import { noPayload } from '@terminator/extension-sdk'

import { orderDir } from '../data-root.js'
import { createInboxChannels, DecidePayload } from './inbox-channels.js'
import type { InboxChannels } from './inbox-channels.js'
import { foundryChannel } from './channel.js'
import { createLiveGateStore } from '../gates/store.js'
import { ruleInWords } from '../gates/rules.js'
import { countAttention, ordersWaiting, questionsByOrder } from '../gates/attention.js'
import { createLiveOrderStore } from '../order/store.js'
import { markReady, readPulls } from '../line/integrate.js'
import { sendBack } from '../line/scheduler.js'
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
import { integrateDepsFor } from '../line/ship-deps.js'
import { stopOrder, adoptInterruptedRuns } from '../line/run-control.js'
import { ciRoundAgain } from '../line/ci-round-again.js'
import { readLiveStandings } from './standing.js'
import type { LiveStandingSources } from './standing.js'
import type { ForgeLoop } from '../forge/forge-loop.js'
import { isoNow } from '../host-calls.js'

/** What answering a gate reaches beyond the host: the run channels and the Forge's loop. */
export interface InboxRegistrationDeps {
  readonly standingSources: LiveStandingSources
  readonly runs: RunChannels
  readonly loop: ForgeLoop
}

// The inbox, the one surface the operator must visit, and the attention count every
// surface shows. Only a named rule raises anything, so "nothing needs you" is trusted.
export function registerInboxChannels(
  context: ActivationContext,
  deps: InboxRegistrationDeps
): InboxChannels {
  const inbox = createInbox(context, deps)
  reg(
    context.api,
    foundryChannel('foundry:inbox.list', noPayload, async () => {
      // Before the list is composed, not after: a run the last application left
      // in flight has to be on it the first time it is read, not the second.
      await adoptInterruptedRuns(context.dataRoot(), issuesPortFor(context.api))
      return inbox.list()
    }),
    foundryChannel('foundry:inbox.decide', DecidePayload, inbox.decide)
  )
  registerAttention(context, deps.standingSources)
  return inbox
}

function createInbox(context: ActivationContext, deps: InboxRegistrationDeps): InboxChannels {
  const { api, dataRoot } = context
  return createInboxChannels({
    gates: createLiveGateStore(dataRoot, indexFor),
    orders: createLiveOrderStore(dataRoot, indexFor),
    waiting: () => ordersWaitingOnSomething(dataRoot, deps.standingSources),
    autonomy: () => autonomyFor(api),
    readPulls: (orderId) => readPulls(dataRoot(), orderId),
    orderDirectory: (orderId) => orderDir(dataRoot(), orderId),
    now: isoNow,
    record: async (orderId, line) => {
      await orderStoreAt(dataRoot()).record({
        at: new Date().toISOString(),
        orderId,
        actor: 'operator',
        ...line,
        evidence: [],
      })
    },
    act: (gate, option) => actOnDecision(context, deps, { gate, option }),
  })
}

async function ordersWaitingOnSomething(
  dataRoot: () => string,
  standingSources: LiveStandingSources
): Promise<Awaited<ReturnType<Parameters<typeof createInboxChannels>[0]['waiting']>>> {
  const { orders, waiting } = await readLiveStandings(dataRoot, standingSources)
  return ordersWaiting(waiting, questionsByOrder(orders)).map(({ orderId, standing }) => ({
    orderId,
    title: orders.find((order) => order.id === orderId)?.title ?? orderId,
    headline: standing.headline,
    detail: standing.detail,
  }))
}

interface Decision {
  readonly gate: Gate
  readonly option: string
}

// What a decision does: "mark ready" turns the drafts into review requests, and any
// other unblocking answer puts the run back on. One that leaves it stopped did nothing.
async function actOnDecision(
  context: ActivationContext,
  deps: InboxRegistrationDeps,
  decision: Decision
): Promise<void> {
  const { gate, option } = decision
  if (gate.rule === 'ready-for-review') {
    if (option === 'mark_ready') await markPullsReady(context, gate)
    return
  }

  // A `ci.red` gate comes after the run shipped its draft: "another round" is one more
  // watch-fail-rework cycle on the existing drafts, not a resume.
  if (gate.rule === 'ci.red') {
    if (option === 'send_back') await anotherCiRound(context, gate.orderId)
    return
  }
  await stopOrCarryOn(context, deps, decision)
}

async function stopOrCarryOn(
  context: ActivationContext,
  deps: InboxRegistrationDeps,
  { gate, option }: Decision
): Promise<void> {
  const { dataRoot } = context
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
  await resumeRun(deps.runs, { gate, option })
}

async function resumeRun(runs: RunChannels, { gate, option }: Decision): Promise<void> {
  const resumed = (await runs.resume({
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
  await ciRoundAgain({
    api,
    root: dataRoot(),
    orderId,
    rounds: 1,
    gates: createLiveGateStore(dataRoot, indexFor),
  })
}

// "Answer" on `forge-defect`: the finding already sent the order back to `draft`,
// which `resume` refuses, so a draft gets the architect on every open blocking
// finding in one turn. True when it was asked; a running order resumes as before.
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
  await loop.convergeWithFollowUps({
    order,
    message: decision.message,
    autoTurns: 0,
    loopRound: 1,
    recordStart: (started) =>
      orderStoreAt(dataRoot()).record({
        at: new Date().toISOString(),
        orderId: order.id,
        actor: 'role:architect',
        action: started.ok ? 'converge.started' : 'converge.refused',
        subject: started.ok ? started.sessionId : order.id,
        reason: started.ok ? `answering ${ruleInWords(gate.rule)}` : started.reason,
        evidence: [],
      }),
  })
  return true
}

// The final check fails after every node passed, so there is none to retry: "Send
// back" gives the failure to the nodes that wrote the work and reruns what follows.
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

// How much is waiting for the operator, and where, read by every surface so "is
// anything waiting" is on screen wherever you are, not only where the work sits.
function registerAttention(
  { api, dataRoot }: ActivationContext,
  standingSources: LiveStandingSources
): void {
  const attentionGates = createLiveGateStore(dataRoot, indexFor)
  reg(
    api,
    foundryChannel('foundry:attention', noPayload, async () => {
      // The chrome polls this from launch, the earliest place to notice a run the last
      // process left behind: seconds after opening rather than hours later.
      await adoptInterruptedRuns(dataRoot(), issuesPortFor(api))
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
