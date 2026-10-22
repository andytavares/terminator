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
  // Lanes whose prepare command failed or did not run: their checks are not measured.
  readonly prepareFailed: Set<number>
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
    prepareFailed: new Set(),
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

// Lane and role together, the role being the guard: a node is offered only its own
// role's conversation. A bare command has no role and shares one, so eight rungs are
// one conversation, none carrying the builder's identity.
export const conversationKey = (lane: number, role: string | null): string =>
  `${lane}:${role ?? 'command'}`

// The open conversation per role per lane (the executor decides which to resume),
// seeded from the graph: `claude --resume` outlives a restart, and a resumed run
// otherwise puts a cold agent into a worktree half full of someone else's work.
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
