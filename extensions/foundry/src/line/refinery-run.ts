import type { ExtensionAPI } from '@terminator/extension-sdk'

import { createLiveGateStore } from '../gates/store.js'
import { raiseGate } from '../gates/rules.js'
import { readPulls } from './integrate.js'
import { branchFor, checkoutPath } from './worktree.js'
import { computeQueueEntries } from './refinery-entries.js'
import { readRefineryState, writeRefineryState } from './refinery-state.js'
import { refineryTick } from './refinery-tick.js'
import type { RefineryTickDeps } from './refinery-tick.js'
import { restack } from './restack.js'
import { writeBack } from '../trackers/write-back.js'
import type { OrderStore } from '../order/store.js'

import type { ActivationContext } from '../ipc/register.js'
import { indexFor, orderStoreAt } from '../state/live-index.js'
import { issuesPortFor, writeBackDepsFor } from '../trackers/issues-port.js'
import { ciRoundAgain } from './ci-round-again.js'

/**
 * The refinery tick: once a minute, watch merged predecessors and restack
 * whatever queued behind them (R4). Nothing runs when nothing has shipped a
 * pull yet — `computeQueueEntries`'s candidates are empty.
 */
let refineryTimer: NodeJS.Timeout | null = null

/**
 * One CI watch for an order whose lanes the refinery just rebased.
 *
 * The same shape as the `ci.red` gate's "another round" — `ciRounds` against
 * the drafts that already exist, then `finishShipping` so the order gets its
 * ready gate again, or `ci.red` if the rebase broke something. The recipe's
 * own round count, not the fixed `1` the inbox path uses: this is a full
 * re-check of a change nothing has looked at since it moved, not one more
 * attempt at a failure the operator already saw.
 */
async function watchRestackedCi(api: ExtensionAPI, root: string, orderId: string): Promise<void> {
  // A rebased order with no drafts has nothing to watch.
  if ((await readPulls(root, orderId)).length === 0) return
  await ciRoundAgain({
    api,
    root,
    orderId,
    rounds: 'recipe',
    gates: createLiveGateStore(() => root, indexFor),
  })
}

/**
 * The refinery's own gate: an overlapping order's lanes no longer rebase
 * cleanly onto their base after a predecessor merged. Never resolved
 * automatically — `restack` already refused to guess, and this just says so
 * where the operator will see it.
 */
async function raiseRefineryConflict(
  root: string,
  { orderId, why, files }: { orderId: string; why: string; files: readonly string[] }
): Promise<void> {
  const gate = raiseGate({
    id: `${orderId}-refinery-conflict`,
    rule: 'refinery.conflict',
    orderId,
    summary: `${orderId} no longer rebases cleanly`,
    why,
    evidence: files.map((file) => ({ kind: 'diff' as const, path: file })),
    at: new Date().toISOString(),
  })
  await createLiveGateStore(() => root, indexFor).save(gate)
}

/** Where one refinery pass works: the host, the data root, and its order store. */
interface RefineryPlace {
  readonly api: ExtensionAPI
  readonly root: string
  readonly store: OrderStore
}

/**
 * One pass of the refinery: watch for merges, restack what queued behind,
 * recheck it. Built fresh on every tick so it always reads the workspace's
 * current data root, the same reason every other tick function does.
 */
async function runRefineryTick(api: ExtensionAPI, root: string): Promise<void> {
  await refineryTick(refineryDepsFor({ api, root, store: orderStoreAt(root) }))
}

function refineryDepsFor(place: RefineryPlace): RefineryTickDeps {
  const { api, root, store } = place
  return {
    candidates: () => inFlightCandidates(place),
    readState: (orderId) => readRefineryState(root, orderId),
    writeState: async (orderId, state) => {
      await writeRefineryState(root, orderId, state)
      indexFor(root).announce({ kind: 'graph', orderId })
    },
    viewPr: (url) => viewPullRequest(place, url),
    entries: () => computeQueueEntries(root, orderStoreAt(root)),
    lanesFor: (orderId) => lanesOf(place, orderId),
    restack: (lane) => restack(lane, (options) => api.shell.exec(options)),
    watchCi: (orderId) => watchRestackedCi(api, root, orderId),
    raiseConflict: (orderId, why, files) => raiseRefineryConflict(root, { orderId, why, files }),
    record: (orderId, action, subject, reason) =>
      store.record({
        at: new Date().toISOString(),
        orderId,
        actor: 'rule:refinery',
        action,
        subject,
        reason,
        evidence: [],
      }),
    titleOf: async (orderId) => (await store.load(orderId))?.title ?? orderId,
    onMerged: (orderId) => moveIssueToDone(place, orderId),
    now: () => new Date().toISOString(),
  }
}

async function inFlightCandidates({
  root,
  store,
}: RefineryPlace): Promise<Awaited<ReturnType<RefineryTickDeps['candidates']>>> {
  const orders = await store.list()
  const inFlight = orders.filter((o) => o.status === 'running' || o.status === 'shipped')
  return Promise.all(
    inFlight.map(async (order) => ({
      order: { id: order.id, title: order.title },
      pulls: (await readPulls(root, order.id)).map((pull) => ({ url: pull.url })),
    }))
  )
}

async function viewPullRequest(
  { api, root }: RefineryPlace,
  url: string
): Promise<{ merged: boolean }> {
  const result = await api.shell.exec({
    command: 'gh',
    args: ['pr', 'view', url, '--json', 'state,mergedAt,baseRefName'],
    cwd: root,
    timeoutMs: 30_000,
  })
  if (result.exitCode !== 0) return { merged: false }
  try {
    const parsed = JSON.parse(result.stdout) as { state?: unknown }
    return { merged: parsed.state === 'MERGED' }
  } catch {
    return { merged: false }
  }
}

async function lanesOf(
  { root, store }: RefineryPlace,
  orderId: string
): Promise<Awaited<ReturnType<RefineryTickDeps['lanesFor']>>> {
  const order = await store.load(orderId)
  if (order === null) return []
  return order.context.repos.map((repo) => ({
    cwd: checkoutPath(root, order, repo.name),
    branch: branchFor(order, repo.lane),
    base: repo.baseBranch,
  }))
}

// The issue's last move: Done only once the pull requests are merged.
async function moveIssueToDone(
  { api, root, store }: RefineryPlace,
  orderId: string
): Promise<void> {
  const order = await store.load(orderId)
  if (order !== null) {
    await writeBack(order, { event: 'merged' }, writeBackDepsFor(root, order, issuesPortFor(api)))
  }
}

/** R4: watch for merges, restack what queued behind, recheck it. */
export function startRefineryTick({ api, dataRoot }: ActivationContext): void {
  refineryTimer = setInterval(() => {
    void runRefineryTick(api, dataRoot())
  }, 60_000)
}

export function stopRefineryTick(): void {
  if (refineryTimer !== null) clearInterval(refineryTimer)
  refineryTimer = null
}
