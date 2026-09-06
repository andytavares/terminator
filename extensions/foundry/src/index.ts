import type { ExtensionAPI, Disposable, SettingDefinition } from '../../../src/main/extensions/api'
import { app } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { modelCatalog } from './state/model-catalog.js'

import {
  setPermissionSink,
  setReadOnlyStateDir,
  setRunSupervision,
  setSupervisedRunner,
} from './runtime/run-seams.js'
import { createForgeChannels } from './ipc/forge-channels.js'
import { createRunChannels } from './ipc/run-channels.js'
import { createInboxChannels } from './ipc/inbox-channels.js'
import { createLedgerChannels } from './ipc/ledger-channels.js'
import { rulesFor } from './verify/rules.js'
import { createGateStore } from './gates/store.js'
import { createOrderStore } from './order/store.js'
import { markReady, readPulls } from './line/integrate.js'
import type { IntegrateDeps } from './line/integrate.js'
import { checkCapability, writeBack } from './trackers/write-back.js'
import type { IssuesPort, WriteBackDeps } from './trackers/write-back.js'
import type { WorkOrder, WriteBack } from './order/schema.js'
import { resolveDataRoot, untrackedNotice, ledgerPath } from './data-root.js'
import { queryEntries } from './ledger/append.js'
import { createControlServer, type ControlServer } from './runtime/control-server.js'
import { createSupervisedRunner, type SupervisedRunner } from './runtime/supervised-runner.js'
import { createPendingPermissions } from './runtime/pending-permissions.js'
import { createStallWatcher, type StallWatcher } from './runtime/stall-watcher.js'
import { createSupervision, type Supervision } from './runtime/supervision.js'
import { buildDigest, channelFor, type NotifiableEvent } from './runtime/feed/digest.js'
import { paletteEntries } from './runtime/palette.js'
import { createMuteStore, type MuteStore } from './runtime/feed/mutes.js'
import { readTranscriptTail } from './runtime/transcript-excerpt.js'
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

function resolveFoundryDataRoot(api: ExtensionAPI): string {
  // Every read here is optional. Activation is called synchronously by the
  // host and must not throw because one capability is absent — a host that
  // has no workspace yet is a normal state, not a reason to fail to load.
  let configured = ''
  let workdir = process.cwd()
  try {
    configured = api.settings?.get<string>('terminator.foundry.dataDir') ?? ''
    workdir = api.workspace?.list()[0]?.folderPath ?? process.cwd()
  } catch {
    // Leave the defaults.
  }
  try {
    return resolveDataRoot(configured, workdir).root
  } catch {
    // A relative path was configured, which is ambiguous once an order spans
    // repositories. Fall back to the default rather than refusing to activate.
    return resolveDataRoot('', workdir).root
  }
}

const MODEL_SETTING_KEY = 'terminator.foundry.defaultModel'

/**
 * The model every phase launches with.
 *
 * Empty string is a real answer, not a missing one: it means "pass no
 * `--model`", so the run follows the operator's own Claude Code configuration.
 * Only an unset setting falls through to the default.
 */
function defaultModel(api: ExtensionAPI): string {
  const value = api.settings.get<string>(MODEL_SETTING_KEY)
  // An alias, not a pinned id: `--model opus` resolves to the latest of that
  // family, so this default cannot go a generation stale sitting here — which
  // is exactly what the pinned id it replaced did.
  return typeof value === 'string' ? value : 'opus'
}

// Every notification kind this extension ever raises, so the user can
// independently choose its delivery target(s) (system/in-app/toast) in this
// extension's own settings — core never knows these keys exist (Extension Isolation).
const NOTIFICATION_KEYS: { key: string; label: string }[] = [
  { key: 'startQueuedCardFailed', label: 'Could not start queued card' },
  { key: 'createCardFailed', label: 'Could not create card' },
  { key: 'moveCardFailed', label: 'Could not move card' },
  { key: 'handoffFailed', label: 'Handoff failed' },
  { key: 'fetchTicketsFailed', label: 'Could not fetch tickets' },
  { key: 'saveCredentialsFailed', label: 'Could not save credentials' },
  { key: 'dispatchFailed', label: 'Dispatch failed' },
  { key: 'cancelFailed', label: 'Cancel failed' },
  { key: 'resetFailed', label: 'Reset failed' },
  { key: 'openPrFailed', label: 'Open PR failed' },
]

