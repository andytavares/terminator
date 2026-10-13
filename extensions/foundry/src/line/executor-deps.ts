import type { ExtensionAPI } from '@terminator/extension-sdk'

import { rulesFor } from '../verify/rules.js'
import { createLiveGateStore } from '../gates/store.js'
import type { GateStore } from '../gates/store.js'
import type { Gate } from '../gates/rules.js'
import type { OrderStore } from '../order/store.js'
import type { ShellExec } from './integrate.js'
import { writeObservedFiles } from './observed-files.js'
import { readChangedFiles, readDiffSummary } from '../runtime/diff-metrics.js'
import { isLockfile } from '../runtime/review/risk-grader.js'
import { createRoleRegistry } from './roles.js'
import type { ExecutorDeps, ExecutorEvent, RungCollection } from './executor.js'
import type { RunGraph } from './run-graph.js'
import { commitWorktree, committedSince } from './commit.js'
import type { CommitOutcome } from './commit.js'
import { collectableWrites, readRungOutput } from './rung-output.js'
import { resolveSources } from '../workspace-root.js'
import { indexFor, writeGraph } from '../state/live-index.js'
import { autonomyFor } from '../state/settings.js'
import { endLiveSession } from '../runtime/runtime-state.js'
import { baseBranchOf, conversationKey, createRunContext } from './run-context.js'
import type { OrderRun, RunContext } from './run-context.js'
import { runNode } from './node-session.js'
import {
  reinstall,
  releaseBase,
  runRecipeCommand,
  runStep,
  runStepOnBase,
} from './lane-commands.js'
import { isoNow } from '../host-calls.js'

export type { OrderRun } from './run-context.js'

type HouseRules = ReturnType<typeof rulesFor>['rules']
type RoleRegistry = ReturnType<typeof createRoleRegistry>

/** What the deps are built from, besides the run itself. */
interface DepsParts {
  readonly sources: ReturnType<typeof resolveSources>
  readonly roleRegistry: RoleRegistry
  readonly houseRules: HouseRules
  readonly gates: GateStore
  readonly startedAt: number
}

/**
 * Actually run a graph.
 *
 * The seam `run.start` hands the graph to, and the one place the Line's pieces
 * meet the application: worktrees from `line/worktree.ts`, sessions from the
 * supervised runner, and the wave loop from `line/executor.ts`.
 *
 * Everything the executor enforces is enforced structurally rather than asked
 * for in a prompt — a role that may not resume is never handed a session, and
 * a role with no write list is run read-only, refused by the `PreToolUse` hook
 * rather than by a reminder in its own instructions.
 */
export async function buildExecutorDeps(
  api: ExtensionAPI,
  run: OrderRun
): Promise<{
  deps: ExecutorDeps
  exec: ShellExec
  store: OrderStore
  houseRules: HouseRules
}> {
  const startedAt = Date.now()
  const context = await createRunContext(api, run)
  const sources = resolveSources(api, run.root)
  // Read once, so what a rung is told it may hand back and what is accepted
  // from it come from the same resolution of the same role file.
  const roleRegistry = createRoleRegistry(sources)
  const houseRules = rulesFor(sources, {
    repoPaths: sources.repoPaths,
    houseDocs: [...run.order.context.houseDocs],
  }).rules
  const gates = createLiveGateStore(() => run.root, indexFor)
  const parts = { sources, roleRegistry, houseRules, gates, startedAt }
  return {
    deps: await executorDepsFor(context, parts, run.graph),
    exec: context.exec,
    store: context.store,
    houseRules,
  }
}

