import { z } from 'zod'
import type { ExtensionAPI, Disposable } from '../../../src/main/extensions/api'
import { app } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { modelCatalog } from './state/model-catalog.js'

import { createForgeChannels } from './ipc/forge-channels.js'
import { createRunChannels, writeRunGraph, readRunGraph } from './ipc/run-channels.js'
import { createInboxChannels } from './ipc/inbox-channels.js'
import { createLedgerChannels } from './ipc/ledger-channels.js'
import { createSensorChannels } from './ipc/sensor-channels.js'
import { newOrderId } from './forge/intake-source.js'
import { createSignalStore } from './sensors/store.js'
import type { SignalStore } from './sensors/store.js'
import { dueSensors, runSensor } from './sensors/schedule.js'
import type { CollectDeps } from './sensors/collect.js'
import { rulesFor, rulesAtRung } from './verify/rules.js'
import { availableNames, availableSensors, resolveRule } from './recipe/resolve.js'
import { RUNGS } from './verify/ladder.js'
import type { ResolveSources } from './recipe/resolve.js'
import { createLiveGateStore, createGateStore } from './gates/store.js'
import { raiseGate } from './gates/rules.js'
import { orphanedNodes } from './line/reclaim.js'
import type { StandingSources } from './order/standing.js'
import { countAttention } from './gates/attention.js'
import { createOrderStore, createLiveOrderStore } from './order/store.js'
import { tearDownRun, deleteOrder } from './line/teardown.js'
import { markReady, readPulls, shipOrder, finishShipping, pushLanes } from './line/integrate.js'
import type { ShellExec } from './line/integrate.js'
import { watchChecks, failedLogs } from './line/ci.js'
import type { Check, CiVerdict } from './line/ci.js'
import { ciRounds, ciReworkTarget, shipNodeId } from './line/ship-tail.js'
import { writeCiState } from './line/ci-state.js'
import type { CiState } from './line/ci-state.js'
import { rework } from './line/scheduler.js'
import { resolveRecipe } from './recipe/resolve.js'
import { ensureCheckout, ensureCheckouts, branchFor, checkoutPath } from './line/worktree.js'
import type { Checkout } from './line/worktree.js'
import { queueEntries } from './line/refinery-entries.js'
import { readRefineryState, writeRefineryState } from './line/refinery-state.js'
import { refineryTick } from './line/refinery-tick.js'
import type { RefineryTickDeps } from './line/refinery-tick.js'
import type { QueueEntry } from './line/refinery.js'
import { restack } from './line/restack.js'
import { issueOf, projectRemover, workspaceFor } from './line/order-project.js'
import { resumableIn } from './runtime/claude-launch.js'
import { fileTicket, ticketOffer } from './forge/ticket-offer.js'
import { followUpFor } from './forge/autonomy.js'
import { endAndWait } from './runtime/end-session.js'
import { compileOrder } from './order/compile.js'
import { readChangedFiles, readDiffSummary } from './runtime/diff-metrics.js'
import type { RunCommand } from './runtime/diff-metrics.js'
import { convergeBrief, readProposal } from './forge/converge.js'
import type { ConvergeOutcome, ConvergeStarted } from './ipc/forge-channels.js'
import { execute, opensPullRequest } from './line/executor.js'
import { interruptedRuns, interruptedGate } from './line/adopt.js'
import { createRoleRegistry } from './line/roles.js'
import type { RunOutcome, StartedRun, ExecutorDeps } from './line/executor.js'
import type { RunGraph, RunNode, Feedback } from './line/run-graph.js'
import type { EffortLevel, Recipe } from './recipe/parse.js'
import { decideReadOnly } from './runtime/read-only-policy.js'
import { collectableWrites, readRungOutput } from './line/rung-output.js'
import { readShell } from './runtime/shell-split.js'
import { decideTool } from './runtime/tool-decision.js'
import { ensureTrusted } from './runtime/workspace-trust.js'
import type { LedgerEntry } from './ledger/append.js'
import type { IntegrateDeps } from './line/integrate.js'
import { checkCapability, writeBack } from './trackers/write-back.js'
import type { IssuesPort, WriteBackDeps } from './trackers/write-back.js'
import type { Budgets, WorkOrder, WriteBack } from './order/schema.js'
import { budgetFromSetting } from './order/budget-setting.js'
import { resolveDataRoot, untrackedNotice, ledgerPath, orderDir } from './data-root.js'
import { queryEntries } from './ledger/append.js'
import { createControlServer, type ControlServer } from './runtime/control-server.js'
import { createSupervisedRunner, type SupervisedRunner } from './runtime/supervised-runner.js'
import { createPendingPermissions } from './runtime/pending-permissions.js'
import type { PendingAsk } from './runtime/pending-permissions.js'
import { createStallWatcher, type StallWatcher } from './runtime/stall-watcher.js'
import { createSupervision, type Supervision } from './runtime/supervision.js'
import { buildDigest, channelFor, type NotifiableEvent } from './runtime/feed/digest.js'
import { paletteEntries } from './runtime/palette.js'
import { createMuteStore, type MuteStore } from './runtime/feed/mutes.js'
import { readTranscriptTail } from './runtime/transcript-excerpt.js'
import { readTranscript } from './runtime/transcript-tailer.js'
import { recordTools } from './factory/timeline-store.js'
import type { HunkDecision } from './runtime/review/hunk-decisions.js'

/** One hunk as a surface renders it: the change, and what was decided. */
interface HunkView {
  id: string
  newStart: number
  lines: string[]
  decision: HunkDecision | null
}
import type { StallFiring } from './runtime/evaluate-stall.js'

const disposables: Disposable[] = []

// Active session registry: sessionId → session metadata
const activeSessions: Map<string, { id: string; name: string }> = new Map()

function reg(
  api: ExtensionAPI,
  channel: string,
  handler: (payload: unknown) => Promise<unknown> | unknown
) {
  disposables.push(api.ipc.registerHandler(channel, handler))
}

/** Where the chosen model lives, on the side of the bridge that launches runs. */
/**
 * Where Foundry keeps its records, resolved once at activation.
 *
 * Empty means beside the working directory, which leaves an untracked
 * directory behind — Foundry says so once and never edits a `.gitignore`,
 * because that would be writing into a repository the order did not ask to
 * change. A configured absolute path takes every order, which is the only
 * workable answer once an order spans repositories.
 */
/**
 * Tell the operator once that the default records location is untracked.
 *
 * Best-effort in every direction: a host with no notification surface, or a
 * settings store that will not answer, must not stop the extension loading.
 */
function noteUntrackedDataRoot(api: ExtensionAPI, root: string): void {
  try {
    const configured = api.settings?.get<string>('terminator.foundry.dataDir') ?? ''
    const notice = untrackedNotice({ root, usingDefault: configured.trim() === '' })
    if (notice === null) return
    if (api.settings?.get<boolean>('terminator.foundry.untrackedNoticeSeen') === true) return
    api.notifications?.showToast('info', notice, 'untrackedDataRoot')
    api.settings?.set('terminator.foundry.untrackedNoticeSeen', true)
  } catch {
    // Nothing here is worth failing activation for.
  }
}

/**
 * Where the records go when there is no workspace to be beside.
 *
 * Never `process.cwd()`. The extension host's working directory is wherever
 * the application was launched from — in development, the Terminator
 * repository itself — so defaulting to it writes one workspace's orders into
 * another repository's working tree. That happened, and the evidence was a
 * `.foundry/` directory in this repository with twelve orders in it from four
 * different fixtures.
 */
/**
 * The three rungs a recipe, role or rule is looked up in.
 *
 * Built on every read rather than captured at activation: which repositories
 * are open — and therefore which `.foundry/` directories are honoured — is not
 * known when the host loads the extension.
 */
function resolveSources(api: ExtensionAPI, root: string): ResolveSources {
  return {
    dataRoot: root,
    repoPaths: (api.workspace?.list() ?? []).map((workspace) => workspace.folderPath),
    // The built-ins ship inside the extension, so they are available in a
    // repository that contains nothing of Foundry's.
    builtInDir: path.resolve(__dirname, '..'),
  }
}

function fallbackDataRoot(): string {
  return path.join(app.getPath('userData'), 'foundry')
}

/**
 * Where Foundry keeps its records.
 *
 * Resolved from the setting and the current workspace on each read rather than
 * once at activation, because activation runs before a workspace exists: the
 * host calls it synchronously at load, and `api.workspace.list()` is empty
 * until the operator opens something. Resolving once there pinned every order
 * to the fallback for the life of the process.
 *
 * Still one resolver in one place — `data-root.ts` — and every writer still
 * receives an absolute path it never resolves again. Memoised on the inputs so
 * a surface polling a channel is not recomputing a path, and so the untracked
 * notice is decided from the same answer the writers use.
 */
const dataRootMemo = new Map<string, string>()

/**
 * The architect's open conversation, per order.
 *
 * In memory: a session does not survive a restart, and resuming one the
 * runtime has forgotten is refused rather than silently starting a fresh agent
 * that believes it is continuing.
 */
const intakeSessions = new Map<string, string>()

function resolveFoundryDataRoot(api: ExtensionAPI): string {
  // Every read here is optional. Activation is called synchronously by the
  // host and must not throw because one capability is absent — a host that
  // has no workspace yet is a normal state, not a reason to fail to load.
  let configured = ''
  let workdir: string | null = null
  try {
    configured = api.settings?.get<string>('terminator.foundry.dataDir') ?? ''
    workdir = api.workspace?.list()[0]?.folderPath ?? null
  } catch {
    // Leave the defaults.
  }

  const key = `${configured}\u0000${workdir ?? ''}`
  const memo = dataRootMemo.get(key)
  if (memo !== undefined) return memo

  const base = workdir ?? fallbackDataRoot()
  let root: string
  try {
    root = resolveDataRoot(configured, base).root
  } catch {
    // A relative path was configured, which is ambiguous once an order spans
    // repositories. Fall back to the default rather than refusing to activate.
    root = resolveDataRoot('', base).root
  }
  dataRootMemo.set(key, root)
  return root
}

const MODEL_SETTING_KEY = 'terminator.foundry.defaultModel'

/**
 * The model every phase launches with.
 *
 * Empty string is a real answer, not a missing one: it means "pass no
 * `--model`", so the run follows the operator's own Claude Code configuration.
 * Only an unset setting falls through to the default.
 */
/**
 * Make sure the repository an agent is about to work in is trusted, and say so.
 *
 * Recorded rather than done quietly: amending the operator's own Claude Code
 * configuration is a thing they should be able to find in the ledger, even
 * though it is the answer they would have given the dialog themselves.
 */
function trustRepository(
  api: ExtensionAPI,
  repoRoot: string,
  orderId: string,
  store: { record: (entry: LedgerEntry) => Promise<void> }
): void {
  const result = ensureTrusted(repoRoot)
  if (!result.changed) {
    if (result.reason === 'could not write') {
      api.log.error(
        `Foundry could not mark ${repoRoot} trusted; its agents will stop at the trust dialog.`
      )
    }
    return
  }
  void store
    .record({
      at: new Date().toISOString(),
      orderId,
      actor: 'rule:line',
      action: 'workspace.trusted',
      subject: repoRoot,
      reason:
        'Claude Code shows its trust dialog for a directory it has not seen, and an agent waiting at one never starts.',
      evidence: [],
    })
    .catch(() => undefined)
}

/**
 * Whether this is one of the commands the toolchain probe actually found.
 *
 * Exactly, after trimming — not a prefix, not with arguments appended. The
 * point is that a role which may run the project's tests may run *the project's
 * tests*, not anything beginning with the same word.
 */
function isProbedCommand(order: WorkOrder, tool: string, input: unknown): boolean {
  if (tool !== 'Bash') return false
  const command =
    typeof input === 'object' && input !== null
      ? (input as { command?: unknown }).command
      : undefined
  if (typeof command !== 'string') return false

  const probed = new Set(
    Object.values(order.context.toolchain)
      .filter((found) => found !== null)
      .map((found) => found.command.trim())
  )
  if (probed.size === 0) return false

  // Per segment, because a verdict from an exit status is the whole point and
  // an exit status is something you have to ask for. Watched live: a verifier
  // ran `npm test; echo "EXIT=$?"` — the plainest way there is to capture what
  // FR-033 says the verdict must come from — and a whole-command match refused
  // it, naming `npm` as not being on the review's list.
  //
  // One segment has to be a command this project actually declared, and every
  // other segment has to stand on its own under the read-only policy. So
  // `npm test; echo "EXIT=$?"` is allowed and `npm test; rm -rf .` is not.
  const segments = readShell(command).segments
  return (
    segments.some((segment) => probed.has(segment)) &&
    segments.every(
      (segment) => probed.has(segment) || decideReadOnly('Bash', { command: segment }).allow
    )
  )
}

/**
 * Why a finished run did not open anything, in one sentence.
 *
 * Read off the outcome in the order `shippable` itself checks, so the sentence
 * names the first thing that actually stopped it rather than the last thing
 * that happens to be false.
 */
function whyNotShipped(recipe: Recipe, outcome: RunOutcome): string {
  if (!opensPullRequest(recipe)) {
    return `the "${recipe.id}" shape opens nothing — it is a question, not a change`
  }
  if (!outcome.complete) return 'not every node finished'
  if (outcome.gates.length > 0) {
    return `held by ${outcome.gates.map((gate) => gate.rule).join(', ')}`
  }
  if (outcome.ladder === null) return 'the climb never ran, so nothing has been verified'
  if (!outcome.ladder.ok) {
    return outcome.ladder.stoppedAt === null
      ? `the climb could not measure ${outcome.ladder.unmeasured.join(', ')}`
      : `the climb stopped at ${outcome.ladder.stoppedAt}`
  }
  return 'it was not shippable, and this build cannot say which check said so'
}

/**
 * Tools the operator has declared read-only, beyond the ones the policy knows.
 *
 * Never inferred. `mcp__server__get_thing` and `mcp__server__delete_thing` are
 * the same shape to anything reading names, so guessing from one would be
 * guessing about writes — and the whole point of the read-only policy is that
 * a review cannot change what it is reviewing.
 */