function buildNotificationSettingProperties(): Record<string, SettingDefinition> {
  const properties: Record<string, SettingDefinition> = {}
  for (const { key, label } of NOTIFICATION_KEYS) {
    properties[`terminator.foundry.notify.${key}.system`] = {
      type: 'boolean',
      label: `${label} → System notification`,
      default: true,
    }
    properties[`terminator.foundry.notify.${key}.center`] = {
      type: 'boolean',
      label: `${label} → In-app notification center`,
      default: true,
    }
    properties[`terminator.foundry.notify.${key}.toast`] = {
      type: 'boolean',
      label: `${label} → Toast`,
      default: true,
    }
  }
  return properties
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
        key: `speckit.permission.${event.sessionId}`,
        actions,
        onClick,
      })
    case 'indicator':
      api.notifications.showToast('warning', message, `speckit.${event.kind}.${event.sessionId}`)
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
  // Self-review's read-only policy does not need the control server, so it is
  // installed whether or not the rest of the runtime comes up. Guarded on its
  // own: activation must not fail because a host could not say where worktrees
  // live, and a review with no policy refuses rather than bypassing.
  try {
    setReadOnlyStateDir(runtimeStateDir())
  } catch {
    setReadOnlyStateDir(null)
  }

  try {
    control = await createControlServer()
    supervisedRunner = createSupervisedRunner({
      api,
      control,
      stateDir: runtimeStateDir(),
    })
    setSupervisedRunner(supervisedRunner)
    // Raised requests are held here so a surface can render them, and cleared
    // when answered — by the operator, the autonomy ladder, or the bridge
    // handing the decision back to the terminal.
    setPermissionSink({
      onPending: (ask) => {
        pendingPermissions.add(ask)
        // The one thing allowed to interrupt: the run is stopped dead until
        // somebody answers, and a request nobody sees is a twelve-hour hang.
        const notification = notify(
          api,
          { kind: 'permission_requested', sessionId: ask.sessionId },
          `${path.basename(ask.featureDir)} is asking: ${ask.summary}`,
          [
            {
              id: 'allow',
              label: 'Allow',
              handler: () =>
                supervisedRunner?.resolve(ask.sessionId, ask.requestId, { allow: true }),
            },
            {
              id: 'deny',
              label: 'Deny',
              handler: () =>
                supervisedRunner?.resolve(ask.sessionId, ask.requestId, { allow: false }),
            },
          ],
          // Was an "Open the board" button sitting beside Allow and Deny —
          // which is the wrong shape: opening the thing is not a third answer
          // to the question, it is what clicking the notification should do.
          // It also went no further than focusing the window, leaving you to
          // find the run yourself.
          () => gotoRun(api, 'run', ask.sessionId)
        )
        if (notification !== null) raisedNotifications.set(ask.requestId, notification)
      },
      onResolved: (requestId) => {
        pendingPermissions.remove(requestId)
        // Taken away with the request: a notification left behind after the
        // thing it was about is answered teaches you to dismiss without reading.
        raisedNotifications.get(requestId)?.dispose()
        raisedNotifications.delete(requestId)
      },
    })

    // A run that stops making progress without asking for anything is the
    // failure nobody instruments: it looks exactly like one that is working.
    supervision = createSupervision({
      api,
      stateDir: runtimeStateDir(),
    })
    // Registered runs are what everything downstream reads. Without this the
    // review queue, the gate and the stall detector are all correct and empty.
    setRunSupervision(supervision)
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
      'speckit.runtime.unavailable'
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
  const foundryDataRoot = resolveFoundryDataRoot(api)

  // Said once, and only when the default location is in use. Foundry will not
  // add the ignore entry itself — that would be editing a file no order asked
  // to change — so the operator is told what it costs and what avoids it.
  noteUntrackedDataRoot(api, foundryDataRoot)
  const issuesPort = issuesPortFor(api)
  const forge = createForgeChannels({
    store: createOrderStore(foundryDataRoot),
    now: () => new Date().toISOString(),
    writeBackDefault: defaultWriteBack(api),
    priorArtFor: (paths) => priorArtFor(foundryDataRoot, paths),
    // FR-059a: asked when the order is agreed, so an issue that will never
    // move is known before the run rather than after it.
    capability:
      issuesPort === null
        ? undefined
        : (order) =>
            checkCapability(order, writeBackDepsFor(api, foundryDataRoot, order, issuesPort)),
    onAgreed:
      issuesPort === null
        ? undefined
        : async (order) => {
            await writeBack(
              order,
              'agreed',
              writeBackDepsFor(api, foundryDataRoot, order, issuesPort)
            )
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

  // ── The Line ───────────────────────────────────────────────────────────
  //
  // An agreed order plus a shape of work becomes a run graph. Everything that
  // can refuse does so before any agent starts: the order has to be agreed,
  // the shape has to be one this repository can actually support, and the
  // records location has to be writable.
  const runs = createRunChannels({
    store: createOrderStore(foundryDataRoot),
    dataRoot: foundryDataRoot,
    sources: {
      dataRoot: foundryDataRoot,
      repoPaths: (api.workspace?.list() ?? []).map((workspace) => workspace.folderPath),
      // The built-ins ship inside the extension, so they are available in a
      // repository that contains nothing of Foundry's.
      builtInDir: path.resolve(__dirname, '..'),
    },
    now: () => new Date().toISOString(),
  })
  reg(api, 'foundry:run.start', (payload) => runs.start(payload))
  reg(api, 'foundry:run.observe', (payload) => runs.observe(payload))
  reg(api, 'foundry:run.recipes', (payload) => runs.recipes(payload))
  reg(api, 'foundry:session.attach', (payload) => runs.attach(payload))

  // ── The inbox ──────────────────────────────────────────────────────────
  //
  // The one surface the operator is required to visit. Nothing reaches it that
  // a named rule did not raise, which is what makes "nothing needs you" a
  // state worth trusting rather than a state worth double-checking.
  const inbox = createInboxChannels({
    gates: createGateStore(foundryDataRoot),
    orders: createOrderStore(foundryDataRoot),
    autonomy: () =>
      api.settings?.get<'escorted' | 'standard' | 'lights-out'>('terminator.foundry.autonomy') ??
      'standard',
    now: () => new Date().toISOString(),
    record: async (orderId, action, subject, reason) => {
      await createOrderStore(foundryDataRoot).record({
        at: new Date().toISOString(),
        orderId,
        actor: 'operator',
        action,
        subject,
        reason,
        evidence: [],
      })
    },
    // "Mark ready" is the decision the operator is offered on a finished
    // order (FR-057), and this is what makes it mean something. Creating the
    // pull request was never their decision to take.
    act: async (gate, option) => {
      if (gate.rule !== 'ready-for-review' || option !== 'mark_ready') return
      const deps = integrateDepsFor(api, foundryDataRoot)
      for (const pull of await readPulls(foundryDataRoot, gate.orderId)) {
        await markReady(pull, deps)
      }
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
    store: createOrderStore(foundryDataRoot),
    dataRoot: foundryDataRoot,
    existingRuleIds: () =>
      rulesFor(
        {
          dataRoot: foundryDataRoot,
          repoPaths: (api.workspace?.list() ?? []).map((workspace) => workspace.folderPath),
          builtInDir: path.resolve(__dirname, '..'),
        },
        {
          repoPaths: (api.workspace?.list() ?? []).map((workspace) => workspace.folderPath),
          houseDocs: [],
        }
      ).rules.map((rule) => rule.id),
    now: () => new Date().toISOString(),
  })
  reg(api, 'foundry:ledger.query', (payload) => ledger.query(payload))
  reg(api, 'foundry:rules.propose', (payload) => ledger.proposeRules(payload))
  reg(api, 'foundry:rules.decide', (payload) => ledger.decideProposal(payload))

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

  // Kill and discard: the run ends, its worktree and branch go with it, and the
  // card is put back where it can be started again. A discarded run must not
  // keep occupying a review slot — that would gate the next run on reviewing a
  // diff that no longer exists.
  // speckit:card-list — board data: every card with brief + derived stage + phase summary
  // speckit:card-create — create a native (or ticket-seeded) card in the backlog
  // speckit:card-update — edit a card's brief
  // speckit:card-comment — append a comment; queued to steer the next phase run
  // speckit:run-output-read — load persisted output for a phase (review past runs)
  // speckit:comment-list — load a card's comments
  // speckit:card-move — user-driven board organization. Sets the card's stage; it
  // never starts a run. Dropping an active card onto Backlog parks (stops) its run.
  // speckit:card-handoff — explicit "start" action: run the card through the pipeline
  // speckit:artifact-list — enumerate a card's artifacts with git revision history
  // speckit:knowledge-search — keyword search across repo markdown + card briefs/specs
  // speckit:pilot-state — load or create .pilot/state.json
  // speckit:phase-approve — mark a phase approved
  // speckit:phase-revoke — revoke approval, mark downstream stale
  // speckit:artifact-read — read current file + last approved (via git) for diff.
  // When `commit` is given, `current` is that revision's content (git show <commit>:path).
  // speckit:history-load — read and parse history.jsonl
  // speckit:phase-skip — mark a phase as intentionally skipped
  // speckit:phase-unskip — restore a skipped phase back to ready
  // speckit:file-write — write any file within the project (markdown edits)
  // speckit:ticket-list — the operator's assigned issues, from the
  // application's single tracker connection.
  //
  // This extension used to own two API clients and two credentials. It now
  // owns neither: core connects, core caches, and this asks (ExtensionAPI
  // v2.2.0). The board's own behaviour is unchanged.
  // speckit:credentials-set and speckit:credentials-status are gone.
  //
  // Tracker credentials are the application's now, entered once in
  // Settings → Integrations and encrypted with the OS keychain. This extension
  // holds none, which is the whole point of the migration — uninstall it and
  // nothing is orphaned.

  // speckit:dispatch — create the feature dir, its state, and start the first
  // phase, in one call.
  //
  // The board's own route is card-create then card-handoff; this is the
  // one-step entry a tracker or the remote bridge uses, and what the e2e drives
  // to prove a phase really opens a terminal.
  // speckit:run-cancel — stop runner, optionally remove worktree+branch, update state
  // speckit:card-reset — wipe a card's entire run so it can start over. Stops the
  // runner, removes the worktree + branch, deletes .pilot logs/history/self-review,
  // and resets phases/run to the initial state. The card brief, ticket, mode, and
  // settings are preserved so the card can be re-dispatched cleanly.
  // speckit:run-reply — answer the model's question from the run console by
  // resuming the last Claude session with the user's text. Output streams back
  // into the same phase console.
  // speckit:open-pr — run gh pr create, write prUrl to state, comment on ticket
  // speckit:checkin-decision — batch check-in: continue/pause/split
  // speckit:self-review-read — read .pilot/self-review.json
  reg(api, 'foundry:self-review-read', async (payload: unknown) => {
    const { featureDir } = payload as { featureDir?: string }
    if (!featureDir) return { error: 'featureDir required' }
    const filePath = path.join(featureDir, '.pilot', 'self-review.json')
    try {
      const raw = await fs.promises.readFile(filePath, 'utf-8')
      return { result: JSON.parse(raw) }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT') return { notFound: true, error: 'self-review.json not found' }
      return { error: String(err) }
    }
  })

  // speckit:phase-request-changes — store feedback, set phase to ready, re-run with note
  // speckit:phase-comment — append an audit note without triggering re-run
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
        'terminator.foundry.enabled': {
          type: 'boolean',
          label: 'Enable Foundry',
          default: true,
          workspaceScoped: true,
        },
        'terminator.foundry.stallShadowMode': {
          type: 'boolean',
          label: 'Record stalls without surfacing them',
          description:
            'On by default. A stall detector that cries wolf gets turned off, and then the real stalls go unreported too — judge a week of recorded firings before turning this off.',
          default: true,
        },
        'terminator.foundry.maxConcurrentRuns': {
          type: 'number',
          label: 'Maximum cards running in parallel',
          default: 3,
        },
        'terminator.foundry.logRetentionDays': {
          type: 'number',
          label: 'Days to keep persisted step logs',
          default: 30,
        },
        ...buildNotificationSettingProperties(),
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
  setSupervisedRunner(null)
  setPermissionSink(null)
  setReadOnlyStateDir(null)
  setRunSupervision(null)
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
