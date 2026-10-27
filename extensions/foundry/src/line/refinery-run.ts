import type { ExtensionAPI } from '@terminator/extension-sdk'

import { createLiveGateStore, raiseUnlessDecided } from '../gates/store.js'
import { raiseGate } from '../gates/rules.js'
import { readPulls } from './integrate.js'
import { branchFor, reattachCheckout } from './worktree.js'
import { readRefineryState, writeRefineryState } from './refinery-state.js'
import { refineryTick } from './refinery-tick.js'
import type { RefineryTickDeps } from './refinery-tick.js'
import { restack } from './restack.js'
import { writeBack } from '../trackers/write-back.js'
import type { OrderStore } from '../order/store.js'

import type { ActivationContext } from '../ipc/register.js'
import { indexFor, orderStoreAt, queueEntriesOf } from '../state/live-index.js'
import { issuesPortFor, writeBackDepsFor } from '../trackers/issues-port.js'
import { ciRoundAgain } from './ci-round-again.js'
import { isoNow, shellExecOf } from '../host-calls.js'

// The refinery tick: once a minute, watch merged predecessors and restack what queued
// behind them (R4). Nothing runs until something has shipped a pull.
let refineryTimer: NodeJS.Timeout | null = null
/** Ticks running now; stopping waits for them. */
const ticksInFlight = new Set<Promise<void>>()

// One CI watch for an order whose lanes the refinery just rebased, as "another round"
// does, but with the recipe's own round count: a full recheck of a moved change,
// not one more try at a failure the operator saw.
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

// The refinery's own gate: an overlapping order's lanes no longer rebase cleanly
// after a predecessor merged. Never resolved automatically; `restack` refused to guess.
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
  await raiseUnlessDecided(
    createLiveGateStore(() => root, indexFor),
    gate
  )
}

/** Where one refinery pass works: the host, the data root, and its order store. */
interface RefineryPlace {
  readonly api: ExtensionAPI
  readonly root: string
  readonly store: OrderStore
}

// One refinery pass: watch merges, restack what queued behind, recheck it. Built
// fresh each tick so it reads the workspace's current data root.
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
    entries: queueEntriesOf(() => root),
    lanesFor: (orderId) => lanesOf(place, orderId),
    restack: (lane) => restack(lane, shellExecOf(api)),
    watchCi: (orderId) => watchRestackedCi(api, root, orderId),
    raiseConflict: (orderId, why, files) => raiseRefineryConflict(root, { orderId, why, files }),
    record: ({ orderId, action, subject, reason }) =>
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
    now: isoNow,
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
  { api, root, store }: RefineryPlace,
  orderId: string
): Promise<Awaited<ReturnType<RefineryTickDeps['lanesFor']>>> {
  const order = await store.load(orderId)
  if (order === null) return []
  const deps = { exec: shellExecOf(api), root }
  return Promise.all(
    order.context.repos.map(async (repo) => ({
      cwd: (await reattachCheckout(order, repo.lane, deps)).path,
      branch: branchFor(order, repo.lane),
      base: repo.baseBranch,
    }))
  )
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
    const tick = runRefineryTick(api, dataRoot()).finally(() => ticksInFlight.delete(tick))
    ticksInFlight.add(tick)
  }, 60_000)
}

/** Settles when the tick running now, if any, has ended. */
export async function stopRefineryTick(): Promise<void> {
  if (refineryTimer !== null) clearInterval(refineryTimer)
  refineryTimer = null
  await Promise.allSettled([...ticksInFlight])
}