function readOnlyTools(api: ExtensionAPI): string[] {
  const raw = api.settings?.get<string>('terminator.foundry.readOnlyTools') ?? ''
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

/**
 * A stall, written where the order's history is read.
 *
 * The feature directory *is* the order directory, so its basename is the order
 * id — and `orderDir` refuses anything that is not one, so a firing for a run
 * that is not an order's writes nothing rather than inventing a place for it.
 */
async function recordStall(
  featureDir: string,
  firing: { sessionId: string; signal: string; firedAt: number }
): Promise<void> {
  const orderId = path.basename(featureDir)
  const root = path.dirname(path.dirname(featureDir))
  try {
    orderDir(root, orderId)
  } catch {
    return
  }
  try {
    await createOrderStore(root).record({
      at: new Date(firing.firedAt).toISOString(),
      orderId,
      actor: 'rule:line',
      action: 'run.stalled',
      subject: firing.sessionId,
      reason: `An agent stopped making progress (${firing.signal}). Its terminal is still there and its work is still in the worktree; nothing was thrown away.`,
      evidence: [],
    })
  } catch {
    // A stall that cannot be recorded is still a stall. The console has it.
  }
}

/** The autonomy dial, read wherever it is needed rather than copied. */
function autonomyFor(api: ExtensionAPI): 'escorted' | 'standard' | 'lights-out' {
  return (
    api.settings?.get<'escorted' | 'standard' | 'lights-out'>('terminator.foundry.autonomy') ??
    'standard'
  )
}

function defaultModel(api: ExtensionAPI): string {
  const value = api.settings.get<string>(MODEL_SETTING_KEY)
  // An alias, not a pinned id: `--model opus` resolves to the latest of that
  // family, so this default cannot go a generation stale sitting here — which
  // is exactly what the pinned id it replaced did.
  return typeof value === 'string' ? value : 'opus'
}

/**
 * The model this role runs on.
 *
 * A role declares `modelTier: fast | deep`, and the settings panel has always
 * said the operator's choice applies "unless a role asks for something else" —
 * which was not true of anything, because nothing read the field. A `fast`
 * role now runs on the small model; `deep`, and a node with no role at all,
 * take the operator's choice.
 *
 * An alias again rather than a pinned id, for the same reason: `haiku`
 * follows the latest of that family.
 */
function modelForTier(api: ExtensionAPI, tier: 'fast' | 'deep'): string {
  const chosen = defaultModel(api)
  // An empty choice means "pass no --model", and a role asking for the fast
  // tier must not override the operator's decision to configure it themselves.
  if (chosen === '') return ''
  return tier === 'fast' ? 'haiku' : chosen
}

// The loopback endpoint the agents' hooks answer on, and the runner that owns
// their terminals. Started once for the extension rather than per run: a port
// per agent would be a port per card.
let control: ControlServer | null = null
let supervisedRunner: SupervisedRunner | null = null
// What is waiting on the operator, across every card. Without somewhere to
// hold these the surface has nothing to render and a phase sits at its hook.
const pendingPermissions = createPendingPermissions()
let stallWatcher: StallWatcher | null = null
/**
 * The palette's current entries, disposed and rebuilt when what is running
 * changes.
 *
 * The host takes a fixed contribution list, so keeping runs in the palette
 * means re-registering rather than answering a query. Cheap: the list is one
 * entry per live run and one per queued diff, and it only rebuilds when the
 * text would actually differ.
 */
let paletteRegistrations: Disposable[] = []
let paletteSignature = ''
let paletteTimer: NodeJS.Timeout | null = null
/**
 * The sensor tick (ADR-066): every due, enabled sensor runs sequentially once
 * a minute while the app is open. Nothing runs when no sensor is enabled —
 * `dueSensors` filters on that before anything is collected.
 */
let sensorTimer: NodeJS.Timeout | null = null
/**
 * The refinery tick: once a minute, watch merged predecessors and restack
 * whatever queued behind them (R4). Nothing runs when nothing has shipped a
 * pull yet — `computeQueueEntries`'s candidates are empty.
 */
let refineryTimer: NodeJS.Timeout | null = null
// Auto-expires so a late manual visit to the Forge doesn't surprise the
// operator with an intake that opened itself for no reason they can see.
let pendingNewOrder = false
let pendingNewOrderTimer: NodeJS.Timeout | null = null
// What is running, what it changed, what needs looking at, and what must not
// start yet.
let supervision: Supervision | null = null
/**
 * The orders an executor in this process is currently driving.
 *
 * Not decoration: a node is written down as `running` before its agent has
 * reported a session, so for a second or two it is indistinguishable from a
 * node whose agent is gone. Reclaiming it there would put a second agent into
 * the same worktree. While an order is in here, nothing reclaims its nodes.
 */
const executingOrders = new Set<string>()
/**
 * Data roots already looked at for runs the last application left behind.
 *
 * Once per root rather than once per process: activation runs before there is
 * a workspace, and the records location follows the workspace, so the answer
 * to "what did the last session leave here" is per-root and changes when the
 * operator switches.
 */
const adoptedRoots = new Set<string>()
/**
 * Which runs are allowed to interrupt you.
 *
 * Muting suppresses the notification, never the entry: the feed's record stays
 * complete whether or not it interrupted anyone.
 */
let mutes: MuteStore | null = null
/** Resolves once the supervision runtime is up, or has failed to come up. */
let runtimeStarting: Promise<unknown> | null = null

/**
 * Where the supervision runtime keeps its files.
 *
 * Absolute, and outside every repository. It used to be
 * `resolveWorktreeBaseDir('')`, which is `join('', '.worktrees')` — a
 * *relative* path — so the `--settings` handed to claude read
 * `.worktrees/.foundry-runtime/settings/<id>.json`, which the runtime
 * resolved against the worktree it was started in. It was never there, so every
 * supervised run died on "Settings file not found" the moment it launched: the
 * card sat at WORKING with 0 turns and the console stayed empty forever.
 *
 * Beside the extension's credentials, in userData: this is the pilot's own
 * state, not repository content, and nothing here should ever land in a diff.
 */
function runtimeStateDir(): string {
  return path.join(app.getPath('userData'), 'foundry-runtime')
}
/**
 * The notification a held tool call raised, so answering it takes the
 * notification away too. A console that leaves them behind teaches you to
 * dismiss without reading.
 */
const raisedNotifications = new Map<string, Disposable>()

/**
 * Says something, through the channel the event's kind is allowed.
 *
 * Automation complacency is the documented failure mode of supervisory control:
 * a console that only speaks when something is wrong teaches you that silence
 * means fine — and silence is also what a crashed console looks like. So the
 * rule is fixed rather than per-call: only a blocking permission request may
 * interrupt, everything else that needs a person is an indication, and routine
 * progress goes to the feed and nowhere else.
 */
function notify(
  api: ExtensionAPI,
  event: NotifiableEvent,
  message: string,
  actions?: Array<{ id: string; label: string; handler: () => void }>,
  /** Where the row takes you. Without one it is a report, not a link. */
  onClick?: () => void
): Disposable | null {
  switch (channelFor(event)) {
    case 'modal':
      // The nearest thing an extension has to a modal: it persists until it is
      // answered, and it carries the answer with it.
      return api.notifications.createNotification({
        type: 'warning',
        title: message,
        key: `foundry.permission.${event.sessionId}`,
        actions,
        onClick,
      })
    case 'indicator':
      api.notifications.showToast('warning', message, `foundry.${event.kind}.${event.sessionId}`)
      return null
    case 'digest':
      // Already in the feed. Interrupting for it is how a feed gets muted.
      return null
  }
}
/**
 * Stalls that have fired, newest first, and whether they were judged right.
 *
 * Kept in memory rather than persisted: the point of the record is tuning the
 * thresholds against a week of real use, and a firing about a run that no longer
 * exists is not something to reload on the next start.
 */
const stallFirings: Array<{ firing: StallFiring; featureDir: string; shadow: boolean }> = []

/**
 * Agents whose tool call was handed back to the terminal's own prompt.
 *
 * The bridge does that when nobody answers in time, and an unattended run
 * never reaches the prompt — so the agent stops there with its process alive
 * and its node still `running`, which every surface drew as a working build.
 * Keyed by session: one agent is stranded once, however many calls it lost.
 */
const strandedAgents = new Map<string, { orderId: string; sessionId: string; at: number }>()

/**
 * How many firings to keep.
 *
 * Enough to judge a week of them by hand, which is what shadow mode is for, and
 * bounded because this is an application that stays open for days and an
 * unbounded list is a leak with a UI on it.
 */
const MAX_STALL_FIRINGS = 200

/**
 * Shadow mode: record, do not interrupt. On by default and deliberately so — a
 * detector with a 20% false-positive rate produces alarm fatigue and gets turned
 * off, which is worse than not shipping it. Turn it off on the evidence of the
 * firings below, not on faith.
 */
/**
 * Whether this process is still running that agent's session.
 *
 * The runner's own register, which is emptied by `end` on a `SessionEnd`, a
 * closed tab or a dead process — and which is simply empty in a fresh
 * application. That is the whole point: every session a previous process
 * started is gone, and a graph that still says `running` is describing agents
 * that no longer exist.
 */
function isLiveSession(sessionId: string): boolean {
  return supervisedRunner?.terminalFor(sessionId) != null
}

function stallShadowMode(api: ExtensionAPI): boolean {
  return api.settings.get<boolean>('terminator.foundry.stallShadowMode') ?? true
}

/**
 * Brings up the control server, the runner, the supervision layer and the stall
 * detector, and returns the layer so a caller can read what is running.
 *
 * Returns null when the runtime could not start: phases then fall back to the
 * unsupervised spawn, and every surface reads empty rather than throwing.
 */
export async function startSupervisionRuntime(api: ExtensionAPI): Promise<Supervision | null> {
  try {
    control = await createControlServer()
    supervisedRunner = createSupervisedRunner({
      api,
      control,
      stateDir: runtimeStateDir(),
    })
    // A run that stops making progress without asking for anything is the
    // failure nobody instruments: it looks exactly like one that is working.
    supervision = createSupervision({
      api,
      stateDir: runtimeStateDir(),
    })
    mutes = createMuteStore(path.join(runtimeStateDir(), 'mutes.json'))

    const runner = supervisedRunner
    // How much each run's working copy has grown since the previous look. The
    // watcher reads transcripts and nothing else, so without this the loop
    // signal could never tell circling from steady work — and never fired.
    const lastSeenChange = new Map<string, number>()
    stallWatcher = createStallWatcher({
      runs: () => runner.watchable(),
      // Each tool call, recorded once, beside the order's run graph — what the
      // Factory view plays back after the fact.
      onActivity: (run, activity) => {
        void recordTools(run.featureDir, run.sessionId, activity).catch(() => {})
      },
      netChangeSince: (sessionId) => {
        const diff = supervision?.runs.get(sessionId)?.diff
        if (diff === undefined) return 1
        const total = diff.added + diff.removed
        const growth = total - (lastSeenChange.get(sessionId) ?? 0)
        lastSeenChange.set(sessionId, total)
        return growth
      },
      onFiring: (firing, featureDir) => {
        const shadow = stallShadowMode(api)
        stallFirings.unshift({ firing, featureDir, shadow })
        if (stallFirings.length > MAX_STALL_FIRINGS) stallFirings.length = MAX_STALL_FIRINGS
        supervision?.runs.setState(firing.sessionId, 'stalled', firing.firedAt)

        // On the order's own record as well as the console's.
        //
        // The detector is timely and nothing consumes it. Measured on a live
        // run: the builder fell silent at 07:27:08, this fired at 07:34:21,
        // and the run went on waiting until the wall-clock budget stopped it
        // at 07:52:10 — eighteen minutes after the console already knew. The
        // executor is not told, and shadow mode is on by default, so those
        // eighteen minutes left no trace anywhere an operator reads afterwards:
        // the ledger said "budget exceeded", which is true and explains nothing.
        //
        // This does not stop the run — doing that needs a gate rule, which is a
        // decision about FR-049 rather than a fix. It makes the silence
        // legible, which is the part that was simply missing.
        void recordStall(featureDir, firing)

        // Attributed to the pilot, not the agent: the agent did not say this,
        // and a feed that blurs the two is one you stop trusting.
        const entry = supervision?.feed.post({
          at: firing.firedAt,
          sessionId: firing.sessionId,
          author: 'console',
          summary: `stopped making progress (${firing.signal}) in ${path.basename(featureDir)}`,
        })
        api.window.broadcast('foundry:stall-fired', { firing, featureDir, shadow })
        if (shadow) return
        // Muted runs are recorded and shown, never surfaced — which is the only
        // alternative to turning the detector off wholesale when one run is
        // noisy.
        if (
          entry !== undefined &&
          supervision !== null &&
          !supervision.feed.shouldNotify(entry, mutes?.list() ?? [])
        ) {
          return
        }
        // An indication, not an interruption: a stall is not blocked on an
        // answer the way a held tool call is.
        notify(
          api,
          { kind: 'stalled', sessionId: firing.sessionId },
          `A run stopped making progress (${firing.signal})`,
          undefined,
          // A stall is the notification you most want to act on, and acting on
          // it means reading what the agent was doing when it went quiet.
          () => gotoRun(api, 'run', firing.sessionId)
        )
      },
    })
    stallWatcher.start()

    // Kept in step with the register on a timer rather than an event: the
    // registry is read by everything and subscribed to by nothing, and a
    // palette that lists a run which ended is worse than one a few seconds
    // behind.
    refreshPalette(api)
    paletteTimer = setInterval(() => refreshPalette(api), 5_000)
    return supervision
  } catch (error) {
    // Without it, phases fall back to the headless spawn. Said out loud: the
    // difference is whether tool calls are asked about or approved silently.
    api.log.error('supervised runtime unavailable — phases will run unsupervised', error)
    // Close what was opened. A failure after the control server bound left it
    // listening on a port nothing would ever answer on, and nothing would ever
    // close it either.
    void control?.close()
    control = null
    supervisedRunner?.dispose()
    supervisedRunner = null
    stallWatcher?.stop()
    stallWatcher = null
    supervision = null
    api.notifications.showToast(
      'error',
      'Supervision could not start — phases will run unsupervised, approving their own tool calls',
      'foundry.runtime.unavailable'
    )
    return null
  }
}

/**
 * The application's tracker connection, narrowed to what write-back needs.
 *
 * Null when the host has no `issues` surface at all — an older core, or a test
 * harness with a partial API. Every caller treats that as "no write-back",
 * never as a failure.
 */
function issuesPortFor(api: ExtensionAPI): IssuesPort | null {
  const issues = api.issues
  if (issues === undefined || typeof issues.supportsTransitions !== 'function') return null
  return {
    comment: (tracker, key, body) => issues.comment(tracker as never, key, body),
    transition: (tracker, key, intent, optionId) =>
      issues.transition(tracker as never, key, intent, optionId),
    states: async (tracker, key) => issues.states(tracker as never, key),
    supportsTransitions: (tracker) => issues.supportsTransitions(tracker as never),
  }
}

/**
 * The application's tracker connection, narrowed to what a sensor's `tracker`
 * source needs (`collect.ts`). Null when nothing is connected — a sensor of
 * this kind then reports "no tracker is connected" rather than throwing.
 */
function sensorIssuesFor(api: ExtensionAPI): CollectDeps['issues'] {
  const issues = api.issues
  if (issues === undefined) return null
  return {
    search: async (query, opts) =>
      (await issues.search(query, opts)).issues.map((issue) => ({
        key: issue.key,
        title: issue.title,
        url: issue.url,
      })),
    listMine: async (opts) =>
      (await issues.listMine(opts)).issues.map((issue) => ({
        key: issue.key,
        title: issue.title,
        url: issue.url,
      })),
  }
}

/**
 * One `CollectDeps` for a sensor watching `repoPath`, over the extension's own
 * `gh`/`git` exec and tracker connection.
 */
function sensorCollectDepsFor(api: ExtensionAPI, repoPath: string): CollectDeps {
  return {
    exec: (options) => api.shell.exec(options),
    cwd: repoPath,
    issues: sensorIssuesFor(api),
    now: () => new Date().toISOString(),
  }
}

/**
 * A signal store whose root is resolved on every call — the records location
 * follows the open workspace, the same reason `createLiveOrderStore` exists.
 */
function liveSignalStore(root: () => string): SignalStore {
  return {
    list: () => createSignalStore(root()).list(),
    save: (signals) => createSignalStore(root()).save(signals),
    get: (id) => createSignalStore(root()).get(id),
    sensorState: () => createSignalStore(root()).sensorState(),
    setSensorState: (id, patch) => createSignalStore(root()).setSensorState(id, patch),
  }
}

/**
 * Every due, enabled sensor, run once, sequentially — one interval tick,
 * whether it is the live 60-second one or a manual "run now".
 */
async function tickSensors(api: ExtensionAPI, root: string, store: SignalStore): Promise<void> {
  const sources = resolveSources(api, root)
  const defs = availableSensors(sources).map(({ def }) => def)
  const states = await store.sensorState()
  const now = new Date().toISOString()
  for (const def of dueSensors(defs, states, now)) {
    // `dueSensors` already refused anything without a repository; the null
    // check here is only so the type checker agrees.
    const repoPath = states[def.id].repoPath
    if (repoPath === null) continue
    try {
      await runSensor(def, {
        store,
        collectDeps: sensorCollectDepsFor(api, repoPath),
        now: () => new Date().toISOString(),
        newId: () => randomUUID(),
      })
    } catch (error) {
      api.log.error(`sensor ${def.id} failed to run`, error)
    }
  }
}

/**
 * What the record already says about these files (FR-077).
 *
 * One line per past decision, newest first and bounded — the point is to tell
 * the Architect "this was decided before", not to hand it the whole ledger.
 */
async function priorArtFor(root: string, paths: readonly string[]): Promise<string[]> {
  const orders = await createOrderStore(root).list()
  const entries = (
    await Promise.all(orders.map((order) => queryEntries(ledgerPath(root, order.id))))
  ).flat()

  return entries
    .filter((entry) => paths.some((p) => entry.subject.includes(p) || entry.reason.includes(p)))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 10)
    .map((entry) => `${entry.at.slice(0, 10)} ${entry.actor}: ${entry.action} — ${entry.reason}`)
}

