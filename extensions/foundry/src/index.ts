import type { ExtensionAPI, Disposable } from '../../../src/main/extensions/api'
import { app } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { modelCatalog } from './state/model-catalog.js'

import { createForgeChannels } from './ipc/forge-channels.js'
import { createRunChannels, writeRunGraph } from './ipc/run-channels.js'
import { createInboxChannels } from './ipc/inbox-channels.js'
import { createLedgerChannels } from './ipc/ledger-channels.js'
import { rulesFor, rulesAtRung } from './verify/rules.js'
import { availableNames, resolveRule } from './recipe/resolve.js'
import { RUNGS } from './verify/ladder.js'
import type { ResolveSources } from './recipe/resolve.js'
import { createLiveGateStore } from './gates/store.js'
import { createOrderStore, createLiveOrderStore } from './order/store.js'
import { markReady, readPulls, shipOrder } from './line/integrate.js'
import type { ShellExec } from './line/integrate.js'
import { ensureCheckouts } from './line/worktree.js'
import { convergeBrief, readProposal } from './forge/converge.js'
import type { ConvergeOutcome, ConvergeStarted } from './ipc/forge-channels.js'
import { execute } from './line/executor.js'
import type { StartedRun } from './line/executor.js'
import type { RunGraph, RunNode } from './line/run-graph.js'
import type { Recipe } from './recipe/parse.js'
import { decideReadOnly } from './runtime/read-only-policy.js'
import { decideByAutonomy } from './runtime/autonomy-policy.js'
import type { IntegrateDeps } from './line/integrate.js'
import { checkCapability, writeBack } from './trackers/write-back.js'
import type { IssuesPort, WriteBackDeps } from './trackers/write-back.js'
import type { WorkOrder, WriteBack } from './order/schema.js'
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
import { rungExitCode } from './runtime/transcript-tailer.js'
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
// What is running, what it changed, what needs looking at, and what must not
// start yet.
let supervision: Supervision | null = null
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
function defaultBudgets(api: ExtensionAPI): {
  agents: number
  wallClockMinutes: number
  filesTouched: number
} {
  const num = (key: string, fallback: number): number => {
    const value = api.settings?.get<number>(key)
    return typeof value === 'number' && Number.isFinite(value) && value >= 1 ? value : fallback
  }
  return {
    agents: num('terminator.foundry.budgets.agents', 3),
    wallClockMinutes: num('terminator.foundry.budgets.wallClockMinutes', 45),
    filesTouched: num('terminator.foundry.budgets.filesTouched', 25),
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

function integrateDepsFor(api: ExtensionAPI, root: string): IntegrateDeps {
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
        orderId: subject,
        actor: 'rule:ship',
        action,
        subject,
        reason,
        evidence: [],
      })
    },
  }
}

