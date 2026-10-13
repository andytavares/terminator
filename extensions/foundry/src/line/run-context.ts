import type { ExtensionAPI } from '@terminator/extension-sdk'

import { createPassCache } from '../verify/pass-cache.js'
import type { PassCache } from '../verify/pass-cache.js'
import type { OrderStore } from '../order/store.js'
import type { WorkOrder } from '../order/schema.js'
import type { Recipe } from '../recipe/parse.js'
import type { RunCommand } from '../runtime/diff-metrics.js'
import { orderDir } from '../data-root.js'
import { orderStoreAt } from '../state/live-index.js'
import type { ShellExec } from './integrate.js'
import type { RunGraph } from './run-graph.js'
import { ensureCheckouts } from './worktree.js'
import type { Checkout } from './worktree.js'
import { workspaceFor } from './order-project.js'
import { shellExecOf } from '../host-calls.js'

/** One order's run: the order, its recipe, its graph, and where its records live. */
export interface OrderRun {
  readonly root: string
  readonly order: WorkOrder
  readonly recipe: Recipe
  readonly graph: RunGraph
}

/** What every part of the executor's deps shares for one run. */
export interface RunContext {
  readonly api: ExtensionAPI
  readonly root: string
  readonly order: WorkOrder
  readonly exec: ShellExec
  readonly checkouts: ReadonlyMap<number, Checkout>
  readonly store: OrderStore
  readonly featureDir: string
  readonly diffCommand: RunCommand
  readonly passes: PassCache
  // Made the first time a failed rung is run again on the base branch, and
  // taken away by `releaseBase` — most runs never need one.
  readonly base: { current: Checkout | null }
  readonly conversations: Map<string, string>
}

export async function createRunContext(api: ExtensionAPI, run: OrderRun): Promise<RunContext> {
  const { root, order } = run
  const exec = shellExecOf(api)
  // Every checkout before any agent starts: a run that provisions lane 2 half
  // way through and fails has already spent lane 1's agent budget.
  const checkouts = await ensureCheckouts(order, { exec, root })
  return {
    api,
    root,
    order,
    exec,
    checkouts,
    store: orderStoreAt(root),
    featureDir: orderDir(root, order.id),
    diffCommand: allowedDiffCommand(exec),
    passes: createPassCache(async (args, cwd) => {
      const result = await exec({ command: 'git', args, cwd })
      return { exitCode: result.exitCode, stdout: result.stdout }
    }),
    base: { current: null },
    conversations: seededConversations(run.graph),
  }
}

// `diff-metrics` speaks in bare command and args; the core allowlist admits
// `git` and `gh` and nothing else, so anything past those is refused here
// rather than attempted.
function allowedDiffCommand(exec: ShellExec): RunCommand {
  return async (command, args, cwd) => {
    if (command !== 'git' && command !== 'gh') return { ok: false, stdout: '' }
    const result = await exec({ command, args, cwd })
    return { ok: result.exitCode === 0, stdout: result.stdout }
  }
}

/**
 * Lane and role together, because the role is the guard.
 *
 * A node can only ever be offered the conversation its own role has been
 * having. A bare command — a recipe's `run` step, a ladder rung — has no
 * role and gets its own, so eight rungs are still one conversation rather
 * than eight fresh agents each re-reading the repository to run one command,
 * and none of them arrives carrying the builder's identity.
 */
export const conversationKey = (lane: number, role: string | null): string =>
  `${lane}:${role ?? 'command'}`

// One conversation per role, per lane. A fresh agent per node is a terminal
// per node and an agent that has read nothing — the failure `continueRun`
// exists to avoid — but a conversation carried across a change of role
// carries the last role's identity with it, which broke three live runs.
// The executor decides; this only remembers what is open.
//
// Seeded from the graph rather than started empty. A resumed run's agents
// are gone but their transcripts are not — `claude --resume` picks the
// conversation back up — so without this a run picked back up after a
// restart put a cold agent that had read nothing into a worktree half full
// of somebody else's work.
function seededConversations(graph: RunGraph): Map<string, string> {
  const conversations = new Map<string, string>()
  for (const node of graph.nodes) {
    if (node.sessionId === null || node.role === null) continue
    conversations.set(conversationKey(node.lane ?? 1, node.role), node.sessionId)
  }
  return conversations
}

export function baseBranchOf(order: WorkOrder, checkout: Checkout): string {
  const declared = order.context.repos.find((repo) => repo.name === checkout.repo)?.baseBranch
  return declared === undefined || declared === '' ? 'main' : declared
}

export const workspaceOf = (api: ExtensionAPI, checkout: { origin: string }): string =>
  workspaceFor(api.workspace?.list() ?? [], checkout.origin)

export const firstLane = (checkouts: ReadonlyMap<number, Checkout>): number =>
  [...checkouts.keys()].sort((a, b) => a - b)[0] ?? 1