/** Which write-backs a new order starts with, from the operator's settings. */
function defaultWriteBack(api: ExtensionAPI): WriteBack[] {
  const on = (key: string): boolean => api.settings?.get<boolean>(key) ?? true
  const enabled: WriteBack[] = []
  if (on('terminator.foundry.writeBack.summaryComment')) enabled.push('summary_comment')
  if (on('terminator.foundry.writeBack.status')) enabled.push('status')
  if (on('terminator.foundry.writeBack.prLink')) enabled.push('pr_link')
  return enabled
}

/**
 * The budgets a new order starts with, from settings (FR-030).
 *
 * Read at seed time rather than at run time: the order carries its own agreed
 * budgets, and changing the setting later must not silently re-price work the
 * operator already agreed to.
 */
function defaultBudgets(api: ExtensionAPI): Omit<Budgets, 'tokens'> {
  const num = (key: string, fallback: number): number | null =>
    budgetFromSetting(api.settings?.get<number>(key), fallback)
  return {
    agents: num('terminator.foundry.budgets.agents', 3),
    wallClockMinutes: num('terminator.foundry.budgets.wallClockMinutes', 45),
  }
}

/** The operator's critical paths, one glob per line (FR-043). Never inferred. */
function declaredCriticalPaths(api: ExtensionAPI): string[] {
  const raw = api.settings?.get<string>('terminator.foundry.criticalPaths') ?? ''
  return [
    ...new Set(
      raw
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '')
    ),
  ]
}

function writeBackDepsFor(
  api: ExtensionAPI,
  root: string,
  order: WorkOrder,
  issues: IssuesPort
): WriteBackDeps {
  return {
    issues,
    now: () => new Date().toISOString(),
    // Null means "let the tracker resolve it", which is not the same as an
    // empty override, so the nulls are stripped rather than passed through.
    mapping: Object.fromEntries(
      Object.entries(order.stateMapping).filter(([, value]) => value !== null)
    ) as WriteBackDeps['mapping'],
    record: async (action, subject, reason) => {
      await createOrderStore(root).record({
        at: new Date().toISOString(),
        orderId: order.id,
        actor: 'rule:writeback',
        action,
        subject,
        reason,
        evidence: [],
      })
    },
  }
}

/**
 * @param orderId Which order's ledger these entries belong in.
 *
 * Not `subject`, which is what this used. A shipping entry's subject is
 * whatever the entry is about — the order for `ship.ready_asked`, and the
 * **pull request URL** for `ship.draft_opened`. Filing by subject sent the most
 * important entry the feature writes to a ledger named after a URL, and built
 * the directories to match:
 *
 *   .foundry/orders/https:/github.com/owner/repo/pull/8/ledger.jsonl
 *
 * So a live run opened a real draft and its own ledger never said so — the
 * evidence for the one thing the Line exists to do, filed under a path made of
 * somebody else's text.
 */
function integrateDepsFor(api: ExtensionAPI, root: string, orderId: string): IntegrateDeps {
  return {
    exec: (options) => api.shell.exec(options),
    root,
    now: () => new Date().toISOString(),
    autoOpen: api.settings?.get<boolean>('terminator.foundry.autoOpenDraftPr') ?? true,
    // Nothing in the extension host answers a gate; the operator does, through
    // the inbox. A shipping decision reaching this seam means it was never
    // raised, and holding is the only safe reading of that.
    decide: async () => 'hold',
    record: async (action, subject, reason) => {
      await createOrderStore(root).record({
        at: new Date().toISOString(),
        orderId,
        actor: 'rule:ship',
        action,
        subject,
        reason,
        evidence: [],
      })
    },
  }
}

/**
 * Every in-flight order's queue entries, for the refinery's file-overlap
 * queue: the observe/list channels' `queue` field, and the advisory shown on
 * agreement.
 *
 * `merged` is read up front into a plain set, because `queueEntries` asks for
 * it synchronously — every candidate order's `refinery.json` is small and
 * this runs at most once per channel call, never per tick.
 */
async function computeQueueEntries(api: ExtensionAPI, root: string): Promise<QueueEntry[]> {
  const orders = await createOrderStore(root).list()
  const inFlight = orders.filter((o) => o.status === 'running' || o.status === 'shipped')
  const merged = new Set<string>()
  for (const order of inFlight) {
    const state = await readRefineryState(root, order.id)
    if (state.mergedAt !== null) merged.add(order.id)
  }

  const diffCommand: RunCommand = async (command, args, cwd) => {
    if (command !== 'git' && command !== 'gh') return { ok: false, stdout: '' }
    const result = await api.shell.exec({ command, args, cwd })
    return { ok: result.exitCode === 0, stdout: result.stdout }
  }

  return queueEntries(orders, {
    readPulls: (orderId) => readPulls(root, orderId),
    changedFiles: async (order) => {
      const files: string[] = []
      for (const repo of order.context.repos) {
        const path = checkoutPath(root, order, repo.name)
        if (!fs.existsSync(path)) continue
        files.push(...(await readChangedFiles(path, repo.baseBranch, diffCommand)))
      }
      return files
    },
    merged: (orderId) => merged.has(orderId),
    agreedAt: (order) => order.agreedAt ?? '',
  })
}

/**
 * The parts of a CI round that never change between the run that opened the
 * draft and a later "another round" answered from the inbox: how a pull's
 * checks are watched, how a failure's log is read, and where the round's own
 * ledger entry and live state go.
 *
 * `sendBack` is deliberately not here — the run and the inbox each build a
 * different one, because the run already has a graph and executor deps in
 * hand and the inbox has to rebuild them.
 */
function ciRoundDepsFor(
  root: string,
  orderId: string,
  exec: ShellExec
): {
  watch: (
    pull: { url: string; cwd: string },
    onPoll: (checks: readonly Check[]) => void,
    judged: ReadonlySet<string>
  ) => Promise<CiVerdict>
  failedLogs: (checks: readonly Check[], cwd: string) => Promise<string>
  record: (action: string, subject: string, reason: string) => Promise<void>
  state: (state: Omit<CiState, 'at'>) => Promise<void>
} {
  return {
    watch: (pull, onPoll, judged) =>
      watchChecks(pull, exec, {
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        onPoll,
        ignoreRuns: judged,
      }),
    failedLogs: (checks, cwd) => failedLogs(checks, cwd, exec),
    record: async (action, subject, reason) => {
      await createOrderStore(root).record({
        at: new Date().toISOString(),
        orderId,
        actor: 'rule:ci',
        action,
        subject,
        reason,
        evidence: [],
      })
    },
    state: (state) => writeCiState(root, orderId, { ...state, at: new Date().toISOString() }),
  }
}

/**
 * The fix round a red CI check gets: rework the graph back to the builder,
 * re-run the executor from there, and — if that leaves the order shippable —
 * push the fixed branches onto the drafts that are already open.
 *
 * Shared between a run in flight and a `ci.red` gate answered later from the
 * inbox, which is the whole reason `graphRef` is a box rather than a plain
 * graph: each round has to see the graph the previous round left, and the
 * inbox path has no closure over a running executor to hold it for it.
 */
function ciSendBackFor(
  root: string,
  order: WorkOrder,
  recipe: Recipe,
  executorDeps: ExecutorDeps,
  integrateDeps: IntegrateDeps,
  graphRef: { current: RunGraph }
): (feedback: Feedback) => Promise<boolean> {
  return async (feedback) => {
    const target = ciReworkTarget(recipe)
    const shipId = shipNodeId(recipe)
    if (target === null || shipId === null) return false

    graphRef.current = rework(graphRef.current, shipId, target, feedback)
    await writeRunGraph(root, graphRef.current)

    const outcome = await execute(order, recipe, graphRef.current, executorDeps)
    graphRef.current = outcome.graph
    await writeRunGraph(root, graphRef.current)

    if (!outcome.shippable) return false
    await pushLanes(order, integrateDeps)
    return true
  }
}

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
  const order = await createOrderStore(root).load(orderId)
  if (order === null || order.recipe === null) return
  const resolved = resolveRecipe(order.recipe, resolveSources(api, root))
  if (!resolved.ok) return
  const recipe = resolved.resolved.value
  const graph = await readRunGraph(root, orderId)
  if (graph === null) return
  const pulls = await readPulls(root, orderId)
  if (pulls.length === 0) return

  const { deps: executorDeps, exec } = await buildExecutorDeps(api, root, order, recipe, graph)
  const integrateDeps = integrateDepsFor(api, root, orderId)
  const graphRef = { current: graph }
  const outcome = await ciRounds({
    pulls: pulls.map((pull) => ({ url: pull.url, cwd: pull.cwd })),
    rounds: recipe.ci?.rounds ?? null,
    ...ciRoundDepsFor(root, orderId, exec),
    sendBack: ciSendBackFor(root, order, recipe, executorDeps, integrateDeps, graphRef),
  })
  const gates = createLiveGateStore(() => root)
  await finishShipping(
    order,
    { verdicts: [], findings: [] },
    pulls,
    pulls.map((p) => p.bodyPath),
    outcome,
    {
      ...integrateDeps,
      raiseGate: async (g) => {
        await gates.save(g)
      },
    }
  )
}

/**
 * The refinery's own gate: an overlapping order's lanes no longer rebase
 * cleanly onto their base after a predecessor merged. Never resolved
 * automatically — `restack` already refused to guess, and this just says so
 * where the operator will see it.
 */
async function raiseRefineryConflict(
  root: string,
  orderId: string,
  why: string,
  files: readonly string[]
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
  await createLiveGateStore(() => root).save(gate)
}

/**
 * One pass of the refinery: watch for merges, restack what queued behind,
 * recheck it. Built fresh on every tick so it always reads the workspace's
 * current data root, the same reason every other tick function does.
 */