/** A node for one rung of the ladder. Not from the graph — the ladder is not in it. */
function ladderNode(rung: string, name: string, lane: number): RunNode {
  return {
    id: `ladder-${rung}-${name.replace(/\W+/g, '-').toLowerCase()}`,
    stepId: `ladder-${rung}`,
    kind: 'run',
    state: 'running',
    unitId: null,
    lane,
    role: null,
    dependsOn: [],
    attempts: 0,
    sessionId: null,
    worktreePath: null,
    startedAt: null,
    endedAt: null,
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
async function executeRun(
  api: ExtensionAPI,
  root: string,
  order: WorkOrder,
  recipe: Recipe,
  graph: RunGraph
): Promise<void> {
  const exec: ShellExec = (options) => api.shell.exec(options)
  const startedAt = Date.now()
  // Every checkout before any agent starts: a run that provisions lane 2 half
  // way through and fails has already spent lane 1's agent budget.
  const checkouts = await ensureCheckouts(order, { exec, root })

  const workspaceId = api.workspace?.list()[0]?.id ?? ''
  const store = createOrderStore(root)
  const featureDir = orderDir(root, order.id)

  // One conversation per lane. A fresh agent per node is a terminal per node
  // and an agent that has read nothing — the failure `continueRun` exists to
  // avoid.
  const laneSessions = new Map<number, string>()

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
    /** Whether this role declared the class of work a tool belongs to. */
    mayUseTool: (tool: string) => boolean
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
      let settled = false
      const finish = (exitCode: number | null): void => {
        if (settled) return
        settled = true
        resolve({ sessionId, exitCode })
      }

      void runner
        .start({
          featureDir,
          worktreePath: checkout.path,
          workspaceId,
          branch: checkout.branch,
          prompt: input.prompt,
          phase: (input.role ?? input.node.id) as never,
          resumeSessionId: input.resumeSessionId,
          model: modelForTier(api, input.modelTier),
          // The read-only decision is taken by the same policy the hook
          // applies, so a verifier that decides to fix what it found is
          // refused rather than reminded.
          // Two gates, not one. Read-only is the whole-role decision; the
          // second holds a role that may write to what it said it writes with
          // — a scribe that decided to edit source rather than documentation
          // is refused by the first if it has no checkout, and by neither if
          // the only check were "may this role write at all".
          autoDecide: (tool, toolInput) => {
            if (input.readOnly) {
              const decision = decideReadOnly(tool, toolInput)
              return decision.allow ? null : { allow: false, reason: decision.reason }
            }
            if (input.role !== null && !input.mayUseTool(tool)) {
              return {
                allow: false,
                reason: `the ${input.role} role does not use ${tool}; its role file lists what it does`,
              }
            }
            // FR-029's automatic half. Without it every ordinary edit went to
            // the operator at every setting, so no run finished unattended and
            // "lights-out" named something the factory could not do.
            const taken = decideByAutonomy({
              toolName: tool,
              input: toolInput,
              autonomy: autonomyFor(api),
              worktreePath: checkout.path,
            })
            return taken === null ? null : { allow: taken.allow, reason: taken.reason }
          },
          onPending: (pending) =>
            notePending(api, { ...pending, featureDir }, { id: order.id, root }),
          onResolved: (requestId) => noteResolved(requestId),
          // Set here as well as after `start` resolves, so a turn that ends
          // before the promise settles still names the right session rather
          // than the placeholder.
          onRegistered: (run) => {
            sessionId = run.sessionId
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
          // The lane's open conversation, for the next node that may carry it
          // on. A role that may not resume is never offered it — the registry
          // refuses, structurally.
          laneSessions.set(lane, run.sessionId)
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
  const houseRules = rulesFor(sources, {
    repoPaths: sources.repoPaths,
    houseDocs: [...order.context.houseDocs],
  }).rules
  const gates = createLiveGateStore(() => root)
  const issuesPort = issuesPortFor(api)

  // The issue moves the moment work starts, not when somebody remembers.
  if (issuesPort !== null) {
    await writeBack(order, 'started', writeBackDepsFor(api, root, order, issuesPort))
  }

  const outcome = await execute(order, recipe, graph, {
    now: () => new Date().toISOString(),
    sources,
    run: runNode,
    sessionFor: (lane) => laneSessions.get(lane),
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
    // A rung runs as a step inside the supervised session, in the lane's own
    // checkout — not as a hidden child process, which is what makes its output
    // visible and its tool calls hook-gated.
    runStep: async (step) => {
      if (step.command === null) return null
      const lane = [...checkouts.keys()].sort((a, b) => a - b)[0] ?? 1
      const started = await runNode({
        node: ladderNode(step.rung, step.name, lane),
        role: null,
        // A rung is a command, not a conversation. It runs on whatever the
        // operator chose, like any node with no role of its own, and answers
        // to no role's tool list.
        modelTier: 'deep',
        mayUseTool: () => true,
        prompt: `Run this exactly, and report its exit status. Do not fix what it reports.\n\n\`\`\`\n${step.command}\n\`\`\``,
        // In the lane's own conversation. Eight rungs used to be eight fresh
        // agents and eight terminals, each re-reading the repository to run
        // one command.
        resumeSessionId: laneSessions.get(lane),
        readOnly: false,
      })

      // The rung's verdict is the command's exit status, never the agent's
      // turn ending (FR-037) and never its account of how it went (FR-033).
      // The turn end is only what tells us to go and look.
      const run = supervision?.runs.get(started.sessionId) ?? null
      if (run === null) return started.exitCode
      const measured = rungExitCode(run.transcriptPath, step.command)
      // `null` is "the agent never ran it", which the ladder reads as not
      // measured. Reading it as a pass is the failure the whole ladder exists
      // to prevent.
      return measured
    },
    observe: () => ({
      elapsedMinutes: Math.round((Date.now() - startedAt) / 60_000),
      filesTouched: new Set(order.plan.units.flatMap((u) => u.touches)).size,
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
    // Lets the budget be re-read while agents are in flight. Without it the
    // wall-clock budget can only fire between waves, which is every case
    // except the one it exists for: an agent that never comes back.
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  })

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
  if (!outcome.shippable) return

  // Shipped against the grade the change turned out to deserve, not the one
  // the plan predicted — which is the whole reason the executor regrades.
  const shipped = await shipOrder(
    { ...order, risk: outcome.risk },
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
      ...integrateDepsFor(api, root),
      // The shipping decision, where the grade calls for one, is the operator's
      // and reaches them through the inbox like every other.
      decide: async (gate) => {
        await gates.save(gate)
        return 'hold'
      },
      raiseGate: async (gate) => {
        await gates.save(gate)
      },
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
 * The architect runs read-only in the repository itself: intake changes no
 * code, and cutting a worktree for a plan that may never be agreed would be
 * creating a branch for nothing. It writes one file, and that file is
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

  const workspaceId = api.workspace?.list()[0]?.id ?? ''
  const featureDir = orderDir(root, order.id)
  await fs.promises.mkdir(featureDir, { recursive: true })

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

    void runner
      .start({
        featureDir,
        worktreePath: plan.cwd,
        workspaceId,
        branch: `foundry/intake-${order.id.toLowerCase()}`,
        prompt: plan.prompt,
        phase: 'architect' as never,
        resumeSessionId: plan.role.allowResume ? resuming : undefined,
        model: modelForTier(api, plan.role.modelTier),
        // Read-only, enforced by the hook rather than by the prompt. The
        // architect proposes; it does not edit the repository it is reading.
        // Its one exception is the proposal itself, and only at that path.
        autoDecide: (tool, toolInput) => {
          const target = (toolInput as { file_path?: unknown } | null)?.file_path
          if (typeof target === 'string' && target === plan.proposalPath) return { allow: true }
          const decision = decideReadOnly(tool, toolInput)
          return decision.allow ? null : { allow: false, reason: decision.reason }
        },
        // Intake is where questions belong, so one asked here is not a defect
        // — it is the Forge working.
        onPending: (pending) => notePending(api, { ...pending, featureDir }),
        onResolved: (requestId) => noteResolved(requestId),
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
  const forge = createForgeChannels({
    store: createLiveOrderStore(dataRoot),
    now: () => new Date().toISOString(),
    writeBackDefault: () => defaultWriteBack(api),
    budgetDefaults: () => defaultBudgets(api),
    criticalPaths: () => declaredCriticalPaths(api),
    priorArtFor: (paths) => priorArtFor(dataRoot(), paths),
    // The redraft lands here, when the architect's turn ends — minutes after
    // the channel that started it answered.
    converge: (order, message) =>
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
      }),
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
  })
  reg(api, 'foundry:order.create', (payload) => forge.create(payload))
  reg(api, 'foundry:order.turn', (payload) => forge.turn(payload))
  reg(api, 'foundry:order.compile', (payload) => forge.compile(payload))
  reg(api, 'foundry:order.list', () => forge.list())
  reg(api, 'foundry:order.states', (payload) => forge.states(payload))
  reg(api, 'foundry:order.mapState', (payload) => forge.mapState(payload))
  reg(api, 'foundry:order.converge', (payload) => forge.converge(payload))
  reg(api, 'foundry:order.writeBack', (payload) => forge.setWriteBack(payload))

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
    now: () => new Date().toISOString(),
    execute: (order, recipe, graph) => executeRun(api, dataRoot(), order, recipe, graph),
  })
  reg(api, 'foundry:run.start', (payload) => runs.start(payload))
  reg(api, 'foundry:run.resume', (payload) => runs.resume(payload))
  reg(api, 'foundry:run.observe', (payload) => runs.observe(payload))
  reg(api, 'foundry:run.recipes', (payload) => runs.recipes(payload))
  reg(api, 'foundry:session.attach', (payload) => runs.attach(payload))

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
        const deps = integrateDepsFor(api, dataRoot())
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

      // `hold` means what it says: the run stays stopped until the operator
      // comes back to it. Everything else is a decision to carry on.
      if (option === 'hold' || option === 'stop') return
      await runs.resume({
        id: gate.orderId,
        // "Send back" is a retry of the node that failed; the others resume
        // whatever the wave was doing.
        retry: option === 'send_back' && gate.nodeId !== null ? [gate.nodeId] : [],
      })
    },
  })
  reg(api, 'foundry:inbox.list', () => inbox.list())
  reg(api, 'foundry:inbox.decide', (payload) => inbox.decide(payload))

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
    now: () => new Date().toISOString(),
  })
  reg(api, 'foundry:ledger.query', (payload) => ledger.query(payload))
  reg(api, 'foundry:rules.propose', (payload) => ledger.proposeRules(payload))
  reg(api, 'foundry:rules.decide', (payload) => ledger.decideProposal(payload))
  reg(api, 'foundry:rules.inForce', (payload) => ledger.rulesInForce(payload))
  reg(api, 'foundry:rules.remove', (payload) => ledger.removeAcceptedRule(payload))

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
  reg(api, 'foundry:feed-dismiss', (payload: unknown) => {
    const { id } = payload as { id: string }
    supervision?.feed.removeEntry(id)
    return { ok: true }
  })

  reg(api, 'foundry:feed-mute', (payload: unknown) => {
    const { sessionId, author } = payload as { sessionId?: string; author?: 'agent' | 'console' }
    mutes?.add({ sessionId, author })
    return { mutes: mutes?.list() ?? [] }
  })

  reg(api, 'foundry:feed-unmute', (payload: unknown) => {
    const { sessionId, author } = payload as { sessionId?: string; author?: 'agent' | 'console' }
    mutes?.remove({ sessionId, author })
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
            'Which rules are allowed to stop for you. Risk, budget, destructive actions and the merge decision are live at every setting.',
          options: ['escorted', 'standard', 'lights-out'],
          default: 'standard',
        },
        'terminator.foundry.budgets.agents': {
          type: 'number',
          label: 'Agents running at once',
          default: 3,
          min: 1,
        },
        'terminator.foundry.budgets.wallClockMinutes': {
          type: 'number',
          label: 'Minutes before an order pauses and asks',
          description:
            'Exceeding a budget pauses the work and raises a decision. It never continues silently, and it never dies silently.',
          default: 45,
          min: 1,
        },
        'terminator.foundry.budgets.filesTouched': {
          type: 'number',
          label: 'Files an order may touch before it pauses and asks',
          default: 25,
          min: 1,
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
      },
    })
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
  paletteRegistrations = entries.map((entry) =>
    api.commands.register(
      {
        id: entry.id,
        label: entry.label,
        description: entry.description,
        category: entry.category,
      },
      () => gotoRun(api, entry.kind, entry.sessionId)
    )
  )
}

export function deactivate(): void {
  disposables.forEach((d) => d.dispose())
  disposables.length = 0
  supervision = null
  mutes = null
  for (const notification of raisedNotifications.values()) notification.dispose()
  raisedNotifications.clear()
  stallWatcher?.stop()
  stallWatcher = null
  if (paletteTimer !== null) clearInterval(paletteTimer)
  paletteTimer = null
  for (const registration of paletteRegistrations) registration.dispose()
  paletteRegistrations = []
  paletteSignature = ''
  supervisedRunner?.dispose()
  supervisedRunner = null
  void control?.close()
  control = null
}