async function executorDepsFor(
  context: RunContext,
  parts: DepsParts,
  graph: RunGraph
): Promise<ExecutorDeps> {
  return {
    now: isoNow,
    sources: parts.sources,
    run: (input) => runNode(context, input),
    sessionFor: (lane, role) => context.conversations.get(conversationKey(lane, role)),
    record: (action, subject, reason) => recordLineEntry(context, { action, subject, reason }),
    autonomy: autonomyFor(context.api),
    // Loaded once, so what an agent is told the house rules are and what the
    // change is judged against are the same list.
    rules: parts.houseRules,
    collect: (input) => collectRungOutput(context, parts.roleRegistry, input),
    commitNode: (input) => commitNode(context, input),
    priorGates: await parts.gates.list(),
    raise: (gate) => raiseGate(context, parts.gates, gate),
    runStep: (step, logPath) => runStep(context, step, logPath),
    runStepOnBase: (step, logPath) => runStepOnBase(context, step, logPath),
    reinstall: (where, logPath) => reinstall(context, where, logPath),
    releaseBase: () => releaseBase(context),
    runCommand: (input) => runRecipeCommand(context, input),
    endSession,
    observe: async () => ({ elapsedMinutes: minutesSince(parts.startedAt) }),
    onEvent: (event) => recordVerdict(context, event),
    persist: graphPersister(context, graph),
    // What the work actually changed, so the regrade answers for the change
    // rather than for the plan that predicted it. Without this the executor
    // was handed the units' own `touches` list and a hardcoded zero lines, so
    // a builder that went outside what it declared was invisible to the check
    // that exists to notice, and nothing could ever grade worse than planned.
    observedChange: () => readObservedChange(context),
    // Lets the budget be re-read while agents are in flight. Without it the
    // wall-clock budget can only fire between waves, which is every case
    // except the one it exists for: an agent that never comes back.
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }
}

// Fractional on purpose. Rounded, a run at 19:31 reported "20" and a
// twenty-minute budget could only be exceeded at 20:30 — so a run whose
// deadline was the budget never saw the gate at all. The gate rounds it
// for the sentence it prints; the comparison is exact.
const minutesSince = (startedAt: number): number => (Date.now() - startedAt) / 60_000

async function recordLineEntry(
  context: RunContext,
  entry: { action: string; subject: string; reason: string }
): Promise<void> {
  await context.store.record({
    at: new Date().toISOString(),
    orderId: context.order.id,
    actor: 'rule:line',
    action: entry.action,
    subject: entry.subject,
    reason: entry.reason,
    evidence: [],
  })
}

/**
 * Take what a read-only rung wrote, put it on the order, and save it.
 *
 * The Forge has always had this and the Line never did: four of the
 * standard shape's nine steps are roles whose whole product is a document,
 * and every one of them ended its turn with the document in a terminal
 * nobody reads. Watched on a live run — a scout's complete report of where
 * the application picks its colours, gone; an architect's three defects in
 * the order it was about to be built from, gone, refused on the way out by
 * the very policy that makes the rung trustworthy.
 */
async function collectRungOutput(
  context: RunContext,
  roleRegistry: RoleRegistry,
  { nodeId, role, outputPath }: Parameters<ExecutorDeps['collect']>[0]
): Promise<RungCollection | null> {
  const { store, order } = context
  const current = (await store.load(order.id)) ?? order
  const result = readRungOutput({
    order: current,
    role,
    writes: collectableWrites(roleRegistry.get(role)),
    outputPath,
    at: new Date().toISOString(),
  })
  if (result === null) return null

  // A refusal is a result too, and it is the agent's to act on rather than
  // the operator's to decipher — so it is recorded and the rung is not
  // credited with having filed anything.
  if (!result.ok) {
    await recordRungRefused(context, { role, nodeId, reason: result.reason })
    return null
  }

  await store.save(result.order)
  const { note, defect, document } = result
  return { order: result.order, note, defect, document }
}

async function recordRungRefused(
  context: RunContext,
  refusal: { role: string; nodeId: string; reason: string }
): Promise<void> {
  await context.store.record({
    at: new Date().toISOString(),
    orderId: context.order.id,
    actor: `role:${refusal.role}`,
    action: 'rung.refused',
    subject: refusal.nodeId,
    reason: refusal.reason,
    evidence: [],
  })
}