async function runRefineryTick(api: ExtensionAPI, root: string): Promise<void> {
  const store = createOrderStore(root)

  const deps: RefineryTickDeps = {
    candidates: async () => {
      const orders = await store.list()
      const inFlight = orders.filter((o) => o.status === 'running' || o.status === 'shipped')
      return Promise.all(
        inFlight.map(async (order) => ({
          order: { id: order.id, title: order.title },
          pulls: (await readPulls(root, order.id)).map((pull) => ({ url: pull.url })),
        }))
      )
    },
    readState: (orderId) => readRefineryState(root, orderId),
    writeState: (orderId, state) => writeRefineryState(root, orderId, state),
    viewPr: async (url) => {
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
    },
    entries: () => computeQueueEntries(api, root),
    lanesFor: async (orderId) => {
      const order = await store.load(orderId)
      if (order === null) return []
      return order.context.repos.map((repo) => ({
        cwd: checkoutPath(root, order, repo.name),
        branch: branchFor(order, repo.lane),
        base: repo.baseBranch,
      }))
    },
    restack: (lane) => restack(lane, (options) => api.shell.exec(options)),
    watchCi: (orderId) => watchRestackedCi(api, root, orderId),
    raiseConflict: (orderId, why, files) => raiseRefineryConflict(root, orderId, why, files),
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
    now: () => new Date().toISOString(),
  }

  await refineryTick(deps)
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
async function stopOrder(root: string, orderId: string, reason: string): Promise<void> {
  const store = createOrderStore(root)
  const graph = await readRunGraph(root, orderId)
  const stopped: string[] = []
  for (const node of graph?.nodes ?? []) {
    if (node.sessionId === null || !isLiveSession(node.sessionId)) continue
    // Told why first, so the agent's own transcript carries the reason rather
    // than ending mid-sentence for no stated cause.
    if (supervisedRunner?.stop(node.sessionId, reason) === true) {
      supervision?.finish(node.sessionId, Date.now())
      supervision?.runs.archive(node.sessionId, 'stopped', Date.now())
      stopped.push(node.id)
    }
  }

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
async function adoptInterruptedRuns(root: string): Promise<void> {
  if (adoptedRoots.has(root)) return
  adoptedRoots.add(root)

  const store = createOrderStore(root)
  const orders = await store.list()
  const onDisk = await Promise.all(
    orders.map(async (order) => ({ order, graph: await readRunGraph(root, order.id) }))
  )

  const gates = createGateStore(root)
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
async function buildExecutorDeps(
  api: ExtensionAPI,
  root: string,
  order: WorkOrder,
  recipe: Recipe,
  graph: RunGraph
): Promise<{
  deps: ExecutorDeps
  exec: ShellExec
  store: ReturnType<typeof createOrderStore>
  houseRules: ReturnType<typeof rulesFor>['rules']
}> {
  const exec: ShellExec = (options) => api.shell.exec(options)
  // `diff-metrics` speaks in bare command and args; the core allowlist admits
  // `git` and `gh` and nothing else, so anything past those is refused here
  // rather than attempted.
  const diffCommand: RunCommand = async (command, args, cwd) => {
    if (command !== 'git' && command !== 'gh') return { ok: false, stdout: '' }
    const result = await exec({ command, args, cwd })
    return { ok: result.exitCode === 0, stdout: result.stdout }
  }
  const startedAt = Date.now()
  // Every checkout before any agent starts: a run that provisions lane 2 half
  // way through and fails has already spent lane 1's agent budget.
  const checkouts = await ensureCheckouts(order, { exec, root })

  /** What the working copies have actually changed, against their base. */
  const readObservedChange = async (): Promise<{
    changedFiles: string[]
    linesChanged: number
  }> => {
    const changedFiles: string[] = []
    let linesChanged = 0
    for (const checkout of checkouts.values()) {
      const declared = order.context.repos.find((repo) => repo.name === checkout.repo)?.baseBranch
      const against = declared === undefined || declared === '' ? 'main' : declared
      changedFiles.push(...(await readChangedFiles(checkout.path, against, diffCommand)))
      const summary = await readDiffSummary(checkout.path, against, diffCommand)
      linesChanged += summary.added + summary.removed
    }
    return { changedFiles, linesChanged }
  }

  const workspaceOf = (checkout: { origin: string }): string =>
    workspaceFor(api.workspace?.list() ?? [], checkout.origin)
  const store = createOrderStore(root)
  const featureDir = orderDir(root, order.id)

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
  const conversations = new Map<string, string>()
  /**
   * Lane and role together, because the role is the guard.
   *
   * A node can only ever be offered the conversation its own role has been
   * having. A bare command — a recipe's `run` step, a ladder rung — has no
   * role and gets its own, so eight rungs are still one conversation rather
   * than eight fresh agents each re-reading the repository to run one command,
   * and none of them arrives carrying the builder's identity.
   */
  const conversation = (lane: number, role: string | null): string => `${lane}:${role ?? 'command'}`

  for (const node of graph.nodes) {
    if (node.sessionId === null || node.role === null) continue
    conversations.set(conversation(node.lane ?? 1, node.role), node.sessionId)
  }

  /**
   * One node, from launch to the end of its turn.
   *
   * A promise around the runner's callbacks rather than an await, because the
   * runner reports an ending through `onEnd` and returns as soon as the
   * session exists. Settled exactly once: an agent that both fails to start
   * and reports an end would otherwise resolve twice.
   */
  function runNode(input: {
    node: RunNode
    role: string | null
    prompt: string
    resumeSessionId: string | undefined
    readOnly: boolean
    modelTier: 'fast' | 'deep'
    /** The step's effort, resolved by the executor; null passes no flag. */
    effort: EffortLevel | null
    /** Whether this role declared the class of work a tool belongs to. */
    mayUseTool: (tool: string) => boolean
    /** The one file this rung may write, or null when it has no artefact. */
    outputPath?: string | null
    /** Where this node's skills were mounted, or null when it declared none. */
    skillsMount: string | null
    /** Called as soon as the session exists, not when its turn ends. */
    onStarted?: (sessionId: string) => void
  }): Promise<StartedRun> {
    const checkout = checkouts.get(input.node.lane ?? 1)
    // No checkout and no runner mean nothing ran. Reported with a null exit
    // status, which the verdict path reads as "not measured" — calling it a
    // pass or a failure would both be claims nobody checked.
    const runner = supervisedRunner
    if (checkout === undefined || runner === null) {
      return Promise.resolve({ sessionId: `${input.node.id}-unstarted`, exitCode: null })
    }

    return new Promise<StartedRun>((resolve) => {
      const lane = input.node.lane ?? 1
      let sessionId = `${input.node.id}-unstarted`
      // Where this node's turn begins in the lane's transcript. Every node
      // after the first resumes that conversation, so without the mark a rung
      // reads an earlier node's tool calls as its own.
      let transcriptFrom = 0
      let settled = false
      const finish = (exitCode: number | null): void => {
        if (settled) return
        settled = true
        resolve({ sessionId, exitCode, transcriptFrom })
      }

      // Claude Code shows its workspace trust dialog for a directory it has
      // not seen, in interactive sessions only — and this is an interactive
      // session by design. Without this the agent comes up, sits at that
      // dialog, and never starts: the process is running, the register has it,
      // the graph says `running`, and nothing happens for ever.
      //
      // Keyed to the repository rather than the worktree, because that is what
      // the documentation says trust is keyed to for a worktree.
      trustRepository(api, checkout.origin, order.id, store)

      void runner
        .start({
          featureDir,
          worktreePath: checkout.path,
          workspaceId: workspaceOf(checkout),
          branch: checkout.branch,
          issue: issueOf(order),
          prompt: input.prompt,
          phase: (input.role ?? input.node.id) as never,
          resumeSessionId: input.resumeSessionId,
          model: modelForTier(api, input.modelTier),
          effort: input.effort ?? undefined,
          addDirs: input.skillsMount === null ? undefined : [input.skillsMount],
          // The read-only decision is taken by the same policy the hook
          // applies, so a verifier that decides to fix what it found is
          // refused rather than reminded.
          // Two gates, not one. Read-only is the whole-role decision; the
          // second holds a role that may write to what it said it writes with
          // — a scribe that decided to edit source rather than documentation
          // is refused by the first if it has no checkout, and by neither if
          // the only check were "may this role write at all".
          // Composed in `runtime/tool-decision.ts`, where it can be tested:
          // every live failure of this feature that was not a stall came from
          // this decision, and the tests that mention `autoDecide` all pass a
          // stub, so they covered the bridge and never the decision.
          autoDecide: (tool, toolInput) =>
            decideTool({
              tool,
              input: toolInput,
              readOnly: input.readOnly,
              role: input.role,
              mayUseTool: input.mayUseTool,
              isProbed: (name, given) => isProbedCommand(order, name, given),
              readOnlyTools: readOnlyTools(api),
              autonomy: autonomyFor(api),
              worktreePath: checkout.path,
              outputPath: input.outputPath ?? null,
              skillsMount: input.skillsMount,
            }),
          onPending: (pending) => {
            // Asks reach the console as well as the inbox. A refusal is posted
            // here and a *question* was not, so an agent waiting on one looked
            // exactly like an agent that had gone quiet — which is what it
            // then became. Watched live: a builder redirected its test output
            // to a scratch file outside the checkout, FR-050 asked about it,
            // nobody was there, the bridge handed the call back to the
            // terminal's own prompt five minutes later, and the run sat until
            // the wall-clock budget ended it half an hour on. Nothing anywhere
            // said a question had been asked.
            supervision?.feed.post({
              at: Date.now(),
              sessionId: pending.sessionId,
              author: 'console',
              summary: `asked about ${pending.toolName}: waiting for a decision`,
            })
            // An agent that is asking again is an agent that got past the
            // prompt somebody answered for it.
            strandedAgents.delete(pending.sessionId)
            notePending(api, { ...pending, featureDir }, { id: order.id, root })
          },
          onResolved: (requestId, outcome) => {
            // A hand-back is not an answer. The runtime puts its own prompt in
            // the terminal instead, which an unattended run never reaches — so
            // this is the moment the agent stops, and it should say so.
            if (outcome === 'handback') {
              supervision?.feed.post({
                at: Date.now(),
                sessionId,
                author: 'console',
                summary:
                  'nobody answered, so the question went to the prompt in the terminal — an agent waits there',
              })
              // Recorded, not only posted. A feed entry scrolls away; this is
              // what lets the order say it is waiting on a person rather than
              // building, which is what it said for the two hours after.
              strandedAgents.set(sessionId, { orderId: order.id, sessionId, at: Date.now() })
            }
            noteResolved(requestId)
          },
          // Refusals reach the console. An agent being turned down looks
          // exactly like one that has gone quiet, and reading its transcript
          // was the only way to tell them apart.
          onAutoDenied: (tool, reason) =>
            supervision?.feed.post({
              at: Date.now(),
              sessionId,
              author: 'console',
              summary: `refused ${tool}: ${reason}`,
            }),
          // Set here as well as after `start` resolves, so a turn that ends
          // before the promise settles still names the right session rather
          // than the placeholder.
          onRegistered: (run) => {
            sessionId = run.sessionId
            transcriptFrom = run.transcriptFrom
            // The graph learns the session while there is still an agent in
            // it. Before this the Floor's Watch and Attach appeared only after
            // the turn ended, so the one moment you needed a terminal was the
            // one moment there was no way into it.
            input.onStarted?.(run.sessionId)
          },
          onEnd: (exitCode) => {
            // Off the live list and into the record, so a finished unit stops
            // holding a review slot and the next wave can start.
            supervision?.finish(sessionId, Date.now())
            supervision?.runs.archive(sessionId, exitCode === 0 ? 'ended' : 'stopped', Date.now())
            finish(exitCode)
          },
          onTurnEnd: (turns) => {
            void supervision?.finishTurn(sessionId, turns, Date.now())
            // The node is over when the *turn* is over, not when the process
            // is. A supervised session sits at its prompt after answering —
            // that is the whole point of running it in a terminal you can
            // type into — so waiting for `onEnd` waits for something that
            // never happens, and the Line could not complete a single agent
            // node. Intake has always got this right; this is the same rule.
            //
            // Zero because the turn ended, not because the work was good:
            // whether it was is the verifier's to say and the ladder's to
            // measure, never the producing agent's (FR-033).
            finish(0)
          },
        })
        .then((run) => {
          if (run === null) {
            finish(null)
            return
          }
          sessionId = run.sessionId
          transcriptFrom = run.transcriptFrom
          input.onStarted?.(run.sessionId)
          // The lane's open conversation, for the next node that may carry it
          // on. A role that may not resume is never offered it — the registry
          // refuses, structurally — and neither is a role that is not the one
          // whose conversation this is.
          conversations.set(conversation(lane, input.role), run.sessionId)
          // On the register, which is what the stall detector, the review
          // queue and the backpressure gate all read from. Without this the
          // agent is running and every one of them sees an idle factory —
          // the register was the seam the old phase dispatcher filled.
          supervision?.runs.add({
            sessionId: run.sessionId,
            featureDir,
            phase: input.role ?? input.node.stepId,
            worktreePath: checkout.path,
            branch: checkout.branch,
            baseBranch:
              checkout.origin === '' ? null : (order.context.repos[0]?.baseBranch ?? null),
            terminalSessionId: run.terminalSessionId,
            transcriptPath: run.transcriptPath,
            startedAt: Date.now(),
          })
          void supervision?.measure(run.sessionId)
        })
        .catch(() => finish(null))
    })
  }

  const sources = resolveSources(api, root)
  // Read once, so what a rung is told it may hand back and what is accepted
  // from it come from the same resolution of the same role file.
  const roleRegistry = createRoleRegistry(sources)
  const houseRules = rulesFor(sources, {
    repoPaths: sources.repoPaths,
    houseDocs: [...order.context.houseDocs],
  }).rules
  const gates = createLiveGateStore(() => root)
  return {
    deps: {
      now: () => new Date().toISOString(),
      sources,
      run: runNode,
      sessionFor: (lane, role) => conversations.get(conversation(lane, role)),
      record: async (action, subject, reason) => {
        await store.record({
          at: new Date().toISOString(),
          orderId: order.id,
          actor: 'rule:line',
          action,
          subject,
          reason,
          evidence: [],
        })
      },
      autonomy: autonomyFor(api),
      // Loaded once, so what an agent is told the house rules are and what the
      // change is judged against are the same list.
      rules: houseRules,
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
      collect: async ({ nodeId, role, outputPath }) => {
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
          await store.record({
            at: new Date().toISOString(),
            orderId: order.id,
            actor: `role:${role}`,
            action: 'rung.refused',
            subject: nodeId,
            reason: result.reason,
            evidence: [],
          })
          return null
        }

        await store.save(result.order)
        return { order: result.order, note: result.note, defect: result.defect }
      },
      raise: async (gate) => {
        await gates.save(gate)
        await store.record({
          at: new Date().toISOString(),
          orderId: order.id,
          actor: `rule:${gate.rule}`,
          action: 'gate.raised',
          subject: gate.id,
          reason: gate.why,
          evidence: [...gate.evidence],
        })
      },
      // A rung is a command, not a conversation: its inputs fully determine what
      // it does and its verdict is its exit status. So it runs in a terminal tab
      // of its own in the lane's checkout — visible, like everything else here —
      // with no agent in between to spend a turn on it or a transcript to read
      // the answer back out of.
      runStep: async (step) => {
        if (step.command === null) return null
        const lane = [...checkouts.keys()].sort((a, b) => a - b)[0] ?? 1
        const checkout = checkouts.get(lane)
        const runner = supervisedRunner
        // Nothing ran, so nothing was measured — never a pass.
        if (checkout === undefined || runner === null) return null
        return runner.runCommand({
          worktreePath: checkout.path,
          workspaceId: workspaceOf(checkout),
          branch: checkout.branch,
          issue: issueOf(order),
          title: step.name,
          command: step.command,
        })
      },
      // A recipe `run` step whose command is not a slash instruction runs as a
      // command in the lane's checkout, the same way `runStep` runs a gate's
      // check — visible, and never handed to an agent that would report a
      // pass regardless of what the command did.
      runCommand: async (input) => {
        const lane = input.node.lane ?? [...checkouts.keys()].sort((a, b) => a - b)[0] ?? 1
        const checkout = checkouts.get(lane)
        const runner = supervisedRunner
        // Nothing ran, so nothing was measured — never a pass.
        if (checkout === undefined || runner === null) return null
        return runner.runCommand({
          worktreePath: checkout.path,
          workspaceId: workspaceOf(checkout),
          branch: checkout.branch,
          issue: issueOf(order),
          title: input.title,
          command: input.command,
          logPath: input.logPath,
        })
      },
      // The previous process of this conversation may still be sitting at its
      // prompt when a node resumes it. Two processes must not share one
      // conversation — the same reason `endAndWait` exists for a follow-up turn.
      endSession: (sessionId) =>
        endAndWait(
          {
            stop: (id, reason) => supervisedRunner?.stop(id, reason) ?? false,
            isLive: isLiveSession,
          },
          sessionId,
          'continuing the lane in its next step'
        ).then(() => undefined),
      observe: async () => ({
        // Fractional on purpose. Rounded, a run at 19:31 reported "20" and a
        // twenty-minute budget could only be exceeded at 20:30 — so a run whose
        // deadline was the budget never saw the gate at all. The gate rounds it
        // for the sentence it prints; the comparison is exact.
        elapsedMinutes: (Date.now() - startedAt) / 60_000,
      }),
      onEvent: (event) => {
        if (event.type !== 'verdict') return
        void store.record({
          at: new Date().toISOString(),
          orderId: order.id,
          actor: `role:${event.verdict.producedBy.role}`,
          action: 'verify.verdict',
          subject: event.verdict.criterionId,
          reason: `${event.verdict.result}${event.verdict.reason === '' ? '' : `: ${event.verdict.reason}`}`,
          evidence: [...event.verdict.evidence],
        })
      },
      // Written on every change rather than only at the end. `run.observe` reads
      // this file, so without it the Floor shows the graph the run started with
      // for the whole of the run.
      persist: (graph) => writeRunGraph(root, graph),
      // What the work actually changed, so the regrade answers for the change
      // rather than for the plan that predicted it. Without this the executor
      // was handed the units' own `touches` list and a hardcoded zero lines, so
      // a builder that went outside what it declared was invisible to the check
      // that exists to notice, and nothing could ever grade worse than planned.
      observedChange: readObservedChange,
      // Lets the budget be re-read while agents are in flight. Without it the
      // wall-clock budget can only fire between waves, which is every case
      // except the one it exists for: an agent that never comes back.
      wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    },
    exec,
    store,
    houseRules,
  }
}

async function executeRun(
  api: ExtensionAPI,
  root: string,
  order: WorkOrder,
  recipe: Recipe,
  graph: RunGraph
): Promise<void> {
  const {
    deps: executorDeps,
    exec,
    store,
    houseRules,
  } = await buildExecutorDeps(api, root, order, recipe, graph)
  const issuesPort = issuesPortFor(api)

  // The issue moves the moment work starts, not when somebody remembers.
  if (issuesPort !== null) {
    await writeBack(order, 'started', writeBackDepsFor(api, root, order, issuesPort))
  }

  const outcome = await execute(order, recipe, graph, executorDeps)

  await writeRunGraph(root, outcome.graph)
  await store.record({
    at: new Date().toISOString(),
    orderId: order.id,
    actor: 'rule:line',
    action: outcome.complete ? 'run.complete' : 'run.halted',
    subject: order.id,
    reason: outcome.complete
      ? `${outcome.verdicts.length} verdicts`
      : `waiting on ${outcome.awaitingDecision.join(', ') || 'a gate'}`,
    evidence: [],
  })

  // ── The tail ───────────────────────────────────────────────────────────
  //
  // Work that is finished and waiting on nobody ships, without being asked
  // (FR-053). Work that is waiting on somebody does not — the run halts, the
  // inbox has the question, and answering it resumes from here.
  if (!outcome.shippable) {
    // Out loud. A run that finishes every node and then quietly does not ship
    // is indistinguishable, from every surface, from one that shipped — the
    // graph is all green either way, and the only way to find out was to go
    // and look at GitHub. Watched on a live run: every node passed, nothing
    // was pushed, and nothing anywhere said why.
    await store.record({
      at: new Date().toISOString(),
      orderId: order.id,
      actor: 'rule:line',
      action: 'ship.refused',
      subject: order.id,
      reason: whyNotShipped(recipe, outcome),
      evidence: [],
    })
    return
  }

  const gates = createLiveGateStore(() => root)
  const shippedOrder = { ...order, risk: outcome.risk }
  const graphRef = { current: outcome.graph }

  // Shipped against the grade the change turned out to deserve, not the one
  // the plan predicted — which is the whole reason the executor regrades.
  const shipped = await shipOrder(
    shippedOrder,
    {
      verdicts: outcome.verdicts,
      findings: outcome.inspection.required ? [outcome.inspection.reason] : [],
      ladder: outcome.ladder,
      // Grouped by rung, so the record says what was in force where rather
      // than listing every rule as though they all applied at once.
      rulesInForce: RUNGS.flatMap((rung) =>
        rulesAtRung(houseRules, rung).map((rule) => `${rule.id} (${rung})`)
      ),
    },
    {
      ...integrateDepsFor(api, root, order.id),
      // The shipping decision, where the grade calls for one, is the operator's
      // and reaches them through the inbox like every other.
      decide: async (gate) => {
        await gates.save(gate)
        return 'hold'
      },
      raiseGate: async (gate) => {
        await gates.save(gate)
      },
      // A recipe with no `ci` never asks to watch anything (`rounds: null`
      // makes `ciRounds` return `{ kind: 'none' }` without a single poll).
      watchCi: (pulls) =>
        ciRounds({
          pulls: pulls.map((pull) => ({ url: pull.url, cwd: pull.cwd })),
          rounds: recipe.ci?.rounds ?? null,
          ...ciRoundDepsFor(root, order.id, exec),
          sendBack: ciSendBackFor(
            root,
            shippedOrder,
            recipe,
            executorDeps,
            integrateDepsFor(api, root, order.id),
            graphRef
          ),
        }),
    }
  )

  if (shipped.held || shipped.pulls.length === 0) return

  await store.save({ ...order, status: 'shipped' })
  if (issuesPort !== null) {
    await writeBack(order, 'draft_opened', writeBackDepsFor(api, root, order, issuesPort), {
      pulls: shipped.pulls.map((pull) => ({ repo: pull.repo, url: pull.url })),
    })
  }
}

/**
 * One turn of intake, in a session the operator can see and type into.
 *
 * The architect runs read-only in the order's lane checkout — the one its
 * lanes will build in — so the whole order is one sidebar project (ADR-061).
 * It writes one file, and that file is
 * validated before any of it reaches the order — an agent that could write the
 * order directly could set its status and agree its own work.
 *
 * Resolves as soon as the architect is *running*, not when it finishes: a turn
 * takes minutes, and a channel that waited would hold the bridge for all of
 * them while the surface spun on a promise.
 */
async function convergeOnce(
  api: ExtensionAPI,
  root: string,
  order: WorkOrder,
  message: string,
  onFinished: (outcome: ConvergeOutcome) => Promise<void>
): Promise<ConvergeStarted> {
  const runner = supervisedRunner
  if (runner === null) {
    return { ok: false, reason: 'The supervision runtime is not running, so intake cannot start.' }
  }

  const sources = resolveSources(api, root)
  let plan
  try {
    plan = convergeBrief({
      order,
      root,
      sources,
      rules: rulesFor(sources, {
        repoPaths: sources.repoPaths,
        houseDocs: [...order.context.houseDocs],
      }).rules,
      message,
    })
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }

  const featureDir = orderDir(root, order.id)
  await fs.promises.mkdir(featureDir, { recursive: true })

  // The lane's own checkout, so the order is one project from its first turn
  // (ADR-061) and the architect reads the base the builder will change.
  let checkout: Checkout
  try {
    checkout = await ensureCheckout(order, 1, { exec: (o) => api.shell.exec(o), root })
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }

  // One conversation per order, so a follow-up does not make the architect
  // read the repository again to answer "why not the other approach".
  //
  // The recorded one is the fallback: the in-memory map dies with the process,
  // and an order reopened after a restart should still know which conversation
  // produced it.
  const resuming = intakeSessions.get(order.id) ?? order.provenance.forgeSession ?? undefined

  /**
   * Write the conversation onto the order.
   *
   * `provenance.forgeSession` existed and nothing ever set it, so the Forge's
   * "Attach" — the way back into the conversation that wrote the plan — had
   * nothing to attach to and was never rendered.
   */
  const rememberSession = (sessionId: string): void => {
    intakeSessions.set(order.id, sessionId)
    void createOrderStore(root)
      .load(order.id)
      .then(async (current) => {
        if (current === null || current.provenance.forgeSession === sessionId) return
        await createOrderStore(root).save({
          ...current,
          provenance: { ...current.provenance, forgeSession: sessionId },
        })
      })
      .catch(() => {
        // A record of which conversation this was is a courtesy. Losing it
        // must not fail the intake it is describing.
      })
  }

  return new Promise<ConvergeStarted>((resolve) => {
    let answered = false
    const answer = (started: ConvergeStarted): void => {
      if (answered) return
      answered = true
      resolve(started)
    }
    let done = false
    /**
     * Take the proposal, if there is one to take.
     *
     * A turn ending is not the architect finishing: it thinks, replies, asks
     * something, and may write on a later turn. Reading at the first turn end
     * reported "the architect wrote no proposal" while it was still working,
     * so a turn only counts when the file is actually there. The session
     * ending is the deadline — then the answer is whatever it left, including
     * nothing.
     */
    const collect = (deadline: boolean, code: number | null): void => {
      if (done) return
      if (!deadline && !fs.existsSync(plan.proposalPath)) return
      done = true
      // The session is over either way, so it must not be resumed: `--resume`
      // on one the runtime has forgotten silently starts a fresh agent that
      // believes it is continuing.
      if (deadline) intakeSessions.delete(order.id)
      void onFinished(
        !deadline || code !== null
          ? readProposal(order, plan.proposalPath, new Date().toISOString())
          : { ok: false, reason: 'The architect could not be started.' }
      )
      answer({ ok: false, reason: 'The architect ended before it started.' })
    }

    trustRepository(api, plan.cwd, order.id, createOrderStore(root))

    void runner
      .start({
        featureDir,
        worktreePath: checkout.path,
        workspaceId: workspaceFor(api.workspace?.list() ?? [], checkout.origin),
        branch: checkout.branch,
        issue: issueOf(order),
        prompt: plan.prompt,
        phase: 'architect' as never,
        resumeSessionId: plan.role.allowResume ? resumableIn(checkout.path, resuming) : undefined,
        model: modelForTier(api, plan.role.modelTier),
        // Read-only, enforced by the hook rather than by the prompt. The
        // architect proposes; it does not edit the repository it is reading.
        // Its one exception is the proposal itself, and only at that path.
        autoDecide: (tool, toolInput) => {
          const target = (toolInput as { file_path?: unknown } | null)?.file_path
          if (typeof target === 'string' && target === plan.proposalPath) return { allow: true }
          const decision = decideReadOnly(tool, toolInput)
          // Both ways, never abstaining — see the run path above. An allowed
          // read held for five minutes is the same as a refused one, from the
          // agent's side.
          return { allow: decision.allow, reason: decision.reason }
        },
        // Intake is where questions belong, so one asked here is not a defect
        // — it is the Forge working.
        onPending: (pending) => notePending(api, { ...pending, featureDir }),
        onResolved: (requestId) => noteResolved(requestId),
        onAutoDenied: (tool, reason) =>
          supervision?.feed.post({
            at: Date.now(),
            sessionId: intakeSessions.get(order.id) ?? order.id,
            author: 'console',
            summary: `refused ${tool}: ${reason}`,
          }),
        onRegistered: (run) => {
          rememberSession(run.sessionId)
          answer({ ok: true, sessionId: run.sessionId })
        },
        onTurnEnd: () => collect(false, 0),
        onEnd: (exitCode) => collect(true, exitCode),
      })
      .then((run) => {
        if (run === null) {
          collect(true, null)
          return
        }
        rememberSession(run.sessionId)
        answer({ ok: true, sessionId: run.sessionId })
      })
      .catch((error: unknown) => {
        done = true
        intakeSessions.delete(order.id)
        answer({
          ok: false,
          reason: error instanceof Error ? error.message : 'The architect could not be started.',
        })
      })
  })
}

/**
 * A tool call is being held, and somebody has to see it.
 *
 * The one thing allowed to interrupt: the run is stopped dead until it is
 * answered, and a request nobody sees is a twelve-hour hang. This used to live
 * inside a sink that nothing called, so every held call was silent.
 */
function notePending(api: ExtensionAPI, ask: PendingAsk, order?: OrderRef): void {
  pendingPermissions.add(ask)

  // A question asked *during execution* is a defect of intake (FR-083): the
  // Forge is where questions are supposed to be settled, and one arriving now
  // means the order was handed off with something unanswered in it. Recorded
  // against the order as well as answered — answering it alone loses the fact
  // that it should never have been asked here.
  if (order !== undefined && (ask.questions?.length ?? 0) > 0) {
    void createOrderStore(order.root).record({
      at: new Date().toISOString(),
      orderId: order.id,
      actor: 'rule:forge-defect',
      action: 'intake.defect',
      subject: ask.sessionId,
      reason: `asked during execution, which intake should have settled: ${ask.questions
        ?.map((q) => q.question)
        .join('; ')}`,
      evidence: [{ kind: 'stdout', excerpt: ask.summary }],
    })
  }
  const notification = notify(
    api,
    { kind: 'permission_requested', sessionId: ask.sessionId },
    `${path.basename(ask.featureDir)} is asking: ${ask.summary}`,
    [
      {
        id: 'allow',
        label: 'Allow',
        handler: () => supervisedRunner?.resolve(ask.sessionId, ask.requestId, { allow: true }),
      },
      {
        id: 'deny',
        label: 'Deny',
        handler: () => supervisedRunner?.resolve(ask.sessionId, ask.requestId, { allow: false }),
      },
    ],
    // Opening the thing is not a third answer to the question; it is what
    // clicking the notification should do.
    () => gotoRun(api, 'run', ask.sessionId)
  )
  if (notification !== null) raisedNotifications.set(ask.requestId, notification)
}

/** Which order a held tool call belongs to, so a question can be recorded. */
interface OrderRef {
  readonly id: string
  readonly root: string
}

/** Answered, by whoever. The notification goes with the request. */
function noteResolved(requestId: string): void {
  pendingPermissions.remove(requestId)
  // A notification left behind after the thing it was about is answered
  // teaches you to dismiss without reading.
  raisedNotifications.get(requestId)?.dispose()
  raisedNotifications.delete(requestId)
}

export function activate(api: ExtensionAPI): void {
  // Kept, so a phase can wait for it. Activation cannot be async — the host
  // calls it synchronously — but a dispatch that arrives in the meantime used
  // to find no supervised runner and fall back to a headless
  // `bypassPermissions` spawn: an invisible agent approving its own tool calls,
  // which is the whole thing this replaced.
  runtimeStarting = startSupervisionRuntime(api)
  void runtimeStarting

  // ── The Forge ──────────────────────────────────────────────────────────
  //
  // An idea or a tracker issue in, a compilable work order out. The three
  // channels are built over a store, a clock and a way to read an issue, so
  // the whole intake path is exercisable without an Electron host.
  //
  // The data root is resolved once here and handed down as an absolute path:
  // an order can span repositories, so "the working directory" is ambiguous
  // and two writers resolving it independently could disagree.
  const dataRoot = (): string => resolveFoundryDataRoot(api)

  // Said once, and only when the default location is in use. Foundry will not
  // add the ignore entry itself — that would be editing a file no order asked
  // to change — so the operator is told what it costs and what avoids it.
  noteUntrackedDataRoot(api, dataRoot())
  const issuesPort = issuesPortFor(api)

  // ── Sensors (ADR-066) ────────────────────────────────────────────────────
  //
  // Signals read the product back into the factory while the app is open. One
  // tick a minute, over whichever sensors are enabled and have a repository —
  // nothing runs while none are, which is the default. Resolved on every tick
  // rather than once, the same reason `dataRoot` is a function: the records
  // location, and which repository each sensor watches, both follow the
  // operator's own configuration.
  const signalStore = liveSignalStore(dataRoot)
  sensorTimer = setInterval(() => {
    void tickSensors(api, dataRoot(), signalStore)
  }, 60_000)
  // R4: watch for merges, restack what queued behind, recheck it.
  refineryTimer = setInterval(() => {
    void runRefineryTick(api, dataRoot())
  }, 60_000)
  // Where every surface's answer to "what is this order doing" comes from.
  //
  // Assembled once and handed to both the order list and the Floor, because
  // the alternative was tried and shipped: each surface worked it out from
  // whatever it happened to hold, so the same order halted at an undecided
  // gate read "ready to hand off" in the list and drew `building` chips on
  // the Floor, and neither of them named the gate.
  const standingSources: StandingSources = {
    graphFor: (orderId) => readRunGraph(dataRoot(), orderId),
    gatesFor: async (orderId) =>
      (await createGateStore(dataRoot()).list()).filter((gate) => gate.orderId === orderId),
    // A run belongs to a card whose directory is named for the order, which is
    // the join between the runtime's bookkeeping and the records'.
    asksFor: (orderId) =>
      pendingPermissions.list().filter((ask) => path.basename(ask.featureDir) === orderId).length,
    // Shadow firings are recorded and deliberately never notified. A standing
    // is a notification, so a shadow firing is not one.
    stallsFor: (orderId) =>
      stallFirings.filter((s) => !s.shadow && path.basename(s.featureDir) === orderId).length,
    // Only counted while the process is still there: an agent that was
    // stranded and has since died is orphaned, which is a different sentence
    // with a different move.
    strandedFor: (orderId) =>
      [...strandedAgents.values()].filter(
        (a) => a.orderId === orderId && isLiveSession(a.sessionId)
      ).length,
    // Not a record on disk: an agent's terminal is a child of this process, so
    // only this process can say whether one is still there.
    orphansFor: (orderId, graph) =>
      executingOrders.has(orderId) ? [] : orphanedNodes(graph, isLiveSession).map((n) => n.id),
  }

  /**
   * One architect turn, and the ones the Forge starts on its own after it.
   *
   * A plan that still fails a check the architect can close goes straight
   * back to it, up to MAX_AUTO_TURNS times, instead of waiting for someone to
   * click "Ask for the gap to be closed" (spec 062). Only unanswered questions,
   * or a plan still failing when the turns run out, reach the operator.
   */
  const convergeWithFollowUps = (
    order: WorkOrder,
    message: string,
    autoTurns: number
  ): Promise<ConvergeStarted> =>
    convergeOnce(api, dataRoot(), order, message, async (outcome) => {
      const store = createOrderStore(dataRoot())
      if (!outcome.ok) {
        await store.record({
          at: new Date().toISOString(),
          orderId: order.id,
          actor: 'role:architect',
          action: 'converge.refused',
          subject: order.id,
          reason: outcome.reason,
          evidence: [],
        })
        // Out loud, once, because a refusal changes nothing and therefore
        // shows up nowhere the operator happens to be looking. The Forge
        // renders it whenever they open the order; this is for the minutes
        // between the turn ending and them going back to look — which on
        // the run that found this was the rest of the afternoon.
        api.notifications.showToast(
          'warning',
          `${order.title}: the architect's plan was refused and nothing changed.`,
          `foundry.converge.refused.${order.id}`
        )
        return
      }
      await store.save(outcome.order)
      await store.record({
        at: new Date().toISOString(),
        orderId: order.id,
        actor: 'role:architect',
        action: 'order.redrafted',
        subject: order.id,
        reason: outcome.note === '' ? 'redrafted the plan' : outcome.note,
        evidence: [],
      })

      const next = followUpFor(compileOrder(outcome.order).failures, autoTurns)
      if (next === null) return
      // The finished turn's process is still at its prompt; the follow-up
      // resumes the same conversation, so end it first.
      const previous = intakeSessions.get(order.id)
      if (previous !== undefined) {
        await endAndWait(
          {
            stop: (id, reason) => supervisedRunner?.stop(id, reason) ?? false,
            isLive: isLiveSession,
          },
          previous,
          'continuing in a follow-up turn'
        )
      }
      const started = await convergeWithFollowUps(outcome.order, next, autoTurns + 1)
      await store.record({
        at: new Date().toISOString(),
        orderId: order.id,
        actor: 'role:architect',
        action: started.ok ? 'converge.followed_up' : 'converge.refused',
        subject: started.ok ? started.sessionId : order.id,
        reason: started.ok ? 'closing the failing checks on its own' : started.reason,
        evidence: [],
      })
    })

  const forge = createForgeChannels({
    store: createLiveOrderStore(dataRoot),
    dataRoot,
    now: () => new Date().toISOString(),
    standingSources,
    writeBackDefault: () => defaultWriteBack(api),
    budgetDefaults: () => defaultBudgets(api),
    criticalPaths: () => declaredCriticalPaths(api),
    priorArtFor: (paths) => priorArtFor(dataRoot(), paths),
    // The redraft lands here, when the architect's turn ends — minutes after
    // the channel that started it answered.
    converge: (order, message) => convergeWithFollowUps(order, message, 0),
    // FR-059a: asked when the order is agreed, so an issue that will never
    // move is known before the run rather than after it.
    capability:
      issuesPort === null
        ? undefined
        : (order) => checkCapability(order, writeBackDepsFor(api, dataRoot(), order, issuesPort)),
    onAgreed:
      issuesPort === null
        ? undefined
        : async (order) => {
            await writeBack(order, 'agreed', writeBackDepsFor(api, dataRoot(), order, issuesPort))
          },
    readIssue: async (tracker, key) => {
      // Through the application's own tracker connection. This extension never
      // holds a credential and never contacts a tracker itself. A host with no
      // tracker connected answers "no issue" rather than throwing.
      const issue = await api.issues?.get(tracker, key)
      if (issue === null || issue === undefined) return null
      return {
        key: issue.key,
        title: issue.title,
        description: issue.description ?? '',
        url: issue.url ?? '',
        branchName: (issue as { branchName?: string | null }).branchName ?? null,
      }
    },
    queueEntries: () => computeQueueEntries(api, dataRoot()),
  })
  // Your tickets, so a ticket can be picked rather than typed from memory.
  //
  // The Forge has always taken a tracker key, and the only way to give it one
  // was to know it already. The host lists and searches issues — `listMine`
  // and `search` have been there the whole time — and nothing here asked.
  // Importing work is the front door of a tool that does work, and it did not
  // have one.
  reg(api, 'foundry:issues.mine', async (payload) => {
    const issues = api.issues
    if (issues === undefined) return { connected: [], issues: [] }
    const term =
      typeof (payload as { term?: unknown })?.term === 'string'
        ? ((payload as { term: string }).term ?? '').trim()
        : ''
    try {
      const connected = await issues.connections()
      // Nothing connected is a real answer and not an error: the surface says
      // so rather than showing an empty list that looks like "no tickets".
      if (connected.length === 0) return { connected: [], issues: [] }
      const found =
        term === ''
          ? await issues.listMine({ limit: 50 })
          : await issues.search(term, { limit: 50 })
      return {
        connected: connected.map((c) => ({
          tracker: String(c.tracker),
          account: String(c.account ?? ''),
        })),
        issues: (found.issues ?? []).map((issue) => ({
          tracker: String(issue.tracker),
          key: String(issue.key),
          title: String(issue.title ?? ''),
          status: String((issue as { status?: unknown }).status ?? ''),
        })),
        failures: (found.failures ?? []).map((f) =>
          String((f as { message?: unknown }).message ?? f)
        ),
      }
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Could not read your tickets.' }
    }
  })
  // A ticket for a typed idea, offered before it becomes an order (spec 061).
  reg(api, 'foundry:ticket.offer', async () => ({ offer: await ticketOffer(api.issues) }))
  reg(api, 'foundry:ticket.create', async (payload) => {
    const { idea, teamId } = (payload ?? {}) as { idea?: unknown; teamId?: unknown }
    if (typeof idea !== 'string' || typeof teamId !== 'string' || api.issues === undefined) {
      return { error: 'Malformed request.' }
    }
    return fileTicket(api.issues, { idea, teamId })
  })
  reg(api, 'foundry:order.create', (payload) => forge.create(payload))
  reg(api, 'foundry:order.turn', (payload) => forge.turn(payload))
  reg(api, 'foundry:order.compile', (payload) => forge.compile(payload))
  reg(api, 'foundry:order.list', () => forge.list())
  reg(api, 'foundry:order.states', (payload) => forge.states(payload))
  reg(api, 'foundry:order.mapState', (payload) => forge.mapState(payload))
  reg(api, 'foundry:order.converge', (payload) => forge.converge(payload))
  reg(api, 'foundry:order.writeBack', (payload) => forge.setWriteBack(payload))
  reg(api, 'foundry:order.budgets', (payload) => forge.setBudgets(payload))
  reg(api, 'foundry:order.cancel', (payload) => forge.cancel(payload))

  // Gone, rather than hidden.
  //
  // `order.cancel` marks an order `cancelled` and drops it off the list, and
  // leaves its directory, its ledger, its worktree and its branch exactly
  // where they were — so the records location and the target repository fill
  // up with work nobody can reach or restart. This is the other answer.
  reg(api, 'foundry:order.delete', async (payload) => {
    const { id } = payload as { id?: unknown }
    if (typeof id !== 'string' || id === '') return { error: 'Malformed request.' }

    const root = dataRoot()
    const order = await createOrderStore(root).load(id)
    if (order === null) return { error: `No order ${id}.` }

    // Its agents first. Deleting the records out from under a live session
    // leaves an agent writing into a worktree whose order no longer exists.
    await stopOrder(root, id, 'the order was deleted')
    // The architect too: it runs in the checkout about to be removed, and the
    // run graph that `stopOrder` reads does not know about it.
    const intake = intakeSessions.get(id)
    if (intake !== undefined) {
      supervisedRunner?.stop(intake, 'the order was deleted')
      intakeSessions.delete(id)
    }
    const result = await deleteOrder(order, {
      exec: (o) => api.shell.exec(o),
      root,
      removeProjectAt: projectRemover(api.workspace),
    })
    return { ok: result.failed.length === 0, removed: result.removed, failed: result.failed }
  })

  // ── The Line ───────────────────────────────────────────────────────────
  //
  // An agreed order plus a shape of work becomes a run graph. Everything that
  // can refuse does so before any agent starts: the order has to be agreed,
  // the shape has to be one this repository can actually support, and the
  // records location has to be writable.
  const runs = createRunChannels({
    store: createLiveOrderStore(dataRoot),
    dataRoot,
    sources: () => resolveSources(api, dataRoot()),
    // One person's capacity to review is the constraint, and it does not scale
    // with the number of orders. No runtime means nobody to ask, which is not
    // a reason to refuse a run.
    backpressure: () =>
      supervision?.backpressure.check() ?? { allowed: true, unreviewed: 0, limit: 0, reason: null },
    noteOverride: (orderId) => supervision?.backpressure.override(orderId, Date.now()),
    now: () => new Date().toISOString(),
    // Marked while it runs, so nothing reclaims a node out from under an
    // executor that is part way through starting it.
    execute: async (order, recipe, graph) => {
      executingOrders.add(order.id)
      try {
        await executeRun(api, dataRoot(), order, recipe, graph)
      } finally {
        executingOrders.delete(order.id)
      }
    },
    isLive: isLiveSession,
    executing: (orderId) => executingOrders.has(orderId),
    gatesFor: standingSources.gatesFor,
    asksFor: standingSources.asksFor,
    stallsFor: standingSources.stallsFor,
    strandedFor: standingSources.strandedFor,
    // The sessions themselves, so the band can offer the one thing that
    // answers a handed-back call: going to the terminal it was handed to.
    strandedSessions: (orderId) =>
      [...strandedAgents.values()]
        .filter((a) => a.orderId === orderId && isLiveSession(a.sessionId))
        .map((a) => a.sessionId),
    // What each agent has been doing, for the Factory view's activity
    // markers. Read from the same transcript file the stall detector tails —
    // no session means nothing to report, not an error.
    activityFor: (sessionId) => {
      const run = supervision?.runs.get(sessionId)
      return run ? readTranscript(run.transcriptPath) : []
    },
    queueEntries: () => computeQueueEntries(api, dataRoot()),
  })
  reg(api, 'foundry:run.start', (payload) => runs.start(payload))
  reg(api, 'foundry:run.resume', (payload) => runs.resume(payload))
  // Stop the whole order, as opposed to one agent.
  //
  // `foundry:run-stop` ends one session; this ends the run. The distinction is
  // the reason a dead run could never be got rid of: the only order-level stop
  // was a gate option that did nothing, and `order.cancel` refuses a running
  // order and points back at that gate.
  reg(api, 'foundry:run.stop', async (payload) => {
    const { id } = payload as { id?: unknown }
    if (typeof id !== 'string' || id === '') return { error: 'Malformed request.' }
    await stopOrder(dataRoot(), id, 'stopped by the operator')
    return { ok: true }
  })
  // Start the same order over.
  //
  // Stop whatever is still running, destroy everything the run made — every
  // lane's checkout and branch, the graph, the gates, the rung outputs — and
  // put the order back to `agreed` so it can be run again from node zero. The
  // ask, the criteria and the plan survive, which is the whole difference
  // between this and making a fourth order for the same sentence.
  reg(api, 'foundry:run.reset', async (payload) => {
    const { id } = payload as { id?: unknown }
    if (typeof id !== 'string' || id === '') return { error: 'Malformed request.' }

    const root = dataRoot()
    const store = createOrderStore(root)
    const order = await store.load(id)
    if (order === null) return { error: `No order ${id}.` }

    await stopOrder(root, id, 'starting over')
    const result = await tearDownRun(order, {
      exec: (o) => api.shell.exec(o),
      root,
      removeProjectAt: projectRemover(api.workspace),
    })

    // Read back rather than reused: `stopOrder` saves, and writing the order
    // we loaded before it would put `running` back.
    const stopped = (await store.load(id)) ?? order
    // Only an agreed order can be started, and only a draft can be agreed —
    // so a reset that left it `cancelled` would be the dead end it exists to
    // undo. It was agreed once and nothing about the agreement changed.
    await store.save({ ...stopped, status: 'agreed', recipe: null, recipeOverriddenBy: null })
    await store.record({
      at: new Date().toISOString(),
      orderId: id,
      actor: 'operator',
      action: 'run.reset',
      subject: id,
      reason:
        result.removed.length === 0
          ? 'started over; there was nothing left to remove'
          : `started over; removed ${result.removed.join(', ')}`,
      evidence: [],
    })
    return { ok: true, removed: result.removed, failed: result.failed }
  })

  reg(api, 'foundry:run.observe', (payload) => runs.observe(payload))
  reg(api, 'foundry:run.recipes', (payload) => runs.recipes(payload))
  reg(api, 'foundry:session.attach', (payload) => runs.attach(payload))
  // What each running node's agent has been doing, for the Factory view.
  reg(api, 'foundry:run.activity', (payload) => runs.activity(payload))
  reg(api, 'foundry:run.timeline', (payload) => runs.timeline(payload))

  // ── The inbox ──────────────────────────────────────────────────────────
  //
  // The one surface the operator is required to visit. Nothing reaches it that
  // a named rule did not raise, which is what makes "nothing needs you" a
  // state worth trusting rather than a state worth double-checking.
  const inbox = createInboxChannels({
    gates: createLiveGateStore(dataRoot),
    orders: createLiveOrderStore(dataRoot),
    autonomy: () => autonomyFor(api),
    now: () => new Date().toISOString(),
    record: async (orderId, action, subject, reason) => {
      await createOrderStore(dataRoot()).record({
        at: new Date().toISOString(),
        orderId,
        actor: 'operator',
        action,
        subject,
        reason,
        evidence: [],
      })
    },
    // What a decision actually does.
    //
    // Two things, and the second is the one that was missing: "mark ready"
    // turns the drafts into review requests, and every other answer that
    // unblocks work puts the run back on. A decision the operator takes that
    // leaves the run stopped is a decision that did nothing.
    act: async (gate, option) => {
      if (gate.rule === 'ready-for-review') {
        if (option !== 'mark_ready') return
        const deps = integrateDepsFor(api, dataRoot(), gate.orderId)
        for (const pull of await readPulls(dataRoot(), gate.orderId)) {
          await markReady(pull, deps)
        }
        // The issue's last move. Marking ready is as close to merged as
        // Foundry gets — it never merges anything itself.
        const order = await createOrderStore(dataRoot()).load(gate.orderId)
        const port = issuesPortFor(api)
        if (order !== null && port !== null) {
          await writeBack(order, 'merged', writeBackDepsFor(api, dataRoot(), order, port))
        }
        return
      }

      // A `ci.red` gate is not the run stopping — the run already finished
      // and shipped a draft. "Another round" is one more watch-fail-rework
      // cycle against the drafts that already exist, not a resume of a graph
      // that has nothing left waiting on it.
      if (gate.rule === 'ci.red') {
        if (option !== 'send_back') return
        const root = dataRoot()
        const order = await createOrderStore(root).load(gate.orderId)
        if (order === null || order.recipe === null) return
        const resolved = resolveRecipe(order.recipe, resolveSources(api, root))
        if (!resolved.ok) return
        const recipe = resolved.resolved.value
        const graph = await readRunGraph(root, gate.orderId)
        if (graph === null) return
        const pulls = await readPulls(root, gate.orderId)
        const { deps: executorDeps, exec } = await buildExecutorDeps(
          api,
          root,
          order,
          recipe,
          graph
        )
        const integrateDeps = integrateDepsFor(api, root, order.id)
        const graphRef = { current: graph }
        const outcome = await ciRounds({
          pulls: pulls.map((pull) => ({ url: pull.url, cwd: pull.cwd })),
          rounds: 1,
          ...ciRoundDepsFor(root, order.id, exec),
          sendBack: ciSendBackFor(root, order, recipe, executorDeps, integrateDeps, graphRef),
        })
        const gates = createLiveGateStore(dataRoot)
        await finishShipping(
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
        return
      }

      // `stop` now stops. Every gate offering it promised the order would be
      // cancelled and nothing did it — the run stayed `running` for ever, and
      // `order.cancel` refuses a running order and points back at this gate.
      if (option === 'stop') {
        await stopOrder(dataRoot(), gate.orderId, `stopped at the ${gate.rule} gate`)
        return
      }

      // `hold` means what it says: the run stays stopped until the operator
      // comes back to it. Everything else is a decision to carry on.
      if (option === 'hold') return
      await runs.resume({
        id: gate.orderId,
        // "Send back" is a retry of the node that failed; the others resume
        // whatever the wave was doing.
        retry: option === 'send_back' && gate.nodeId !== null ? [gate.nodeId] : [],
      })
    },
  })
  reg(api, 'foundry:inbox.list', async () => {
    // Before the list is composed, not after: a run the last application left
    // in flight has to be on it the first time it is read, not the second.
    await adoptInterruptedRuns(dataRoot())
    return inbox.list()
  })
  reg(api, 'foundry:inbox.decide', (payload) => inbox.decide(payload))

  // How much is waiting for the operator, and where.
  //
  // Read by the surfaces themselves so the answer to "is anything waiting" is
  // on screen wherever you are. Foundry holds work in three places and used to
  // announce it on none of them: an open question sat third down the Forge's
  // rail and a held tool call sat under a whole run graph, so the only way to
  // find either was to already be looking at it.
  const attentionGates = createLiveGateStore(dataRoot)
  const attentionOrders = createLiveOrderStore(dataRoot)
  reg(api, 'foundry:attention', async () => {
    // The chrome polls this from the moment the application opens, which makes
    // it the earliest place a run the last one left behind can be noticed. A
    // dead run that announces itself in four seconds is the whole difference
    // between this and finding out hours later that nothing had moved.
    await adoptInterruptedRuns(dataRoot())
    return countAttention({
      gates: await attentionGates.list(),
      autonomy: autonomyFor(api),
      orders: await attentionOrders.list(),
      pendingAsks: pendingPermissions.list().length,
    })
  })

  // ── The record ─────────────────────────────────────────────────────────
  //
  // Every decision, by whom or by what rule, and why. The one place the
  // factory ever argues back — and only when asked: `rules.propose` is a
  // channel the operator's own button reaches, never a subscription and never
  // anything the append path can trigger.
  const ledger = createLedgerChannels({
    store: createLiveOrderStore(dataRoot),
    dataRoot,
    existingRuleIds: () => {
      const sources = resolveSources(api, dataRoot())
      return rulesFor(sources, { repoPaths: sources.repoPaths, houseDocs: [] }).rules.map(
        (rule) => rule.id
      )
    },
    // Read by rung rather than by applicability: a check the operator accepted
    // is theirs to remove whether or not it applies to the repository they
    // happen to have open.
    acceptedRules: () => {
      const sources = resolveSources(api, dataRoot())
      return availableNames('rules', sources).flatMap((name) => {
        const resolved = resolveRule(name, sources)
        if (!resolved.ok || resolved.resolved.rung !== 'data-root') return []
        return [
          {
            id: resolved.resolved.value.id,
            asserts: resolved.resolved.value.asserts,
            rung: resolved.resolved.rung,
            origin: resolved.resolved.value.origin,
          },
        ]
      })
    },
    sources: () => resolveSources(api, dataRoot()),
    now: () => new Date().toISOString(),
  })
  reg(api, 'foundry:ledger.query', (payload) => ledger.query(payload))
  reg(api, 'foundry:factory.metrics', (payload) => ledger.factoryMetrics(payload))
  reg(api, 'foundry:rules.propose', (payload) => ledger.proposeRules(payload))
  reg(api, 'foundry:rules.decide', (payload) => ledger.decideProposal(payload))
  reg(api, 'foundry:rules.inForce', (payload) => ledger.rulesInForce(payload))
  reg(api, 'foundry:rules.remove', (payload) => ledger.removeAcceptedRule(payload))

  // ── Signals (ADR-066) ────────────────────────────────────────────────────
  const sensors = createSensorChannels({
    store: signalStore,
    orderStore: createLiveOrderStore(dataRoot),
    availableSensors: () => availableSensors(resolveSources(api, dataRoot())),
    collectDepsFor: (repoPath) => sensorCollectDepsFor(api, repoPath),
    now: () => new Date().toISOString(),
    newId: () => newOrderId(new Date()),
  })
  reg(api, 'foundry:signals.list', (payload) => sensors.list(payload))
  reg(api, 'foundry:signals.dismiss', (payload) => sensors.dismiss(payload))
  reg(api, 'foundry:signals.promote', (payload) => sensors.promote(payload))
  reg(api, 'foundry:sensors.list', (payload) => sensors.sensorsList(payload))
  reg(api, 'foundry:sensors.set', (payload) => sensors.sensorsSet(payload))
  reg(api, 'foundry:sensors.run-now', (payload) => sensors.sensorsRunNow(payload))

  // What a supervised run is waiting on, and how the operator answers it.
  // Without these a phase blocks at its PreToolUse hook until the bridge hands
  // the decision back to the terminal — which works, but makes the console a
  // spectator of its own agents.
  reg(api, 'foundry:permissions-list', () => ({ pending: pendingPermissions.list() }))

  // What can go in the model box, and which one is chosen. Asked for rather
  // than hardcoded in the view, where the last list sat naming a superseded
  // generation until somebody noticed.
  //
  // `selected` comes back with the list because the two must not drift: the
  // settings view keeps its own copy for rendering, and a copy that disagrees
  // with what the runs are actually launched with is worse than no setting.
  reg(api, 'foundry:models-list', async () => ({
    models: await modelCatalog(),
    selected: defaultModel(api),
  }))

  // Persisted where the main process can read it, which is the only place that
  // matters: the launch command is built here, not in the renderer.
  reg(api, 'foundry:model-set', (payload: unknown) => {
    const { model } = payload as { model?: unknown }
    if (typeof model !== 'string') return { error: 'model must be a string' }
    api.settings.set(MODEL_SETTING_KEY, model)
    return { ok: true, selected: model }
  })

  // The firings, and whether they were recorded or surfaced. Precision is
  // measured against these by hand before shadow mode is turned off.
  reg(api, 'foundry:stalls-list', () => ({
    firings: stallFirings,
    shadowMode: stallShadowMode(api),
  }))

  // What is running, what is waiting to be reviewed, and whether a new run
  // would be refused.
  reg(api, 'foundry:supervision-snapshot', () =>
    supervision === null
      ? { runs: [], review: [], backpressure: { allowed: true, unreviewed: 0, limit: 0 } }
      : supervision.snapshot()
  )

  reg(api, 'foundry:feed-list', () => ({
    entries: supervision?.feed.list() ?? [],
    mutes: mutes?.list() ?? [],
  }))

  // Anything shown as a list should be prunable, and a feed you cannot clear a
  // line from is one you stop reading.
  // Validated, because each writes a line that every later read replays: a
  // dismiss with no id appended `{}`, which then read back as a feed entry with
  // no summary and took the Floor down.
  const FeedDismiss = z.object({ id: z.string().min(1) })
  const FeedMute = z
    .object({
      sessionId: z.string().min(1).optional(),
      author: z.enum(['agent', 'console']).optional(),
    })
    .refine((rule) => rule.sessionId !== undefined || rule.author !== undefined)

  reg(api, 'foundry:feed-dismiss', (payload: unknown) => {
    const parsed = FeedDismiss.safeParse(payload)
    if (!parsed.success) return { error: 'Malformed request.' }
    supervision?.feed.removeEntry(parsed.data.id)
    return { ok: true }
  })

  reg(api, 'foundry:feed-mute', (payload: unknown) => {
    const parsed = FeedMute.safeParse(payload)
    if (!parsed.success) return { error: 'Malformed request.' }
    mutes?.add(parsed.data)
    return { mutes: mutes?.list() ?? [] }
  })

  reg(api, 'foundry:feed-unmute', (payload: unknown) => {
    const parsed = FeedMute.safeParse(payload)
    if (!parsed.success) return { error: 'Malformed request.' }
    mutes?.remove(parsed.data)
    return { mutes: mutes?.list() ?? [] }
  })

  // What happened while you were away. Progress posts are rolled up rather
  // than replayed one by one — the point of coming back to a digest is not to
  // read every line the agents wrote.
  reg(api, 'foundry:feed-digest', (payload: unknown) => {
    const { from, to } = payload as { from: number; to?: number }
    const entries = supervision?.feed.list() ?? []
    return buildDigest(entries, from, to ?? Date.now())
  })

  reg(api, 'foundry:review-advance', (payload: unknown) => {
    const { sessionId } = payload as { sessionId: string }
    return { step: supervision?.review.advance(sessionId) ?? null }
  })

  // The unit of review is the hunk, not the file: one file routinely holds both
  // the change you asked for and the one you did not.
  reg(api, 'foundry:review-hunks', async (payload: unknown) => {
    const { sessionId } = payload as { sessionId: string }
    if (supervision === null) {
      // Distinguished from "changed nothing": a panel that cannot tell them
      // apart shows an empty review for a runtime that never started.
      return { files: null, complete: false, fullReject: false }
    }
    const set = await supervision.hunksFor(sessionId)
    if (set === null) return { files: [], complete: false, fullReject: false }
    // Grouped by file, with the hunk's own lines: a reviewer decides on what
    // the change says, and a list of identifiers is not a diff.
    const files = new Map<string, HunkView[]>()
    for (const { hunk, decision } of set.list()) {
      const entry = files.get(hunk.file) ?? []
      entry.push({ id: hunk.id, newStart: hunk.newStart, lines: [...hunk.lines], decision })
      files.set(hunk.file, entry)
    }
    return {
      files: [...files]
        .map(([file, hunks]) => ({ file, hunks }))
        .sort((a, b) => a.file.localeCompare(b.file)),
      complete: set.isComplete(),
      fullReject: set.isFullReject(),
    }
  })

  reg(api, 'foundry:review-decide-hunk', async (payload: unknown) => {
    const { sessionId, hunkId, decision } = payload as {
      sessionId: string
      hunkId: string
      decision: 'accept' | 'reject'
    }
    const ok = (await supervision?.decideHunk(sessionId, hunkId, decision)) ?? false
    return { ok }
  })

  // The request set against the agent's own account of what it did. The step
  // every diff viewer skips, and the one that catches work that is defensible
  // in isolation and was never asked for.
  reg(api, 'foundry:review-intent', async (payload: unknown) => {
    const { sessionId, request, agentAccount } = payload as {
      sessionId: string
      request: string
      agentAccount: string
    }
    const intent = await supervision?.intentFor(sessionId, request, agentAccount)
    return { intent: intent ?? null }
  })

  // Applying the decisions is what makes a rejection mean anything: the
  // rejected hunks come back out of the working copy, the accepted ones stay.
  reg(api, 'foundry:review-apply', async (payload: unknown) => {
    const { sessionId } = payload as { sessionId: string }
    const result = (await supervision?.applyDecisions(sessionId)) ?? {
      ok: false,
      reverted: 0,
      error: 'the supervision runtime is not running',
    }
    if (result.ok && result.reverted > 0) {
      supervision?.feed.post({
        at: Date.now(),
        sessionId,
        author: 'console',
        summary: `reverted ${result.reverted} rejected ${result.reverted === 1 ? 'hunk' : 'hunks'}`,
      })
      // The diff changed under it, so the queue's summary is now wrong.
      await supervision?.measure(sessionId)
    }
    return result
  })

  reg(api, 'foundry:review-done', async (payload: unknown) => {
    const { sessionId } = payload as { sessionId: string }
    supervision?.review.remove(sessionId)
    supervision?.runs.forget(sessionId)
    // Reviewing one reopens the backpressure gate. What starts next is the
    // scheduler's decision now, taken from the run graph rather than from a
    // queue this channel had to remember to drain.
    return { ok: true }
  })

  reg(api, 'foundry:permission-resolve', (payload: unknown) => {
    const { requestId, decision, answer } = payload as {
      requestId: string
      decision: 'allow' | 'deny'
      answer?: string
    }
    const sessionId = pendingPermissions.sessionFor(requestId)
    if (sessionId === null || supervisedRunner === null) {
      // Already answered, already handed back, or the run has ended. Reported
      // rather than swallowed: a click that does nothing is worse than a
      // refusal that says why.
      return { ok: false, reason: 'that request is no longer waiting' }
    }
    const answered = supervisedRunner.resolve(sessionId, requestId, {
      allow: decision === 'allow',
      answer: answer === undefined || answer.trim() === '' ? undefined : answer,
    })
    if (!answered) {
      // The id was still on the board but the bridge had let it go — answered
      // in the terminal, handed back, or the run ended. Saying "ok" left a card
      // showing a request nobody could clear.
      pendingPermissions.remove(requestId)
      return { ok: false, reason: 'that request is no longer waiting' }
    }
    return { ok: true }
  })

  // Hands one back deliberately: the operator would rather answer it in the
  // terminal, where they can see what the agent was doing around it.
  reg(api, 'foundry:permission-hand-back', (payload: unknown) => {
    const { requestId } = payload as { requestId: string }
    const sessionId = pendingPermissions.sessionFor(requestId)
    if (sessionId === null || supervisedRunner === null) return { ok: false }
    supervisedRunner.handBackToTerminal(sessionId, requestId)
    return { ok: true }
  })

  // The four things you do about a run that has stopped making progress, and
  // the one you do about any run. Without these the supervision panel could
  // name a stall and offer nothing — which is the shape of every "correct and
  // useless" surface this line of work exists to stop shipping.

  // Takes you to the terminal the run is in.
  //
  // Done here rather than in the panel: the extension's UI is a separate
  // renderer process, so a store it imports from core is a second copy that
  // nothing renders. `terminal:navigate-to-session` is the core's own channel
  // for this — it selects the workspace, the project and the tab.
  reg(api, 'foundry:run-terminal', (payload: unknown) => {
    const { sessionId } = payload as { sessionId: string }
    const terminal = supervisedRunner?.terminalFor(sessionId) ?? null
    if (terminal === null) return { ok: false }
    api.window.focusSelf()
    api.window.broadcast('terminal:navigate-to-session', {
      sessionId: terminal.terminalSessionId,
      projectId: terminal.projectId,
    })
    return { ok: true }
  })

  // What it was doing, in its own words. The action that decides the others.
  reg(api, 'foundry:run-transcript', (payload: unknown) => {
    const { sessionId, limit } = payload as { sessionId: string; limit?: number }
    const run = supervision?.runs.get(sessionId) ?? null
    if (run === null) return { lines: [] }
    return { lines: readTranscriptTail(run.transcriptPath, limit ?? 40) }
  })

  // Ends the turn and keeps the session, which is what makes the next message
  // land instead of queueing behind whatever it is part-way through.
  reg(api, 'foundry:run-interrupt', (payload: unknown) => {
    const { sessionId } = payload as { sessionId: string }
    if (supervisedRunner === null) return { ok: false }
    supervisedRunner.interrupt(sessionId)
    return { ok: true }
  })

  // Asking it what is wrong, or telling it what to do instead — the same
  // action, and the reason interrupt does not also end the run.
  reg(api, 'foundry:run-redirect', (payload: unknown) => {
    const { sessionId, message } = payload as { sessionId: string; message?: string }
    // Guarded rather than assumed: an IPC payload is whatever the caller sent,
    // and a handler that throws on a missing field takes the channel down for
    // everyone rather than refusing one call.
    if (supervisedRunner === null || typeof message !== 'string' || message.trim() === '') {
      return { ok: false }
    }
    supervisedRunner.interrupt(sessionId)
    const ok = supervisedRunner.send(sessionId, message.trim())
    if (ok) {
      supervision?.runs.setState(sessionId, 'working', Date.now())
      supervision?.feed.post({
        at: Date.now(),
        sessionId,
        author: 'console',
        summary: `redirected: ${message.trim()}`,
      })
    }
    return { ok }
  })

  // Ends the run, saying why first so the agent's own record carries it.
  reg(api, 'foundry:run-stop', (payload: unknown) => {
    const { sessionId, reason } = payload as { sessionId: string; reason?: string }
    if (supervisedRunner === null) return { ok: false }
    const ok = supervisedRunner.stop(sessionId, reason)
    if (ok) {
      supervision?.finish(sessionId, Date.now())
      // Recorded before it leaves the live list, so a run somebody stopped is
      // still answerable later — "what was it doing when I killed it".
      supervision?.runs.archive(sessionId, 'stopped', Date.now())
    }
    return { ok }
  })

  // Track terminal sessions for the session-list IPC
  if (api.terminal?.onSessionCreate) {
    disposables.push(
      api.terminal.onSessionCreate((session) => {
        activeSessions.set(session.id, { id: session.id, name: session.tabTitle })
      })
    )
  }
  if (api.terminal?.onSessionClose) {
    disposables.push(
      api.terminal.onSessionClose((sessionId) => {
        activeSessions.delete(sessionId)
      })
    )
  }

  disposables.push(
    api.settings.register({
      label: 'Foundry',
      description:
        'A software factory. Foundry writes nothing into the repositories it works on — its own records go wherever you point them below.',
      properties: {
        // Where the records go (FR-074). Empty means <workdir>/.foundry, which
        // leaves an untracked directory behind in every repository you run an
        // order in; Foundry says so once and never edits your .gitignore.
        // Setting one location avoids it, and is the only workable answer once
        // an order spans repositories.
        'terminator.foundry.dataDir': {
          type: 'folder',
          label: 'Where Foundry keeps its records',
          description:
            'Leave empty to write beside each repository, in an untracked .foundry directory. Set one folder and every order writes there instead — recommended, and required in practice for orders that span repositories.',
          default: '',
        },
        // Draft-first shipping (FR-053). Off puts a gate back before the push,
        // which is the old behaviour and is there for repositories where a
        // stray branch is expensive.
        'terminator.foundry.autoOpenDraftPr': {
          type: 'boolean',
          label: 'Open a draft pull request when work finishes',
          description:
            'On: the Line pushes and opens a draft without asking, and your decision becomes "mark it ready" on a real diff. Off: nothing is pushed until you say so.',
          default: true,
        },
        // Which gate rules are live (FR-049). Not a chattiness level: four
        // rules stay live at every setting, so lights-out still cannot merge.
        'terminator.foundry.autonomy': {
          type: 'enum',
          label: 'Autonomy',
          description:
            'Which rules are allowed to stop for you. Risk, budget, destructive actions and the merge decision are live at every setting — at lights-out they refuse rather than wait, because nobody is there to answer.',
          options: ['escorted', 'standard', 'lights-out'],
          default: 'standard',
        },
        'terminator.foundry.budgets.agents': {
          type: 'number',
          label: 'Agents running at once',
          description:
            '0 means no limit. Each new order starts with this, and you can change it on the order.',
          default: 3,
          min: 0,
        },
        'terminator.foundry.budgets.wallClockMinutes': {
          type: 'number',
          label: 'Minutes before an order pauses and asks',
          description:
            'Exceeding a budget pauses the work and raises a decision. It never continues silently, and it never dies silently. 0 means no limit.',
          default: 45,
          min: 0,
        },
        // Three booleans rather than a list: the settings surface has no array
        // type, and each write-back is independently worth turning off.
        'terminator.foundry.writeBack.summaryComment': {
          type: 'boolean',
          label: 'Comment the agreed work order on its source issue',
          default: true,
        },
        'terminator.foundry.writeBack.status': {
          type: 'boolean',
          label: 'Move the source issue as work starts, opens and merges',
          description:
            'Built for Linear. A tracker that cannot be asked to move an issue reports it as unsupported when the order is agreed, and nothing is faked.',
          default: true,
        },
        'terminator.foundry.writeBack.prLink': {
          type: 'boolean',
          label: 'Attach every pull request to the source issue',
          default: true,
        },
        // Operator-declared, never inferred. Per-repository lists live in
        // config.yaml under the data root; this is the workspace-wide list.
        // Named by the operator, never inferred: an MCP server's tools are
        // named by somebody else, and a name is not a contract about writing.
        'terminator.foundry.readOnlyTools': {
          type: 'string',
          label: 'Tools a review may also use, one per line',
          description:
            'The read-only policy refuses any tool it has not been taught about. List the ones you know only read — a documentation lookup, for instance. Foundry never infers this list.',
          default: '',
          workspaceScoped: true,
        },
        'terminator.foundry.criticalPaths': {
          type: 'string',
          label: 'Critical paths, one glob per line',
          description:
            'Touching one of these raises a decision before anything is pushed. Foundry never infers this list.',
          default: '',
          workspaceScoped: true,
        },
        // Written by the extension, not shown: it is how "once" is remembered.
        'terminator.foundry.untrackedNoticeSeen': {
          type: 'boolean',
          label: 'Untracked records notice has been shown',
          default: false,
        },
        'terminator.foundry.stallShadowMode': {
          type: 'boolean',
          label: 'Record stalls without surfacing them',
          description:
            'On by default. A stall detector that cries wolf gets turned off, and then the real stalls go unreported too — judge a week of recorded firings before turning this off.',
          default: true,
        },
        // Per-operator, not per-order: which view draws the order list and the
        // Line (FR — Factory view). Only the Forge surface changes; Inbox,
        // Ledger and Settings are unaffected either way.
        'terminator.foundry.view': {
          type: 'enum',
          label: 'Foundry view',
          description: 'How the Forge surface draws orders and runs.',
          options: ['list', 'factory'],
          default: 'list',
        },
      },
    })
  )

  // Anything but 'factory' reads as 'list' — an unset or corrupted setting is
  // the same as never having chosen the newer view.
  const viewSetting = (): 'list' | 'factory' =>
    api.settings.get<string>('terminator.foundry.view') === 'factory' ? 'factory' : 'list'

  reg(api, 'foundry:ui.view', () => ({ view: viewSetting() }))

  reg(api, 'foundry:ui.set-view', (payload: unknown) => {
    const { view } = (payload ?? {}) as { view?: unknown }
    if (view !== 'list' && view !== 'factory') return { error: 'Malformed request.' }
    api.settings.set('terminator.foundry.view', view)
    api.window.broadcast('foundry:ui.view-changed', { view })
    return { view }
  })

  // Renderer calls this on mount to pick up an intake request triggered
  // before the main view existed.
  reg(api, 'foundry:ui.consume-pending-new-order', () => {
    const pending = pendingNewOrder
    pendingNewOrder = false
    if (pendingNewOrderTimer !== null) {
      clearTimeout(pendingNewOrderTimer)
      pendingNewOrderTimer = null
    }
    return { pending }
  })

  disposables.push(
    api.commands.register(
      {
        id: 'new-order',
        label: 'New work order…',
        category: 'Foundry',
        mnemonic: 'n',
      },
      () => {
        api.window.showSelf('main')
        // Broadcast to an already-running view immediately, and set a pending
        // flag for one that has not been created yet — the same shape as
        // Notepad's quick-create, because a command run before the extension's
        // own view exists is otherwise silently dropped.
        api.window.broadcast('foundry:ui.open-new-order', {})
        pendingNewOrder = true
        if (pendingNewOrderTimer !== null) clearTimeout(pendingNewOrderTimer)
        pendingNewOrderTimer = setTimeout(() => {
          pendingNewOrder = false
          pendingNewOrderTimer = null
        }, 5000)
      }
    )
  )

  disposables.push(
    api.commands.register(
      {
        id: 'toggle-view',
        label: 'Toggle factory view',
        category: 'Foundry',
        mnemonic: 'v',
      },
      () => {
        const next = viewSetting() === 'factory' ? 'list' : 'factory'
        api.settings.set('terminator.foundry.view', next)
        api.window.showSelf('main')
        api.window.broadcast('foundry:ui.view-changed', { view: next })
      }
    )
  )
}

/**
 * Puts what is running, and what is waiting to be reviewed, one keystroke away.
 *
 * Three surfaces answer the same question — what needs me, ranked — and this is
 * the one you reach without moving your hands.
 */
/**
 * Take me to the run this is about.
 *
 * The window first: navigation that changes what is on screen behind another
 * window has done nothing you can see. Then the terminal it is actually in,
 * when it still has one — that is where the agent is and where you can type at
 * it. A run that has ended has no terminal, so the panel opened on it is the
 * closest thing to the same place.
 *
 * Shared by the command palette and by clicking a notification, because they
 * are the same request phrased twice, and two copies would drift.
 */
function gotoRun(api: ExtensionAPI, kind: 'run' | 'review', sessionId: string): void {
  api.window.focusSelf()
  const terminal = kind === 'run' ? (supervisedRunner?.terminalFor(sessionId) ?? null) : null
  if (terminal !== null) {
    // Through the core's own navigation: it selects the workspace, the project
    // and the tab, none of which this extension's separate renderer can do.
    api.window.broadcast('terminal:navigate-to-session', {
      sessionId: terminal.terminalSessionId,
      projectId: terminal.projectId,
    })
    return
  }
  api.window.broadcast('foundry:palette-goto', { kind, sessionId })
}

function refreshPalette(api: ExtensionAPI): void {
  const snapshot = supervision?.snapshot() ?? null
  const entries = snapshot === null ? [] : paletteEntries(snapshot.runs, snapshot.review)
  // Rebuilt only when it would read differently, so an open palette is not
  // re-registered under the cursor every tick.
  const signature = entries.map((e) => `${e.id}:${e.description}`).join('|')
  if (signature === paletteSignature) return
  paletteSignature = signature

  for (const registration of paletteRegistrations) registration.dispose()
  paletteRegistrations = entries.map((entry, index) => {
    // Only the single most urgent entry — already worst-state-first — gets the
    // group's 'w' mnemonic; the rest are reachable through search.
    const urgent = index === 0
    const label =
      urgent && (entry.state === 'waiting' || entry.state === 'stalled')
        ? 'Go to the run waiting on you'
        : entry.label
    return api.commands.register(
      {
        id: entry.id,
        label,
        description: entry.description,
        category: entry.category,
        mnemonic: urgent ? 'w' : undefined,
      },
      () => gotoRun(api, entry.kind, entry.sessionId)
    )
  })
}

export function deactivate(): void {
  disposables.forEach((d) => d.dispose())
  disposables.length = 0
  supervision = null
  mutes = null
  // Or a reactivated extension never looks again at what the last session left
  // in a records location it has already seen this process.
  adoptedRoots.clear()
  executingOrders.clear()
  for (const notification of raisedNotifications.values()) notification.dispose()
  raisedNotifications.clear()
  stallWatcher?.stop()
  stallWatcher = null
  if (paletteTimer !== null) clearInterval(paletteTimer)
  paletteTimer = null
  if (sensorTimer !== null) clearInterval(sensorTimer)
  sensorTimer = null
  if (refineryTimer !== null) clearInterval(refineryTimer)
  refineryTimer = null
  for (const registration of paletteRegistrations) registration.dispose()
  paletteRegistrations = []
  paletteSignature = ''
  if (pendingNewOrderTimer !== null) clearTimeout(pendingNewOrderTimer)
  pendingNewOrderTimer = null
  pendingNewOrder = false
  supervisedRunner?.dispose()
  supervisedRunner = null
  void control?.close()
  control = null
}
