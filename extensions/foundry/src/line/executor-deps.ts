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
import { runNodeSession } from './node-session.js'
import {
  reinstallDependencies,
  releaseBaseCheckout,
  runRecipeCommand,
  runLaneStep,
  runStepOnBaseCheckout,
} from './lane-commands.js'
import { isoNow } from '../host-calls.js'
import { isAbsolute } from 'path'
import { readPublishedArtifacts } from '../runtime/artifact-publishes.js'
import type { PublishedArtifact } from '../runtime/artifact-publishes.js'
import { transcriptPathFor } from '../runtime/claude-launch.js'
import type { DocumentHandBack } from '../order/schema.js'

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

// Runs a graph: the seam `run.start` hands it to, where worktrees, supervised sessions
// and the wave loop meet. Rules are structural, not prompted: a role that may not
// resume gets no session, and one with no write list is refused by the hook.
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
    run: (input) => runNodeSession(context, input),
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
    runStep: (step, logPath) => runLaneStep(context, step, logPath),
    runStepOnBase: (step, logPath) => runStepOnBaseCheckout(context, step, logPath),
    reinstall: (where, logPath) => reinstallDependencies(context, where, logPath),
    releaseBase: () => releaseBaseCheckout(context),
    runCommand: (input) => runRecipeCommand(context, input),
    endSession: endPreviousProcess,
    observe: async () => ({ elapsedMinutes: minutesSince(parts.startedAt) }),
    onEvent: (event) => recordVerdict(context, event),
    persist: graphPersister(context, graph),
    // What the work changed, so the regrade answers for the change and not the plan:
    // a builder going outside its declared `touches` must be visible to the check.
    observedChange: () => readObservedChange(context),
    // Lets the budget be re-read while agents are in flight. Without it the
    // wall-clock budget can only fire between waves, which is every case
    // except the one it exists for: an agent that never comes back.
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }
}

// Fractional on purpose: rounded, a twenty-minute budget could only be exceeded at
// minute 21. The gate rounds for its sentence; the comparison is exact.
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

// Take what a read-only rung wrote, put it on the order and save it, as the Forge
// does: a scout's report or an architect's defects otherwise end in a terminal
// nobody reads.
async function collectRungOutput(
  context: RunContext,
  roleRegistry: RoleRegistry,
  { nodeId, role, outputPath, sessionId, lane }: Parameters<ExecutorDeps['collect']>[0]
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

  const { note, defect, document } = result
  if (!(await confirmPublished(context, { nodeId, sessionId, lane, document }))) {
    await recordRungRefused(context, { role, nodeId, reason: UNPUBLISHED_REFUSAL })
    return null
  }

  await store.save(result.order)
  return { order: result.order, note, defect, document }
}

const UNPUBLISHED_REFUSAL =
  "The document's link was never published in this session. Publish it with the Artifact tool and hand back the link it returns."

// A link an author names must be one its session's Artifact tool returned: a
// remembered or invented URL otherwise reaches the operator as a dead link.
async function confirmPublished(context: RunContext, claim: PublishClaim): Promise<boolean> {
  const { document } = claim
  if (document?.location !== 'published') return true
  const url = document.url
  // The session ran in its own lane's checkout, so only that transcript can hold its publish.
  const checkout = context.checkouts.get(claim.lane ?? 1)
  const publishes =
    claim.sessionId === null || checkout === undefined
      ? []
      : readPublishedArtifacts(transcriptPathFor(checkout.path, claim.sessionId))
  const isTheClaimedPublish = (publish: PublishedArtifact): boolean =>
    publish.url === url && (!isAbsolute(document.path) || publish.path === document.path)
  if (publishes.some(isTheClaimedPublish)) return true
  await recordLineEntry(context, {
    action: 'document.link_unconfirmed',
    subject: claim.nodeId,
    reason: `the author named ${url}, which its session never published`,
  })
  return false
}

interface PublishClaim {
  readonly nodeId: string
  readonly sessionId: string | null
  readonly lane: number | null
  readonly document: DocumentHandBack | null
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
function endPreviousProcess(sessionId: string): Promise<void> {
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

// Recorded when a step settles, so the refinery's queue never asks git. Git reporting
// nothing means it could not be read, so an empty answer keeps the previous record.
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