// An agent that only edited leaves nothing to push, and a pull request
// opened on it fails with "No commits between". One that committed its
// own work leaves a clean tree, which is a change all the same.
async function commitNode(
  context: RunContext,
  { node, message }: Parameters<ExecutorDeps['commitNode']>[0]
): Promise<CommitOutcome> {
  const checkout = context.checkouts.get(node.lane ?? 1)
  if (checkout === undefined) return { kind: 'clean' }
  const outcome = await commitWorktree(checkout.path, message, context.exec)
  if (outcome.kind !== 'clean') return outcome
  return node.startedAt !== null &&
    (await committedSince(checkout.path, node.startedAt, context.exec))
    ? { kind: 'committed' }
    : outcome
}

async function raiseGate(context: RunContext, gates: GateStore, gate: Gate): Promise<void> {
  await gates.save(gate)
  await context.store.record({
    at: new Date().toISOString(),
    orderId: context.order.id,
    actor: `rule:${gate.rule}`,
    action: 'gate.raised',
    subject: gate.id,
    reason: gate.why,
    evidence: [...gate.evidence],
  })
}

// The previous process of this conversation may still be sitting at its
// prompt when a node resumes it. Two processes must not share one
// conversation — the same reason `endAndWait` exists for a follow-up turn.
function endSession(sessionId: string): Promise<void> {
  return endLiveSession(sessionId, 'continuing the lane in its next step')
}

function recordVerdict(context: RunContext, event: ExecutorEvent): void {
  if (event.type !== 'verdict') return
  const { verdict } = event
  void context.store.record({
    at: new Date().toISOString(),
    orderId: context.order.id,
    actor: `role:${verdict.producedBy.role}`,
    action: 'verify.verdict',
    subject: verdict.criterionId,
    reason: `${verdict.result}${verdict.reason === '' ? '' : `: ${verdict.reason}`}`,
    evidence: [...verdict.evidence],
  })
}

const settledIn = (g: RunGraph): number =>
  g.nodes.filter((n) => n.state !== 'waiting' && n.state !== 'running').length

// Written on every change rather than only at the end. `run.observe` reads
// this file, so without it the Floor shows the graph the run started with
// for the whole of the run.
function graphPersister(context: RunContext, graph: RunGraph): ExecutorDeps['persist'] {
  let settledSeen = settledIn(graph)
  return async (next) => {
    await writeGraph(context.root, next)
    if (settledIn(next) === settledSeen) return
    settledSeen = settledIn(next)
    // A record the queue reads is not worth failing the run over.
    await recordObservedFiles(context).catch(() => undefined)
  }
}

/**
 * Written down when a step settles, so reading the refinery's queue never
 * has to ask git what a checkout has changed. Git reporting nothing means
 * it could not be read, so an empty answer keeps what was recorded before.
 */
async function recordObservedFiles(context: RunContext): Promise<void> {
  const { root, order } = context
  const files: string[] = []
  for (const checkout of context.checkouts.values()) {
    const base = baseBranchOf(order, checkout)
    files.push(...(await readChangedFiles(checkout.path, base, context.diffCommand)))
  }
  if (files.length === 0) return
  await writeObservedFiles(root, order.id, files)
  indexFor(root).announce({ kind: 'graph', orderId: order.id })
}

/** What the working copies have actually changed, against their base. */
async function readObservedChange(
  context: RunContext
): Promise<{ changedFiles: string[]; linesChanged: number }> {
  const changedFiles: string[] = []
  let linesChanged = 0
  for (const checkout of context.checkouts.values()) {
    const against = baseBranchOf(context.order, checkout)
    changedFiles.push(...(await readChangedFiles(checkout.path, against, context.diffCommand)))
    // A lockfile's lines would turn every new dependency into a "large change".
    const summary = await readDiffSummary(checkout.path, against, {
      run: context.diffCommand,
      weighLines: (file) => !isLockfile(file),
    })
    linesChanged += summary.added + summary.removed
  }
  return { changedFiles, linesChanged }
}
