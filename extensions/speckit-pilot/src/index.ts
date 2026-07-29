import type { ExtensionAPI, Disposable, SettingDefinition } from '../../../src/main/extensions/api'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type {
  CardBrief,
  CardComment,
  CardSummary,
  Feature,
  HistoryEntry,
  JiraCreds,
  PhaseId,
  PilotState,
  RunMode,
  TicketRef,
} from './types/speckit.types.js'
import {
  PHASE_ORDER,
  QUICK_PHASES,
  STAGE_ORDER,
  createDefaultBrief,
} from './types/speckit.types.js'
import {
  readState as readMigratedState,
  readCard,
  writeCard,
  appendComment,
  readComments,
  consumePendingComments,
  createInitialState,
} from './state/state-persistence.js'
import { buildCardSummary } from './state/card-summary.js'
import { deriveStage } from './state/derive-stage.js'
import { shouldQueue, orderPending } from './state/run-queue.js'
import { parseRgLines, searchFiles } from './utils/knowledge-search.js'
import { parseGitLog, artifactSpecs, buildArtifactRef } from './state/artifact-list.js'
import { buildTicketMarkdown } from './state/ticket-markdown.js'
import type { ArtifactRef, BoardStage } from './types/speckit.types.js'

// SpecKit-mode phases invoke the project's native `/speckit-*` skills rather
// than freeform prose. The skills already encode feature-dir placement, template
// resolution, and stop conditions — which is what keeps runs from wandering
// (writing spec.md at the repo root, asking where files go, etc.). They resolve
// the correct feature directory from the SPECIFY_FEATURE_DIRECTORY env var the
// runner sets, independent of the branch name. `${DESCRIPTION}` is substituted
// with the card title for /speckit-specify.
const PHASE_COMMANDS: Record<PhaseId, string> = {
  constitution: '/speckit-constitution',
  specify: '/speckit-specify Based on the ticket in ticket.md: ${DESCRIPTION}',
  clarify: '/speckit-clarify',
  plan: '/speckit-plan',
  checklist: '/speckit-checklist',
  tasks: '/speckit-tasks',
  analyze: '/speckit-analyze',
  implement: '/speckit-implement',
  'self-review': '', // handled by SELF_REVIEW_CMD in agent-runner; not dispatched as a prompt
  'open-pr': '', // not auto-started; triggered explicitly by user action
}

// Quick-fix runs skip specify/tasks (so there is no spec.md/tasks.md for the
// native plan/implement skills to read), so they use direct prose prompts that
// work straight from the ticket/plan.
const QUICK_PHASE_COMMANDS: Partial<Record<PhaseId, string>> = {
  plan: 'Create a concise technical implementation plan in plan.md based on the ticket in ticket.md',
  implement: 'Implement the change described in plan.md',
}

// The prompt for a phase, honoring the card's run mode. `description` seeds
// /speckit-specify with the card title.
function phaseCommandFor(phase: PhaseId, mode: RunMode, description = ''): string {
  if (mode === 'quick') return QUICK_PHASE_COMMANDS[phase] ?? PHASE_COMMANDS[phase]
  return PHASE_COMMANDS[phase].replace('${DESCRIPTION}', description || 'the assigned ticket')
}

// Card title, tolerant of pre-v3 states read raw (which have no `card` field).
function cardTitleOf(state: PilotState): string {
  const card = state.card as CardBrief | undefined
  return card?.title ?? state.ticket?.title ?? ''
}
import {
  setLinearKey,
  getLinearKey,
  getLinearEmail,
  setLinearEmail,
  setJiraCredentials,
  getJiraCredentials,
} from './api/credentials.js'
import {
  fetchAssignedTickets as fetchLinearTickets,
  postComment as postLinearComment,
} from './api/linear.js'
import {
  fetchAssignedTickets as fetchJiraTickets,
  postComment as postJiraComment,
} from './api/jira.js'
import {
  createAgentRunner,
  phaseLogPath,
  pruneOldLogs,
  setPermissionSink,
  setReadOnlyStateDir,
  setRunSupervision,
  setSupervisedRunner,
} from './runner/agent-runner.js'
import { createControlServer, type ControlServer } from './runtime/control-server.js'
import { createSupervisedRunner, type SupervisedRunner } from './runtime/supervised-runner.js'
import { createPendingPermissions } from './runtime/pending-permissions.js'
import { createStallWatcher, type StallWatcher } from './runtime/stall-watcher.js'
import { createSupervision, type Supervision } from './runtime/supervision.js'
import { buildDigest, channelFor, type NotifiableEvent } from './runtime/feed/digest.js'
import { paletteEntries } from './runtime/palette.js'
import { createMuteStore, type MuteStore } from './runtime/feed/mutes.js'
import { readCardLanes } from './runtime/workitem.js'
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
import type { RunnerHandle } from './runner/agent-runner.js'

const disposables: Disposable[] = []

// Active session registry: sessionId → session metadata
const activeSessions: Map<string, { id: string; name: string }> = new Map()

// Active implement run registry: featureDir → runId
const activeRuns: Map<string, string> = new Map()

// Active agent runner handles: featureDir → RunnerHandle
const activeRunnerHandles: Map<string, RunnerHandle> = new Map()

// Latest Claude session id per card, so the run console can resume the
// conversation to answer the model's questions. featureDir → sessionId
const phaseSessionIds: Map<string, string> = new Map()

async function appendHistory(featureDir: string, entry: HistoryEntry): Promise<void> {
  const pilotDir = path.join(featureDir, '.pilot')
  await fs.promises.mkdir(pilotDir, { recursive: true })
  const historyFile = path.join(pilotDir, 'history.jsonl')
  await fs.promises.appendFile(historyFile, JSON.stringify(entry) + '\n', 'utf-8')
}

async function readHistory(featureDir: string): Promise<HistoryEntry[]> {
  const historyFile = path.join(featureDir, '.pilot', 'history.jsonl')
  try {
    const raw = await fs.promises.readFile(historyFile, 'utf-8')
    const lines = raw.split('\n').filter((l) => l.trim())
    const entries: HistoryEntry[] = []
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line) as HistoryEntry)
      } catch {
        // skip malformed lines
      }
    }
    return entries
  } catch {
    return []
  }
}

function reg(
  api: ExtensionAPI,
  channel: string,
  handler: (payload: unknown) => Promise<unknown> | unknown
) {
  disposables.push(api.ipc.registerHandler(channel, handler))
}

// Scan a specs/ directory for feature dirs (contain spec.md)
async function listFeatures(repoRoot: string): Promise<Feature[]> {
  const specsDir = path.join(repoRoot, 'specs')
  let entries: string[] = []
  try {
    entries = await fs.promises.readdir(specsDir)
  } catch {
    return []
  }
  const features: Feature[] = []
  for (const name of entries.sort()) {
    const dir = path.join(specsDir, name)
    const specPath = path.join(dir, 'spec.md')
    try {
      const stat = await fs.promises.stat(specPath)
      features.push({ name, dir, specPath, lastModified: stat.mtimeMs })
    } catch {
      // not a feature dir
    }
  }
  return features
}

// Scan specs/ for card dirs — any dir with a pilot state, card brief, or spec.md.
// Unlike listFeatures, this includes backlog cards that have no spec.md yet.
async function listCardDirs(repoRoot: string): Promise<string[]> {
  const specsDir = path.join(repoRoot, 'specs')
  let entries: string[] = []
  try {
    entries = await fs.promises.readdir(specsDir)
  } catch {
    return []
  }
  const dirs: string[] = []
  for (const name of entries.sort()) {
    const dir = path.join(specsDir, name)
    try {
      const stat = await fs.promises.stat(dir)
      if (!stat.isDirectory()) continue
    } catch {
      continue
    }
    const candidates = [
      path.join(dir, '.pilot', 'state.json'),
      path.join(dir, '.pilot', 'card.json'),
      path.join(dir, 'spec.md'),
    ]
    for (const c of candidates) {
      try {
        await fs.promises.access(c)
        dirs.push(dir)
        break
      } catch {
        // keep checking
      }
    }
  }
  return dirs
}

// Read pilot state from .pilot/state.json inside featureDir
async function readPilotState(featureDir: string): Promise<PilotState | null> {
  const stateFile = path.join(featureDir, '.pilot', 'state.json')
  try {
    const raw = await fs.promises.readFile(stateFile, 'utf-8')
    return JSON.parse(raw) as PilotState
  } catch {
    return null
  }
}

// Write pilot state atomically
async function writePilotState(featureDir: string, state: PilotState): Promise<void> {
  const pilotDir = path.join(featureDir, '.pilot')
  await fs.promises.mkdir(pilotDir, { recursive: true })
  const stateFile = path.join(pilotDir, 'state.json')
  const tmp = stateFile + '.tmp'
  await fs.promises.writeFile(tmp, JSON.stringify(state, null, 2), 'utf-8')
  await fs.promises.rename(tmp, stateFile)
}

// Create initial pilot state for a feature dir (v3, backlog card).
function createPilotState(featureDir: string): PilotState {
  return createInitialState(featureDir)
}

function makePhaseCallbacks(
  api: ExtensionAPI,
  featureDir: string,
  phase: PhaseId,
  batchIndex?: number
) {
  return {
    onSession: (sessionId: string) => {
      phaseSessionIds.set(featureDir, sessionId)
      api.window.broadcast('speckit:run-session', { featureDir, phase, sessionId })
    },
    onStart: async () => {
      const state = await readPilotState(featureDir)
      if (!state) return
      const ps = state.phases[phase]
      if (ps) {
        ps.status = 'running'
        ps.lastRunAt = new Date().toISOString()
      }
      if (state.run) state.run.status = 'running'
      // While a run is active, the board column tracks phase progress automatically.
      state.stage = deriveStage(state.phases, state.run)
      await writePilotState(featureDir, state)
      api.window.broadcast('speckit:state-changed', { state })
    },
    onComplete: async (exitCode: number) => {
      // Batch implement phases emit checkin-ready — phase stays running until user decides
      if (phase === 'implement' && batchIndex !== undefined) return
      const state = await readPilotState(featureDir)
      if (!state) return
      const ps = state.phases[phase]
      if (ps) ps.status = exitCode === 0 ? 'awaiting_review' : 'ready'
      state.stage = deriveStage(state.phases, state.run)
      await writePilotState(featureDir, state)
      await appendHistory(featureDir, {
        ts: new Date().toISOString(),
        actor: 'agent',
        action: exitCode === 0 ? 'run_complete' : 'run_failed',
        phase,
      })
      api.window.broadcast('speckit:state-changed', { state })
    },
  }
}

function getMaxConcurrent(api: ExtensionAPI): number {
  const v = api.settings.get<number>('terminator.speckit-pilot.maxConcurrentRuns')
  return typeof v === 'number' && v >= 1 ? Math.floor(v) : 3
}

function getLogRetentionDays(api: ExtensionAPI): number {
  const v = api.settings.get<number>('terminator.speckit-pilot.logRetentionDays')
  return typeof v === 'number' && v >= 1 ? Math.floor(v) : 30
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.promises.access(p)
    return true
  } catch {
    return false
  }
}

// Count cards currently occupying a run slot (active + running, incl. awaiting review).
async function countActiveRuns(workspacePath: string): Promise<number> {
  const dirs = await listCardDirs(workspacePath)
  let n = 0
  for (const dir of dirs) {
    const s = await readMigratedState(dir)
    if (s && s.queuePosition === 'active' && s.run && s.run.status === 'running') n++
  }
  return n
}

// Lowercase, hyphen-separated slug (trimmed of leading/trailing/ repeated
// hyphens, capped so branch names stay readable).
function kebabCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
}

// The committer's git user.name as a slug, for the fallback branch prefix.
async function gitUsername(api: ExtensionAPI, cwd: string): Promise<string> {
  try {
    const res = await api.shell.exec({ command: 'git', args: ['config', 'user.name'], cwd })
    const name = kebabCase(res.stdout.trim())
    if (name) return name
  } catch {
    // fall through to a generic prefix
  }
  return 'user'
}

// Decide the branch name for a card's worktree. Prefer the tracker's suggested
// VCS branch (Linear provides one per issue); otherwise
// <username>/<ticket-key>-<kebab-title>; fall back to feature/<slug> for native
// cards that have no ticket.
async function resolveBranchName(
  api: ExtensionAPI,
  featureDir: string,
  workspacePath: string,
  ticket: TicketRef | null
): Promise<string> {
  if (ticket?.branchName) return ticket.branchName
  if (ticket?.key) {
    const username = await gitUsername(api, workspacePath)
    return `${username}/${ticket.key.toLowerCase()}-${kebabCase(ticket.title)}`
  }
  const slug = path.basename(featureDir).replace(/^\d+-/, '') || path.basename(featureDir)
  return `feature/${slug}`
}

// True when a local git branch already exists.
async function branchExists(
  api: ExtensionAPI,
  workspacePath: string,
  branchName: string
): Promise<boolean> {
  const res = await api.shell.exec({
    command: 'git',
    args: ['rev-parse', '--verify', '--quiet', `refs/heads/${branchName}`],
    cwd: workspacePath,
  })
  return res.exitCode === 0
}

// Create a git worktree for a card; returns its path + branch name. Reuses an
// existing branch (e.g. when recreating a removed worktree) instead of failing
// on `-b`.
async function createWorktree(
  api: ExtensionAPI,
  featureDir: string,
  workspacePath: string,
  ticket: TicketRef | null,
  baseBranch?: string
): Promise<{ worktreePath: string; branchName: string }> {
  const slug = path.basename(featureDir).replace(/^\d+-/, '') || path.basename(featureDir)
  const branchName = await resolveBranchName(api, featureDir, workspacePath, ticket)
  // Respect the core app's worktree location setting (workspace override →
  // global → <repo>/.worktrees) instead of a private directory.
  const worktreeRoot = api.settings.resolveWorktreeBaseDir(workspacePath)
  const worktreePath = path.join(worktreeRoot, slug)
  const args = ['worktree', 'add', worktreePath]
  if (await branchExists(api, workspacePath, branchName)) {
    args.push(branchName)
  } else {
    args.push('-b', branchName)
    if (baseBranch) args.push(baseBranch)
  }
  const res = await api.shell.exec({ command: 'git', args, cwd: workspacePath })
  if (res.exitCode !== 0) throw new Error(res.stderr || res.stdout || 'git worktree add failed')
  return { worktreePath, branchName }
}

// Reclaim a worktree and the branch it was on.
//
// Both, always: a removed worktree whose branch survives leaves a branch nobody
// will ever check out and makes recreating the card fail on "already exists".
// Failures are swallowed deliberately — this runs when the operator has already
// decided the work is going away, and a discard that half-happens and then
// throws leaves worse state than one that finishes quietly.
async function discardWorktree(
  api: ExtensionAPI,
  workspacePath: string,
  worktreePath: string | null,
  branchName: string | null
): Promise<void> {
  if (!workspacePath) return
  if (worktreePath) {
    await api.shell
      .exec({
        command: 'git',
        args: ['worktree', 'remove', worktreePath, '--force'],
        cwd: workspacePath,
      })
      .catch(() => {})
  }
  if (branchName) {
    await api.shell
      .exec({ command: 'git', args: ['branch', '-D', branchName], cwd: workspacePath })
      .catch(() => {})
  }
}

// Guarantee a card runs in its own worktree, never the main checkout. Returns
// the existing worktree when present, otherwise creates one and persists it to
// state. Every phase runner must resolve its cwd through this.
async function ensureWorktreePath(
  api: ExtensionAPI,
  featureDir: string,
  state: PilotState
): Promise<string> {
  if (state.worktreePath && (await pathExists(state.worktreePath))) return state.worktreePath
  const workspacePath = path.dirname(path.dirname(featureDir))
  const { worktreePath, branchName } = await createWorktree(
    api,
    featureDir,
    workspacePath,
    state.ticket
  )
  state.worktreePath = worktreePath
  state.branchName = branchName
  await writePilotState(featureDir, state)
  return worktreePath
}

// Materialize the card's ticket content into the worktree so the `specify`
// phase prompt can read it from ticket.md (see PHASE_COMMANDS.specify). Without
// this the agent has no ticket to work from and stops to ask for a source.
async function writeWorktreeTicket(
  worktreePath: string,
  card: CardBrief | null,
  ticket: TicketRef | null
): Promise<void> {
  await fs.promises.writeFile(
    path.join(worktreePath, 'ticket.md'),
    buildTicketMarkdown(card, ticket),
    'utf-8'
  )
}

// The first phase that still needs to run (skip already-skipped/approved phases).
function firstRunnablePhase(state: PilotState): PhaseId {
  return (
    PHASE_ORDER.find((id) => {
      const s = state.phases[id]?.status
      return s !== 'skipped' && s !== 'approved'
    }) ?? 'specify'
  )
}

// Start the given phase's runner for a card, steering with any pending comments.
async function startRunAt(
  api: ExtensionAPI,
  featureDir: string,
  worktreePath: string,
  phase: PhaseId,
  mode: RunMode = 'speckit',
  description = ''
): Promise<void> {
  const runId = `run-${Date.now()}`
  const feedbackNote = (await consumePendingComments(featureDir, runId)) ?? undefined
  const runner = createAgentRunner(api)
  const handle = runner.startPhaseRunner({
    featureDir,
    worktreePath,
    phaseCommand: phaseCommandFor(phase, mode, description),
    phase,
    feedbackNote,
    ...makePhaseCallbacks(api, featureDir, phase),
  })
  activeRunnerHandles.set(featureDir, handle)
}

// Prepare a card's phases for a run. Quick-fix cards skip every phase outside
// QUICK_PHASES; SpecKit cards honor the "skip Constitution" setting.
function primePhasesForRun(state: PilotState): void {
  if (state.mode === 'quick') {
    for (const id of PHASE_ORDER) {
      const ps = state.phases[id]
      if (!ps || ps.status === 'approved') continue
      if (QUICK_PHASES.includes(id)) {
        if (id === 'plan' && ps.status === 'locked') ps.status = 'ready'
      } else {
        ps.status = 'skipped'
      }
    }
    return
  }
  const constitution = state.phases['constitution']
  const specify = state.phases['specify']
  if (!constitution) return
  const runConstitution = state.settings.runConstitutionPhase
  if (!runConstitution && constitution.status !== 'approved') {
    constitution.status = 'skipped'
    if (specify && specify.status === 'locked') specify.status = 'ready'
  } else if (runConstitution && constitution.status === 'locked') {
    constitution.status = 'ready'
  }
}

// Hand a backlog card off to an agent: start now if under the cap, else queue it.
async function handoffCard(
  api: ExtensionAPI,
  featureDir: string,
  workspacePath: string,
  baseBranch?: string,
  mode?: RunMode,
  /** Set after the operator accepts a recorded refusal. */
  overrideBackpressure?: boolean
): Promise<
  | { ok: true; dispatched: true; queued: boolean }
  | { ok: false; error: string; reason?: string | null; backpressure?: unknown }
  | { error: string; message?: string }
> {
  const state = await readMigratedState(featureDir)
  if (!state) return { error: 'No card state found' }
  const card = await readCard(featureDir)
  const title = card?.title ?? state.card.title
  if (!title || title.trim().length === 0) {
    return { error: 'VALIDATION_ERROR', message: 'A card needs a title before handoff' }
  }
  if (mode) state.mode = mode
  const now = new Date().toISOString()
  state.run = {
    status: 'running',
    startedAt: now,
    completedAt: null,
    autonomyLevel: state.run?.autonomyLevel ?? state.settings.defaultAutonomy ?? 'standard',
  }
  primePhasesForRun(state)

  // Refused before anything is provisioned: starting a fourth agent while three
  // diffs are waiting is how a backlog nobody can review gets built, and the
  // constraint is one person's attention rather than machine capacity.
  //
  // Overridden deliberately rather than not enforced — the override is recorded
  // with the depth at the moment it was ignored, so a backlog built this way is
  // visible afterwards rather than only felt.
  const gate = supervision?.backpressure.check()
  if (gate !== undefined && !gate.allowed && overrideBackpressure !== true) {
    state.run = null
    await writePilotState(featureDir, state)
    return { ok: false, error: 'backpressure', reason: gate.reason, backpressure: gate }
  }
  if (gate !== undefined && !gate.allowed && overrideBackpressure === true) {
    supervision?.backpressure.override(featureDir, Date.now())
  }

  const cap = getMaxConcurrent(api)
  const active = await countActiveRuns(workspacePath)
  if (shouldQueue(active, cap)) {
    state.queuePosition = 'pending'
    state.stage = deriveStage(state.phases, state.run)
    await writePilotState(featureDir, state)
    api.window.broadcast('speckit:state-changed', { state })
    return { ok: true, dispatched: true, queued: true }
  }

  // Reuse an existing worktree (e.g. resuming a card that was already started);
  // only create one when it's missing.
  let worktreePath = state.worktreePath
  let branchName = state.branchName
  const existingUsable = worktreePath ? await pathExists(worktreePath) : false
  if (!existingUsable) {
    const created = await createWorktree(api, featureDir, workspacePath, state.ticket, baseBranch)
    worktreePath = created.worktreePath
    branchName = created.branchName
  }
  if (!worktreePath) return { error: 'Could not resolve a worktree for the card' }
  state.worktreePath = worktreePath
  state.branchName = branchName
  state.queuePosition = 'active'
  state.stage = deriveStage(state.phases, state.run)
  await writePilotState(featureDir, state)
  await writeWorktreeTicket(worktreePath, card, state.ticket)
  await startRunAt(
    api,
    featureDir,
    worktreePath,
    firstRunnablePhase(state),
    state.mode,
    state.card.title
  )
  api.window.broadcast('speckit:dispatch-started', { featureDir, branchName, worktreePath })
  api.window.broadcast('speckit:state-changed', { state })
  return { ok: true, dispatched: true, queued: false }
}

// Start queued (pending) cards while there is spare capacity.
async function advanceQueue(api: ExtensionAPI, workspacePath: string): Promise<void> {
  const cap = getMaxConcurrent(api)
  const dirs = await listCardDirs(workspacePath)
  const pending: PilotState[] = []
  for (const dir of dirs) {
    const s = await readMigratedState(dir)
    if (s && s.queuePosition === 'pending') pending.push(s)
  }
  const ordered = orderPending(
    pending.map((s) => ({
      featureDir: s.featureDir,
      startedAt: s.run?.startedAt ?? null,
      state: s,
    }))
  )
  for (const item of ordered) {
    const active = await countActiveRuns(workspacePath)
    if (shouldQueue(active, cap)) break
    // The queue drains into the same wall: unreviewed diffs pile up whether a
    // run was started by hand or by the queue emptying itself.
    if (supervision?.backpressure.check().allowed === false) break
    const s = item.state
    try {
      const { worktreePath, branchName } = await createWorktree(
        api,
        s.featureDir,
        workspacePath,
        s.ticket
      )
      s.worktreePath = worktreePath
      s.branchName = branchName
      s.queuePosition = 'active'
      s.stage = deriveStage(s.phases, s.run)
      await writePilotState(s.featureDir, s)
      const qCard = (await readCard(s.featureDir)) ?? s.card
      await writeWorktreeTicket(worktreePath, qCard, s.ticket)
      await startRunAt(api, s.featureDir, worktreePath, firstRunnablePhase(s), s.mode, s.card.title)
      api.window.broadcast('speckit:dispatch-started', {
        featureDir: s.featureDir,
        branchName,
        worktreePath,
      })
      api.window.broadcast('speckit:state-changed', { state: s })
    } catch (err) {
      api.notifications.showToast(
        'error',
        `Could not start queued card: ${String(err)}`,
        'startQueuedCardFailed'
      )
    }
  }
}

// Check which artifact paths exist for a feature dir
async function checkArtifacts(
  featureDir: string,
  repoRoot: string
): Promise<Record<string, boolean>> {
  const PHASE_ARTIFACT_MAP: Record<string, string[]> = {
    constitution: ['.specify/memory/constitution.md'],
    specify: ['spec.md'],
    clarify: ['spec.md'],
    plan: ['plan.md'],
    checklist: ['checklists'],
    tasks: ['tasks.md'],
    analyze: ['tasks.md'],
    implement: ['tasks.md'],
  }
  const result: Record<string, boolean> = {}
  for (const [phase, artifacts] of Object.entries(PHASE_ARTIFACT_MAP)) {
    let exists = false
    for (const rel of artifacts) {
      const absPath = rel.startsWith('.specify')
        ? path.join(repoRoot, rel)
        : path.join(featureDir, rel)
      try {
        await fs.promises.access(absPath)
        exists = true
        break
      } catch {
        // not found
      }
    }
    result[phase] = exists
  }
  return result
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
    properties[`terminator.speckit-pilot.notify.${key}.system`] = {
      type: 'boolean',
      label: `${label} → System notification`,
      default: true,
    }
    properties[`terminator.speckit-pilot.notify.${key}.center`] = {
      type: 'boolean',
      label: `${label} → In-app notification center`,
      default: true,
    }
    properties[`terminator.speckit-pilot.notify.${key}.toast`] = {
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
  actions?: Array<{ id: string; label: string; handler: () => void }>
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
  return api.settings.get<boolean>('terminator.speckit-pilot.stallShadowMode') ?? true
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
    setReadOnlyStateDir(
      path.join(api.settings.resolveWorktreeBaseDir(''), '.speckit-pilot-runtime')
    )
  } catch {
    setReadOnlyStateDir(null)
  }

  try {
    control = await createControlServer()
    supervisedRunner = createSupervisedRunner({
      api,
      control,
      stateDir: path.join(api.settings.resolveWorktreeBaseDir(''), '.speckit-pilot-runtime'),
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
            { id: 'open', label: 'Open the board', handler: () => api.window.focusSelf() },
          ]
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
      stateDir: path.join(api.settings.resolveWorktreeBaseDir(''), '.speckit-pilot-runtime'),
    })
    // Registered runs are what everything downstream reads. Without this the
    // review queue, the gate and the stall detector are all correct and empty.
    setRunSupervision(supervision)
    mutes = createMuteStore(
      path.join(api.settings.resolveWorktreeBaseDir(''), '.speckit-pilot-runtime', 'mutes.json')
    )

    const runner = supervisedRunner
    stallWatcher = createStallWatcher({
      runs: () => runner.watchable(),
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
        api.window.broadcast('speckit:stall-fired', { firing, featureDir, shadow })
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
          `A run stopped making progress (${firing.signal})`
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
    return null
  }
}

export function activate(api: ExtensionAPI): void {
  void startSupervisionRuntime(api)

  // What a supervised run is waiting on, and how the operator answers it.
  // Without these a phase blocks at its PreToolUse hook until the bridge hands
  // the decision back to the terminal — which works, but makes the console a
  // spectator of its own agents.
  reg(api, 'speckit:permissions-list', () => ({ pending: pendingPermissions.list() }))

  // The firings, and whether they were recorded or surfaced. Precision is
  // measured against these by hand before shadow mode is turned off.
  reg(api, 'speckit:stalls-list', () => ({
    firings: stallFirings,
    shadowMode: stallShadowMode(api),
  }))

  // What is running, what is waiting to be reviewed, and whether a new run
  // would be refused.
  reg(api, 'speckit:supervision-snapshot', () =>
    supervision === null
      ? { runs: [], review: [], backpressure: { allowed: true, unreviewed: 0, limit: 0 } }
      : supervision.snapshot()
  )

  reg(api, 'speckit:feed-list', () => ({
    entries: supervision?.feed.list() ?? [],
    mutes: mutes?.list() ?? [],
  }))

  // Anything shown as a list should be prunable, and a feed you cannot clear a
  // line from is one you stop reading.
  reg(api, 'speckit:feed-dismiss', (payload: unknown) => {
    const { id } = payload as { id: string }
    supervision?.feed.removeEntry(id)
    return { ok: true }
  })

  reg(api, 'speckit:feed-mute', (payload: unknown) => {
    const { sessionId, author } = payload as { sessionId?: string; author?: 'agent' | 'console' }
    mutes?.add({ sessionId, author })
    return { mutes: mutes?.list() ?? [] }
  })

  reg(api, 'speckit:feed-unmute', (payload: unknown) => {
    const { sessionId, author } = payload as { sessionId?: string; author?: 'agent' | 'console' }
    mutes?.remove({ sessionId, author })
    return { mutes: mutes?.list() ?? [] }
  })

  // What happened while you were away. Progress posts are rolled up rather
  // than replayed one by one — the point of coming back to a digest is not to
  // read every line the agents wrote.
  reg(api, 'speckit:feed-digest', (payload: unknown) => {
    const { from, to } = payload as { from: number; to?: number }
    const entries = supervision?.feed.list() ?? []
    return buildDigest(entries, from, to ?? Date.now())
  })

  reg(api, 'speckit:review-advance', (payload: unknown) => {
    const { sessionId } = payload as { sessionId: string }
    return { step: supervision?.review.advance(sessionId) ?? null }
  })

  // The unit of review is the hunk, not the file: one file routinely holds both
  // the change you asked for and the one you did not.
  reg(api, 'speckit:review-hunks', async (payload: unknown) => {
    const { sessionId } = payload as { sessionId: string }
    const set = await supervision?.hunksFor(sessionId)
    if (set === undefined || set === null) return { files: [], complete: false, fullReject: false }
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

  reg(api, 'speckit:review-decide-hunk', async (payload: unknown) => {
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
  reg(api, 'speckit:review-intent', async (payload: unknown) => {
    const { sessionId, request, agentAccount } = payload as {
      sessionId: string
      request: string
      agentAccount: string
    }
    const intent = await supervision?.intentFor(sessionId, request, agentAccount)
    return { intent: intent ?? null }
  })

  // Merge ordering across the repositories a card touches. A card with one lane
  // costs nothing: every rule collapses to a no-op.
  // Read from the card's own `workitem.json` rather than taken as a payload:
  // the contract between the pipeline and the console is a file, and a surface
  // that had to carry the lanes in would need a producer of its own.
  reg(api, 'speckit:lanes', (payload: unknown) => {
    const { featureDir } = payload as { featureDir: string }
    const card = readCardLanes(featureDir)
    // Null means one repository, which is not a card with a broken work item.
    return { lanes: card === null ? [] : (supervision?.lanes(card) ?? []) }
  })

  reg(api, 'speckit:lane-may-merge', (payload: unknown) => {
    const { featureDir, ord, merged } = payload as {
      featureDir: string
      ord: number
      merged: number[]
    }
    const card = readCardLanes(featureDir)
    if (card === null) {
      // Nothing declared, nothing to wait for.
      return { allowed: true, reason: null, blockingLane: null }
    }
    return (
      supervision?.mayMerge(card, ord, merged ?? []) ?? {
        allowed: false,
        reason: 'the supervision runtime is not running',
        blockingLane: null,
      }
    )
  })

  // Applying the decisions is what makes a rejection mean anything: the
  // rejected hunks come back out of the working copy, the accepted ones stay.
  reg(api, 'speckit:review-apply', async (payload: unknown) => {
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

  reg(api, 'speckit:review-done', (payload: unknown) => {
    const { sessionId } = payload as { sessionId: string }
    supervision?.review.remove(sessionId)
    supervision?.runs.forget(sessionId)
    return { ok: true }
  })

  reg(api, 'speckit:permission-resolve', (payload: unknown) => {
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
    supervisedRunner.resolve(sessionId, requestId, {
      allow: decision === 'allow',
      answer: answer === undefined || answer.trim() === '' ? undefined : answer,
    })
    return { ok: true }
  })

  // Hands one back deliberately: the operator would rather answer it in the
  // terminal, where they can see what the agent was doing around it.
  reg(api, 'speckit:permission-hand-back', (payload: unknown) => {
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

  // Where it is running, so a surface can take you to the terminal rather than
  // describe one.
  reg(api, 'speckit:run-terminal', (payload: unknown) => {
    const { sessionId } = payload as { sessionId: string }
    return { terminalSessionId: supervisedRunner?.terminalFor(sessionId) ?? null }
  })

  // What it was doing, in its own words. The action that decides the others.
  reg(api, 'speckit:run-transcript', (payload: unknown) => {
    const { sessionId, limit } = payload as { sessionId: string; limit?: number }
    const run = supervision?.runs.get(sessionId) ?? null
    if (run === null) return { lines: [] }
    return { lines: readTranscriptTail(run.transcriptPath, limit ?? 40) }
  })

  // Ends the turn and keeps the session, which is what makes the next message
  // land instead of queueing behind whatever it is part-way through.
  reg(api, 'speckit:run-interrupt', (payload: unknown) => {
    const { sessionId } = payload as { sessionId: string }
    if (supervisedRunner === null) return { ok: false }
    supervisedRunner.interrupt(sessionId)
    return { ok: true }
  })

  // Asking it what is wrong, or telling it what to do instead — the same
  // action, and the reason interrupt does not also end the run.
  reg(api, 'speckit:run-redirect', (payload: unknown) => {
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
  reg(api, 'speckit:run-stop', (payload: unknown) => {
    const { sessionId, reason } = payload as { sessionId: string; reason?: string }
    if (supervisedRunner === null) return { ok: false }
    const ok = supervisedRunner.stop(sessionId, reason)
    if (ok) supervision?.finish(sessionId, Date.now())
    return { ok }
  })

  // Kill and discard: the run ends, its worktree and branch go with it, and the
  // card is put back where it can be started again. A discarded run must not
  // keep occupying a review slot — that would gate the next run on reviewing a
  // diff that no longer exists.
  reg(api, 'speckit:run-discard', async (payload: unknown) => {
    const { sessionId, workspacePath } = payload as {
      sessionId: string
      workspacePath?: string
    }
    const run = supervision?.runs.get(sessionId) ?? null
    supervisedRunner?.stop(sessionId, 'Discarding this run.')
    if (run !== null) {
      await discardWorktree(api, workspacePath ?? '', run.worktreePath, run.branch)
      supervision?.review.remove(sessionId)
      supervision?.runs.forget(sessionId)
      // Everything said about it goes too: the run, its worktree and its branch
      // are gone, so its feed entries are noise about something that no longer
      // exists. Posted after, so the discard itself is what remains.
      supervision?.feed.forget(sessionId)
      supervision?.feed.post({
        at: Date.now(),
        sessionId,
        author: 'console',
        summary: `discarded ${path.basename(run.featureDir)} and removed its worktree`,
      })
    }
    return { ok: run !== null }
  })

  // speckit:feature-list — scan specs/ for feature dirs
  reg(api, 'speckit:feature-list', async (payload: unknown) => {
    const { repoRoot } = payload as { repoRoot: string }
    if (!repoRoot) return { error: 'repoRoot required' }
    const features = await listFeatures(repoRoot)
    return { features }
  })

  // speckit:card-list — board data: every card with brief + derived stage + phase summary
  reg(api, 'speckit:card-list', async (payload: unknown) => {
    const { repoRoot } = payload as { repoRoot: string }
    if (!repoRoot) return { error: 'repoRoot required' }
    const dirs = await listCardDirs(repoRoot)
    const retentionDays = getLogRetentionDays(api)
    const cards: CardSummary[] = []
    for (const dir of dirs) {
      void pruneOldLogs(dir, retentionDays).catch(() => {})
      const state = await readMigratedState(dir)
      if (!state) continue
      const card = await readCard(dir)
      cards.push(buildCardSummary(state, card))
    }
    return { cards }
  })

  // speckit:card-create — create a native (or ticket-seeded) card in the backlog
  reg(api, 'speckit:card-create', async (payload: unknown) => {
    const { repoRoot, brief, ticket } = payload as {
      repoRoot: string
      brief: Partial<CardBrief> & { title: string }
      ticket?: TicketRef
    }
    if (!repoRoot) return { error: 'repoRoot required' }
    if (!brief || !brief.title || brief.title.trim().length === 0) {
      return { error: 'VALIDATION_ERROR', message: 'A card needs a title' }
    }
    try {
      const specsDir = path.join(repoRoot, 'specs')
      await fs.promises.mkdir(specsDir, { recursive: true })
      const existing = await fs.promises.readdir(specsDir).catch(() => [])
      const nums = existing
        .map((d) => parseInt(d.split('-')[0] ?? '0', 10))
        .filter((n) => !isNaN(n))
      const nextNum = nums.length > 0 ? Math.max(...nums) + 1 : 1
      const slugBase = (ticket?.key ?? brief.title).toLowerCase().replace(/[^a-z0-9]+/g, '-')
      const slug = slugBase.replace(/^-|-$/g, '') || 'card'
      const featureDirName = `${String(nextNum).padStart(3, '0')}-${slug}`
      const featureDir = path.join(specsDir, featureDirName)
      await fs.promises.mkdir(featureDir, { recursive: true })

      const card: CardBrief = {
        ...createDefaultBrief(brief.title, brief.source ?? ticket?.source ?? 'native'),
        ...brief,
        title: brief.title,
      }
      await writeCard(featureDir, card)
      const state = createInitialState(featureDir, { card, ticket: ticket ?? null })
      await writePilotState(featureDir, state)
      api.window.broadcast('speckit:state-changed', { state })
      return { featureDir }
    } catch (err) {
      api.notifications.showToast(
        'error',
        `Could not create card: ${String(err)}`,
        'createCardFailed'
      )
      return { error: String(err) }
    }
  })

  // speckit:card-update — edit a card's brief
  reg(api, 'speckit:card-update', async (payload: unknown) => {
    const { featureDir, brief } = payload as { featureDir: string; brief: Partial<CardBrief> }
    if (!featureDir) return { error: 'featureDir required' }
    if (brief.title !== undefined && brief.title.trim().length === 0) {
      return { error: 'VALIDATION_ERROR', message: 'Title cannot be empty' }
    }
    try {
      const existing = (await readCard(featureDir)) ?? createDefaultBrief(path.basename(featureDir))
      const updated: CardBrief = { ...existing, ...brief }
      await writeCard(featureDir, updated)
      const state = await readMigratedState(featureDir)
      if (state) {
        state.card = updated
        await writePilotState(featureDir, state)
        api.window.broadcast('speckit:state-changed', { state })
      }
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  // speckit:card-comment — append a comment; queued to steer the next phase run
  reg(api, 'speckit:card-comment', async (payload: unknown) => {
    const { featureDir, body } = payload as { featureDir: string; body: string }
    if (!featureDir) return { error: 'featureDir required' }
    if (!body || body.trim().length === 0) {
      return { error: 'VALIDATION_ERROR', message: 'Comment cannot be empty' }
    }
    try {
      const comment: CardComment = {
        id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        author: 'you',
        body,
        ts: new Date().toISOString(),
        appliedToRunId: null,
      }
      await appendComment(featureDir, comment)
      const state = await readMigratedState(featureDir)
      if (state) api.window.broadcast('speckit:state-changed', { state })
      return { comment }
    } catch (err) {
      return { error: String(err) }
    }
  })

  // speckit:run-output-read — load persisted output for a phase (review past runs)
  reg(api, 'speckit:run-output-read', async (payload: unknown) => {
    const { featureDir, phase } = payload as { featureDir: string; phase: PhaseId }
    if (!featureDir || !phase) return { error: 'featureDir and phase required' }
    try {
      const raw = await fs.promises.readFile(phaseLogPath(featureDir, phase), 'utf-8')
      const lines = raw.split('\n').filter((l) => l.length > 0)
      return { lines }
    } catch {
      return { lines: [] }
    }
  })

  // speckit:comment-list — load a card's comments
  reg(api, 'speckit:comment-list', async (payload: unknown) => {
    const { featureDir } = payload as { featureDir: string }
    if (!featureDir) return { error: 'featureDir required' }
    const comments = await readComments(featureDir)
    return { comments }
  })

  // speckit:card-move — user-driven board organization. Sets the card's stage; it
  // never starts a run. Dropping an active card onto Backlog parks (stops) its run.
  reg(api, 'speckit:card-move', async (payload: unknown) => {
    const { featureDir, workspacePath, toStage } = payload as {
      featureDir: string
      workspacePath: string
      toStage: BoardStage
    }
    if (!featureDir || !workspacePath) return { error: 'featureDir and workspacePath required' }
    if (!STAGE_ORDER.includes(toStage)) {
      return { error: 'VALIDATION_ERROR', message: `Unknown stage: ${toStage}` }
    }
    try {
      const state = await readMigratedState(featureDir)
      if (!state) return { error: 'No card state found' }

      const runActive = state.run != null && state.run.status === 'running'
      // Parking an in-flight run: stop it, drop the worktree, free the slot.
      if (toStage === 'backlog' && runActive) {
        const handle = activeRunnerHandles.get(featureDir)
        if (handle) {
          handle.stop()
          activeRunnerHandles.delete(featureDir)
        }
        await discardWorktree(api, workspacePath, state.worktreePath, state.branchName)
        state.run = { ...state.run!, status: 'cancelled', completedAt: new Date().toISOString() }
        state.queuePosition = null
        state.worktreePath = null
        state.branchName = null
        await appendHistory(featureDir, {
          ts: new Date().toISOString(),
          actor: 'user',
          action: 'run_cancelled',
          phase: 'constitution',
          note: 'parked to backlog',
        })
      }

      state.stage = toStage
      await writePilotState(featureDir, state)
      api.window.broadcast('speckit:state-changed', { state })
      if (toStage === 'backlog' && runActive) await advanceQueue(api, workspacePath)
      return { ok: true }
    } catch (err) {
      api.notifications.showToast('error', `Could not move card: ${String(err)}`, 'moveCardFailed')
      return { error: String(err) }
    }
  })

  // speckit:card-handoff — explicit "start" action: run the card through the pipeline
  reg(api, 'speckit:card-handoff', async (payload: unknown) => {
    const { featureDir, workspacePath, baseBranch, mode, overrideBackpressure } = payload as {
      featureDir: string
      workspacePath: string
      baseBranch?: string
      mode?: RunMode
      overrideBackpressure?: boolean
    }
    if (!featureDir || !workspacePath) return { error: 'featureDir and workspacePath required' }
    try {
      return await handoffCard(
        api,
        featureDir,
        workspacePath,
        baseBranch,
        mode,
        overrideBackpressure
      )
    } catch (err) {
      api.notifications.showToast('error', `Handoff failed: ${String(err)}`, 'handoffFailed')
      return { error: String(err) }
    }
  })

  // speckit:artifact-list — enumerate a card's artifacts with git revision history
  reg(api, 'speckit:artifact-list', async (payload: unknown) => {
    const { featureDir } = payload as { featureDir: string }
    if (!featureDir) return { error: 'featureDir required' }
    try {
      const state = await readMigratedState(featureDir)
      const cwd = state?.worktreePath ?? path.dirname(path.dirname(featureDir))
      const artifacts: ArtifactRef[] = []
      for (const spec of artifactSpecs()) {
        if (spec.relPath === null) {
          artifacts.push(
            buildArtifactRef(spec, { exists: false, revisions: [], prUrl: state?.prUrl })
          )
          continue
        }
        const absPath = path.join(featureDir, spec.relPath)
        let exists = false
        try {
          await fs.promises.access(absPath)
          exists = true
        } catch {
          exists = false
        }
        let revisions: ReturnType<typeof parseGitLog> = []
        if (exists) {
          try {
            const rel = path.relative(cwd, absPath)
            const res = await api.shell.exec({
              command: 'git',
              args: ['log', '--pretty=format:%h%x09%cI%x09%s', '--', rel],
              cwd,
            })
            if (res.exitCode === 0) revisions = parseGitLog(res.stdout)
          } catch {
            revisions = []
          }
        }
        artifacts.push(buildArtifactRef(spec, { exists, revisions }))
      }
      return { artifacts }
    } catch (err) {
      return { error: String(err) }
    }
  })

  // speckit:knowledge-search — keyword search across repo markdown + card briefs/specs
  reg(api, 'speckit:knowledge-search', async (payload: unknown) => {
    const { repoRoot, query } = payload as { repoRoot: string; query: string }
    if (!repoRoot || !query) return { error: 'repoRoot and query required' }
    try {
      // `git grep`, not `rg`: the host only permits git and gh, so the ripgrep
      // call this replaced threw on every search and the fallback below was
      // doing all the work — silently, because nothing typechecked this file.
      // Same `path:line:text` output, so the parser is unchanged.
      const res = await api.shell.exec({
        command: 'git',
        args: ['grep', '--line-number', '--no-color', '-I', '-i', '-e', query, '--', '*.md'],
        cwd: repoRoot,
      })
      // 0 = matches, 1 = none. Both are answers; anything else is a failure.
      if (res.exitCode === 0 || res.exitCode === 1) {
        return { results: parseRgLines(res.stdout) }
      }
    } catch {
      // Not a repository, or git is unavailable — fall through to the fs scan,
      // which also covers files git has never seen.
    }
    // Fallback: scan markdown under specs/ and docs/ plus README.md
    const files: { file: string; content: string }[] = []
    const roots = ['specs', 'docs']
    async function walk(rel: string): Promise<void> {
      const abs = path.join(repoRoot, rel)
      let entries: fs.Dirent[] = []
      try {
        entries = await fs.promises.readdir(abs, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        const childRel = path.join(rel, e.name)
        if (e.isDirectory()) {
          await walk(childRel)
        } else if (e.name.endsWith('.md')) {
          try {
            files.push({
              file: childRel,
              content: await fs.promises.readFile(path.join(repoRoot, childRel), 'utf-8'),
            })
          } catch {
            // skip unreadable
          }
        }
      }
    }
    for (const r of roots) await walk(r)
    try {
      const readme = await fs.promises.readFile(path.join(repoRoot, 'README.md'), 'utf-8')
      files.push({ file: 'README.md', content: readme })
    } catch {
      // no README
    }
    return { results: searchFiles(files, query) }
  })

  // speckit:check-artifacts — which phase artifact files exist?
  reg(api, 'speckit:check-artifacts', async (payload: unknown) => {
    const { featureDir, repoRoot } = payload as { featureDir: string; repoRoot: string }
    if (!featureDir || !repoRoot) return { error: 'featureDir and repoRoot required' }
    const exists = await checkArtifacts(featureDir, repoRoot)
    return { exists }
  })

  // speckit:pilot-state — load or create .pilot/state.json
  reg(api, 'speckit:pilot-state', async (payload: unknown) => {
    const { featureDir } = payload as { featureDir: string }
    if (!featureDir) return { error: 'featureDir required' }
    const state = await readPilotState(featureDir)
    if (!state) return { notFound: true }
    return { state }
  })

  // speckit:phase-approve — mark a phase approved
  reg(api, 'speckit:phase-approve', async (payload: unknown) => {
    const { featureDir, phase, note } = payload as {
      featureDir: string
      phase: PhaseId
      note?: string
    }
    if (!featureDir || !phase) return { error: 'featureDir and phase required' }
    let state = await readPilotState(featureDir)
    if (!state) state = createPilotState(featureDir)
    const ps = state.phases[phase]
    if (!ps) return { error: `Unknown phase: ${phase}` }
    ps.status = 'approved'
    ps.approvedAt = new Date().toISOString()
    ps.approvedBy = 'user'
    if (note) ps.lastRunId = note
    // Mark downstream approved phases as stale
    const idx = PHASE_ORDER.indexOf(phase)
    for (let i = idx + 1; i < PHASE_ORDER.length; i++) {
      const downstream = state.phases[PHASE_ORDER[i]]
      if (downstream && downstream.status === 'approved') {
        downstream.status = 'stale'
      }
    }
    if (state.run && state.run.status === 'running') {
      state.stage = deriveStage(state.phases, state.run)
    }
    await writePilotState(featureDir, state)
    await appendHistory(featureDir, {
      ts: new Date().toISOString(),
      actor: 'user',
      action: 'approved',
      phase,
      note,
    })
    api.window.broadcast('speckit:state-changed', { state })

    // Auto-start the next phase if the run is still active
    const nextPhaseId = PHASE_ORDER[idx + 1]
    if (nextPhaseId && nextPhaseId !== 'open-pr' && state.run?.status !== 'cancelled') {
      const nextPs = state.phases[nextPhaseId]
      if (nextPs && (nextPs.status === 'locked' || nextPs.status === 'ready')) {
        nextPs.status = 'ready'
        await writePilotState(featureDir, state)
        const steer = (await consumePendingComments(featureDir, `run-${Date.now()}`)) ?? undefined
        const worktreePath = await ensureWorktreePath(api, featureDir, state)
        const runner = createAgentRunner(api)
        const handle = runner.startPhaseRunner({
          featureDir,
          worktreePath,
          phaseCommand: phaseCommandFor(nextPhaseId, state.mode, cardTitleOf(state)),
          phase: nextPhaseId,
          feedbackNote: steer,
          ...makePhaseCallbacks(api, featureDir, nextPhaseId),
        })
        activeRunnerHandles.set(featureDir, handle)
      }
    }

    return { state }
  })

  // speckit:phase-reject — reject a phase, delete artifact, reset to ready
  reg(api, 'speckit:phase-reject', async (payload: unknown) => {
    const { featureDir, phase, reason } = payload as {
      featureDir: string
      phase: PhaseId
      reason: string
    }
    if (!featureDir || !phase) return { error: 'featureDir and phase required' }
    let state = await readPilotState(featureDir)
    if (!state) state = createPilotState(featureDir)
    const ps = state.phases[phase]
    if (!ps) return { error: `Unknown phase: ${phase}` }
    // Delete phase output artifacts
    for (const artifactPath of ps.artifactPaths) {
      try {
        await fs.promises.unlink(artifactPath)
      } catch {
        // ignore if missing
      }
    }
    ps.status = 'ready'
    ps.approvedAt = null
    ps.approvedBy = null
    ps.approvedHash = null
    await writePilotState(featureDir, state)
    await appendHistory(featureDir, {
      ts: new Date().toISOString(),
      actor: 'user',
      action: 'rejected',
      phase,
      note: reason,
    })
    api.window.broadcast('speckit:state-changed', { state })
    return { state }
  })

  // speckit:phase-revoke — revoke approval, mark downstream stale
  reg(api, 'speckit:phase-revoke', async (payload: unknown) => {
    const { featureDir, phase, note } = payload as {
      featureDir: string
      phase: PhaseId
      note?: string
    }
    if (!featureDir || !phase) return { error: 'featureDir and phase required' }
    let state = await readPilotState(featureDir)
    if (!state) state = createPilotState(featureDir)
    const ps = state.phases[phase]
    if (!ps) return { error: `Unknown phase: ${phase}` }
    ps.status = 'awaiting_review'
    ps.approvedAt = null
    ps.approvedBy = null
    ps.approvedHash = null
    // Mark all downstream approved phases as stale
    const idx = PHASE_ORDER.indexOf(phase)
    for (let i = idx + 1; i < PHASE_ORDER.length; i++) {
      const downstream = state.phases[PHASE_ORDER[i]]
      if (downstream && downstream.status === 'approved') {
        downstream.status = 'stale'
      }
    }
    await writePilotState(featureDir, state)
    await appendHistory(featureDir, {
      ts: new Date().toISOString(),
      actor: 'user',
      action: 'revoked',
      phase,
      note,
    })
    api.window.broadcast('speckit:state-changed', { state })
    return { state }
  })

  // speckit:artifact-read — read current file + last approved (via git) for diff.
  // When `commit` is given, `current` is that revision's content (git show <commit>:path).
  reg(api, 'speckit:artifact-read', async (payload: unknown) => {
    const { filePath, featureDir, repoRoot, commit } = payload as {
      filePath: string
      featureDir?: string
      repoRoot?: string
      commit?: string
    }
    if (!filePath) return { error: 'filePath required' }
    const cwd = repoRoot || featureDir || path.dirname(filePath)
    const { exec } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const execAsync = promisify(exec)
    const relPath = path.relative(cwd, filePath)

    let current: string | null = null
    if (commit) {
      // Read a specific historical revision of the file.
      try {
        const result = await execAsync(`git show ${commit}:${relPath}`, { cwd })
        current = result.stdout
      } catch {
        current = null
      }
    } else {
      try {
        current = await fs.promises.readFile(filePath, 'utf-8')
      } catch {
        current = null
      }
    }

    // Try to get approved (HEAD) version from git
    let approved: string | null = null
    try {
      const result = await execAsync(`git show HEAD:${relPath}`, { cwd })
      approved = result.stdout
    } catch {
      approved = null
    }
    return { current, approved }
  })

  // speckit:history-load — read and parse history.jsonl
  reg(api, 'speckit:history-load', async (payload: unknown) => {
    const { featureDir } = payload as { featureDir: string }
    if (!featureDir) return { error: 'featureDir required' }
    const entries = await readHistory(featureDir)
    return { entries }
  })

  // speckit:session-list — return active terminal sessions
  reg(api, 'speckit:session-list', (_payload: unknown) => {
    return { sessions: Array.from(activeSessions.values()) }
  })

  // speckit:implement-stop — stop an active implement run
  reg(api, 'speckit:implement-stop', async (payload: unknown) => {
    const { featureDir, phase } = payload as { featureDir: string; phase?: PhaseId }
    if (!featureDir) return { error: 'featureDir required' }
    activeRuns.delete(featureDir)
    if (phase) {
      const state = await readPilotState(featureDir)
      if (state) {
        const ps = state.phases[phase]
        if (ps && ps.status === 'running') {
          ps.status = 'ready'
          await writePilotState(featureDir, state)
          await appendHistory(featureDir, {
            ts: new Date().toISOString(),
            actor: 'user',
            action: 'run_failed',
            phase,
            note: 'stopped by user',
          })
          api.window.broadcast('speckit:state-changed', { state })
        }
      }
    }
    return { ok: true }
  })

  // speckit:checkpoint-create — create a git checkpoint commit before implement run
  reg(api, 'speckit:checkpoint-create', async (payload: unknown) => {
    const { featureDir, repoRoot, worktreePath } = payload as {
      featureDir: string
      repoRoot?: string
      worktreePath?: string
    }
    if (!featureDir) return { error: 'featureDir required' }
    const cwd = worktreePath ?? repoRoot ?? featureDir
    try {
      const { exec } = await import('node:child_process')
      const { promisify } = await import('node:util')
      const execAsync = promisify(exec)
      await execAsync('git add -A', { cwd })
      const result = await execAsync(
        'git commit --allow-empty -m "[SpecKit] checkpoint before implement run"',
        { cwd }
      )
      // Extract commit hash from output
      const match = result.stdout.match(/\[[\w/]+ ([0-9a-f]+)\]/)
      return { commitHash: match ? match[1] : 'unknown' }
    } catch (err) {
      return { error: String(err) }
    }
  })

  // speckit:phase-skip — mark a phase as intentionally skipped
  reg(api, 'speckit:phase-skip', async (payload: unknown) => {
    const { featureDir, phase, note } = payload as {
      featureDir: string
      phase: PhaseId
      note?: string
    }
    if (!featureDir || !phase) return { error: 'featureDir and phase required' }
    let state = await readPilotState(featureDir)
    if (!state) state = createPilotState(featureDir)
    const ps = state.phases[phase]
    if (!ps) return { error: `Unknown phase: ${phase}` }
    ps.status = 'skipped'
    ps.approvedAt = null
    ps.approvedBy = null
    ps.approvedHash = null
    await writePilotState(featureDir, state)
    await appendHistory(featureDir, {
      ts: new Date().toISOString(),
      actor: 'user',
      action: 'skipped',
      phase,
      note,
    })
    api.window.broadcast('speckit:state-changed', { state })
    return { state }
  })

  // speckit:phase-unskip — restore a skipped phase back to ready
  reg(api, 'speckit:phase-unskip', async (payload: unknown) => {
    const { featureDir, phase, note } = payload as {
      featureDir: string
      phase: PhaseId
      note?: string
    }
    if (!featureDir || !phase) return { error: 'featureDir and phase required' }
    let state = await readPilotState(featureDir)
    if (!state) state = createPilotState(featureDir)
    const ps = state.phases[phase]
    if (!ps) return { error: `Unknown phase: ${phase}` }
    ps.status = 'ready'
    await writePilotState(featureDir, state)
    await appendHistory(featureDir, {
      ts: new Date().toISOString(),
      actor: 'user',
      action: 'unskipped',
      phase,
      note,
    })
    api.window.broadcast('speckit:state-changed', { state })
    return { state }
  })

  // speckit:implement-file-decision — approve or skip a pending file write
  reg(api, 'speckit:implement-file-decision', async (payload: unknown) => {
    const { filePath, decision, featureDir, repoRoot } = payload as {
      filePath: string
      decision: 'approve' | 'skip'
      featureDir: string
      repoRoot?: string
    }
    if (!filePath || !decision) return { error: 'filePath and decision required' }
    if (decision === 'skip') {
      const cwd = repoRoot || featureDir
      try {
        const { exec } = await import('node:child_process')
        const { promisify } = await import('node:util')
        const execAsync = promisify(exec)
        await execAsync(`git checkout -- "${filePath}"`, { cwd })
      } catch {
        // ignore if file not tracked
      }
    }
    await appendHistory(featureDir, {
      ts: new Date().toISOString(),
      actor: 'user',
      action: decision === 'approve' ? 'file_approved' : 'file_skipped',
      phase: 'implement',
      filePath,
    })
    return { ok: true }
  })

  // speckit:file-write — write any file within the project (markdown edits)
  reg(api, 'speckit:file-write', async (payload: unknown) => {
    const { filePath, content } = payload as { filePath: string; content: string }
    if (!filePath || content === undefined) return { error: 'filePath and content required' }
    try {
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
      await fs.promises.writeFile(filePath, content, 'utf-8')
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  // speckit:ticket-list — fetch tickets from Linear and/or Jira in parallel
  reg(api, 'speckit:ticket-list', async () => {
    try {
      const [linearKey, linearEmail, jiraCreds] = await Promise.all([
        getLinearKey(),
        getLinearEmail(),
        getJiraCredentials(),
      ])
      const fetches: Promise<unknown[]>[] = []
      if (linearKey) fetches.push(fetchLinearTickets(linearKey, linearEmail).catch(() => []))
      if (jiraCreds) fetches.push(fetchJiraTickets(jiraCreds).catch(() => []))
      if (fetches.length === 0) return { tickets: [] }
      const results = await Promise.all(fetches)
      const tickets = results.flat()
      return { tickets }
    } catch (err) {
      api.notifications.showToast(
        'error',
        `Could not fetch tickets: ${String(err)}`,
        'fetchTicketsFailed'
      )
      return { error: String(err) }
    }
  })

  // speckit:credentials-set — store Linear or Jira credentials
  reg(api, 'speckit:credentials-set', async (payload: unknown) => {
    const p = payload as { source: 'linear' | 'jira'; apiKey?: string } & Partial<JiraCreds>
    try {
      if (p.source === 'linear') {
        if (p.apiKey) {
          await setLinearKey(p.apiKey, p.email)
        } else {
          // Update just the lookup email without touching the stored key
          await setLinearEmail(p.email ?? '')
        }
      } else if (p.source === 'jira') {
        await setJiraCredentials({
          domain: p.domain ?? '',
          email: p.email ?? '',
          apiToken: p.apiToken ?? '',
          jql: p.jql ?? '',
        })
      } else {
        return { error: 'source and credentials required' }
      }
      return { ok: true }
    } catch (err) {
      api.notifications.showToast(
        'error',
        `Could not save credentials: ${String(err)}`,
        'saveCredentialsFailed'
      )
      return { error: String(err) }
    }
  })

  // speckit:credentials-status — return connection status only, never raw credentials
  reg(api, 'speckit:credentials-status', async (payload: unknown) => {
    const { source } = payload as { source: 'linear' | 'jira' }
    try {
      if (source === 'linear') {
        const [key, email] = await Promise.all([getLinearKey(), getLinearEmail()])
        return { connected: key !== null, email: email ?? undefined }
      } else if (source === 'jira') {
        const creds = await getJiraCredentials()
        if (!creds) return { connected: false }
        return { connected: true, domain: creds.domain, email: creds.email }
      }
      return { connected: false }
    } catch (err) {
      return { connected: false, error: String(err) }
    }
  })

  // speckit:dispatch — create feature dir, init state v2, start agent on constitution phase
  reg(api, 'speckit:dispatch', async (payload: unknown) => {
    const { ticket, workspacePath, autonomyLevel, baseBranch, mode } = payload as {
      ticket: TicketRef
      workspacePath: string
      autonomyLevel?: 'guided' | 'standard' | 'fast'
      baseBranch?: string
      mode?: RunMode
    }
    if (!ticket || !workspacePath) return { error: 'ticket and workspacePath required' }

    try {
      // Determine next sequential feature number
      const specsDir = path.join(workspacePath, 'specs')
      await fs.promises.mkdir(specsDir, { recursive: true })
      const existing = await fs.promises.readdir(specsDir).catch(() => [])
      const nums = existing
        .map((d) => parseInt(d.split('-')[0] ?? '0', 10))
        .filter((n) => !isNaN(n))
      const nextNum = nums.length > 0 ? Math.max(...nums) + 1 : 1
      const slug = ticket.key.toLowerCase().replace(/[^a-z0-9]/g, '-')
      const featureDirName = `${String(nextNum).padStart(3, '0')}-${slug}`
      const featureDir = path.join(specsDir, featureDirName)
      await fs.promises.mkdir(featureDir, { recursive: true })

      // Write ticket reference file (shared format with the card-handoff path)
      const dispatchCard = createDefaultBrief(ticket.title, ticket.source)
      await fs.promises.writeFile(
        path.join(featureDir, 'ticket.md'),
        buildTicketMarkdown(dispatchCard, ticket),
        'utf-8'
      )

      const branchName = await resolveBranchName(api, featureDir, workspacePath, ticket)
      // Respect the core app's worktree location setting (workspace override →
      // global → <repo>/.worktrees) instead of a private directory.
      const worktreeRoot = api.settings.resolveWorktreeBaseDir(workspacePath)
      const worktreePath = path.join(worktreeRoot, slug)

      // Create initial state v3 (constitution ready, active run, ticket-seeded card)
      const state = createInitialState(featureDir, {
        card: dispatchCard,
        ticket,
        mode: mode ?? 'speckit',
        run: {
          status: 'running',
          startedAt: new Date().toISOString(),
          completedAt: null,
          autonomyLevel: autonomyLevel ?? 'standard',
        },
        queuePosition: 'active',
        worktreePath,
        branchName,
      })

      const pilotDir = path.join(featureDir, '.pilot')
      await fs.promises.mkdir(pilotDir, { recursive: true })
      const stateFile = path.join(pilotDir, 'state.json')
      const tmp = `${stateFile}.tmp`
      await fs.promises.writeFile(tmp, JSON.stringify(state, null, 2), 'utf-8')
      await fs.promises.rename(tmp, stateFile)

      // Create git worktree branching from baseBranch (or HEAD if not specified),
      // reusing the branch if it already exists.
      const worktreeArgs = ['worktree', 'add', worktreePath]
      if (await branchExists(api, workspacePath, branchName)) {
        worktreeArgs.push(branchName)
      } else {
        worktreeArgs.push('-b', branchName)
        if (baseBranch) worktreeArgs.push(baseBranch)
      }
      const worktreeResult = await api.shell.exec({
        command: 'git',
        args: worktreeArgs,
        cwd: workspacePath,
      })
      if (worktreeResult.exitCode !== 0) {
        return {
          error: `Could not create worktree: ${worktreeResult.stderr || worktreeResult.stdout}`,
        }
      }

      // Copy ticket.md into the worktree so phase prompts can reference it by relative path
      await fs.promises.copyFile(
        path.join(featureDir, 'ticket.md'),
        path.join(worktreePath, 'ticket.md')
      )

      // Prime phases (honor skip-Constitution) and start at the first runnable phase
      primePhasesForRun(state)
      state.stage = deriveStage(state.phases, state.run)
      await writePilotState(featureDir, state)

      // Dispatch provisions the card and then runs it. The gate is checked here
      // too — a card taken in from a tracker is still an agent starting while
      // diffs wait, and refusing after the worktree exists would waste it.
      const gate = supervision?.backpressure.check()
      if (gate !== undefined && !gate.allowed) {
        state.queuePosition = 'pending'
        await writePilotState(featureDir, state)
        api.window.broadcast('speckit:state-changed', { state })
        return { featureDir, queued: true, reason: gate.reason, backpressure: gate }
      }

      await startRunAt(
        api,
        featureDir,
        worktreePath,
        firstRunnablePhase(state),
        state.mode,
        state.card.title
      )

      api.window.broadcast('speckit:dispatch-started', { featureDir, branchName, worktreePath })
      api.window.broadcast('speckit:state-changed', { state })
      return { featureDir, queued: false }
    } catch (err) {
      api.notifications.showToast('error', `Dispatch failed: ${String(err)}`, 'dispatchFailed')
      return { error: String(err) }
    }
  })

  // speckit:run-cancel — stop runner, optionally remove worktree+branch, update state
  reg(api, 'speckit:run-cancel', async (payload: unknown) => {
    const { featureDir, workspacePath, deleteWorktree } = payload as {
      featureDir: string
      workspacePath: string
      deleteWorktree?: boolean
    }
    if (!featureDir) return { error: 'featureDir required' }

    try {
      const handle = activeRunnerHandles.get(featureDir)
      if (handle) {
        handle.stop()
        activeRunnerHandles.delete(featureDir)
      }

      const state = await readPilotState(featureDir)
      if (deleteWorktree && state?.worktreePath) {
        const cwd = workspacePath ?? path.dirname(path.dirname(featureDir))
        await api.shell
          .exec({
            command: 'git',
            args: ['worktree', 'remove', state.worktreePath, '--force'],
            cwd,
          })
          .catch(() => {})
        if (state.branchName) {
          await api.shell
            .exec({ command: 'git', args: ['branch', '-D', state.branchName], cwd })
            .catch(() => {})
        }

        // Remove the corresponding workspace project (matched by branch name)
        if (state.branchName) {
          const workspace = api.workspace.list().find((w) => w.folderPath === workspacePath)
          if (workspace) {
            const project = api.workspace
              .listProjects(workspace.id)
              .find((p) => p.name === state.branchName)
            if (project) {
              api.workspace.deleteProject(project.id)
              api.window.broadcast('workspace:project-removed', { id: project.id })
            }
          }
        }
      }

      if (state) {
        state.run = state.run
          ? { ...state.run, status: 'cancelled', completedAt: new Date().toISOString() }
          : null
        state.queuePosition = null
        await writePilotState(featureDir, state)
        await appendHistory(featureDir, {
          ts: new Date().toISOString(),
          actor: 'user',
          action: 'run_cancelled',
          phase: 'constitution',
        })
        api.window.broadcast('speckit:state-changed', { state })
        if (workspacePath) await advanceQueue(api, workspacePath)
        return { ok: true, state }
      }

      if (workspacePath) await advanceQueue(api, workspacePath)
      return { ok: true }
    } catch (err) {
      api.notifications.showToast('error', `Cancel failed: ${String(err)}`, 'cancelFailed')
      return { error: String(err) }
    }
  })

  // speckit:card-reset — wipe a card's entire run so it can start over. Stops the
  // runner, removes the worktree + branch, deletes .pilot logs/history/self-review,
  // and resets phases/run to the initial state. The card brief, ticket, mode, and
  // settings are preserved so the card can be re-dispatched cleanly.
  reg(api, 'speckit:card-reset', async (payload: unknown) => {
    const { featureDir, workspacePath } = payload as {
      featureDir: string
      workspacePath?: string
    }
    if (!featureDir) return { error: 'featureDir required' }

    try {
      const handle = activeRunnerHandles.get(featureDir)
      if (handle) {
        handle.stop()
        activeRunnerHandles.delete(featureDir)
      }

      const prev = await readPilotState(featureDir)
      const cwd = workspacePath ?? path.dirname(path.dirname(featureDir))

      // Tear down the worktree + branch (best-effort; a manually deleted worktree
      // must not block the reset).
      if (prev?.worktreePath) {
        await api.shell
          .exec({ command: 'git', args: ['worktree', 'remove', prev.worktreePath, '--force'], cwd })
          .catch(() => {})
      }
      if (prev?.branchName) {
        await api.shell
          .exec({ command: 'git', args: ['branch', '-D', prev.branchName], cwd })
          .catch(() => {})
        // Drop the mirrored workspace project (matched by branch name).
        const workspace = workspacePath
          ? api.workspace.list().find((w) => w.folderPath === workspacePath)
          : undefined
        if (workspace) {
          const project = api.workspace
            .listProjects(workspace.id)
            .find((p) => p.name === prev.branchName)
          if (project) {
            api.workspace.deleteProject(project.id)
            api.window.broadcast('workspace:project-removed', { id: project.id })
          }
        }
      }

      // Wipe the run history: logs, history.jsonl, self-review, pending comments.
      const pilotDir = path.join(featureDir, '.pilot')
      await fs.promises
        .rm(path.join(pilotDir, 'logs'), { recursive: true, force: true })
        .catch(() => {})
      for (const f of ['history.jsonl', 'self-review.json', 'comments.jsonl']) {
        await fs.promises.rm(path.join(pilotDir, f), { force: true }).catch(() => {})
      }

      // Rebuild a fresh initial state, preserving the card brief, ticket, and mode.
      const card = (await readCard(featureDir)) ?? prev?.card
      const state = createInitialState(featureDir, {
        card: card ?? undefined,
        ticket: prev?.ticket ?? null,
        mode: prev?.mode ?? 'speckit',
      })
      await writePilotState(featureDir, state)
      await appendHistory(featureDir, {
        ts: new Date().toISOString(),
        actor: 'user',
        action: 'reset',
        phase: firstRunnablePhase(state),
      })
      api.window.broadcast('speckit:state-changed', { state })
      if (workspacePath) await advanceQueue(api, workspacePath)
      return { ok: true, state }
    } catch (err) {
      api.notifications.showToast('error', `Reset failed: ${String(err)}`, 'resetFailed')
      return { error: String(err) }
    }
  })

  // speckit:run-reply — answer the model's question from the run console by
  // resuming the last Claude session with the user's text. Output streams back
  // into the same phase console.
  reg(api, 'speckit:run-reply', async (payload: unknown) => {
    const { featureDir, text } = payload as { featureDir?: string; text?: string }
    if (!featureDir || !text || !text.trim()) return { error: 'featureDir and text required' }

    const sessionId = phaseSessionIds.get(featureDir)
    if (!sessionId) {
      return { error: 'No active conversation to reply to yet — run a phase first.' }
    }
    const state = await readPilotState(featureDir)
    if (!state) return { error: 'No pilot state found' }
    const worktreePath = await ensureWorktreePath(api, featureDir, state)

    // Reply against whichever phase is live (running or awaiting review).
    const phase =
      PHASE_ORDER.find((p) => {
        const s = state.phases[p]?.status
        return s === 'running' || s === 'awaiting_review'
      }) ?? firstRunnablePhase(state)

    // Echo the user's message into the console so the exchange reads as a chat.
    api.window.broadcast('speckit:run-output', {
      featureDir,
      phase,
      line: `🧑 ${text}`,
      ts: new Date().toISOString(),
    })

    // Stop any still-running phase process before resuming the conversation.
    const existing = activeRunnerHandles.get(featureDir)
    if (existing) {
      existing.stop()
      activeRunnerHandles.delete(featureDir)
    }

    const runner = createAgentRunner(api)
    const handle = runner.startPhaseRunner({
      featureDir,
      worktreePath,
      phaseCommand: text,
      phase,
      resumeSessionId: sessionId,
      ...makePhaseCallbacks(api, featureDir, phase),
    })
    activeRunnerHandles.set(featureDir, handle)
    return { ok: true }
  })

  // speckit:open-pr — run gh pr create, write prUrl to state, comment on ticket
  reg(api, 'speckit:open-pr', async (payload: unknown) => {
    const { featureDir, workspacePath, title, baseBranch } = payload as {
      featureDir: string
      workspacePath: string
      title: string
      baseBranch?: string
    }
    if (!featureDir || !workspacePath) return { error: 'featureDir and workspacePath required' }

    try {
      const state = await readPilotState(featureDir)
      if (!state) return { error: 'No pilot state found' }
      const worktreePath = state.worktreePath
      if (!worktreePath) return { error: 'No worktree path in state' }

      // Verify gh auth
      const authCheck = await api.shell.exec({
        command: 'gh',
        args: ['auth', 'status'],
        cwd: worktreePath,
      })
      if (authCheck.exitCode !== 0) return { error: 'gh auth not configured' }

      // Build PR body with traceability block
      const ticketUrl = state.ticket?.sourceUrl ?? ''
      const specRelPath = path.relative(workspacePath, path.join(featureDir, 'spec.md'))
      const planRelPath = path.relative(workspacePath, path.join(featureDir, 'plan.md'))
      const prBody = [
        `<!-- Ticket: ${ticketUrl} -->`,
        `<!-- Spec: ${specRelPath} -->`,
        `<!-- Plan: ${planRelPath} -->`,
        '',
        state.ticket ? `**Ticket:** [${state.ticket.key}](${ticketUrl})` : '',
        `**Spec:** [${specRelPath}](${specRelPath})`,
        `**Plan:** [${planRelPath}](${planRelPath})`,
      ]
        .filter(Boolean)
        .join('\n')

      const result = await api.shell.exec({
        command: 'gh',
        args: ['pr', 'create', '--title', title, '--body', prBody, '--base', baseBranch ?? 'main'],
        cwd: worktreePath,
      })

      if (result.exitCode !== 0) return { error: result.stderr || 'gh pr create failed' }

      const prUrl = result.stdout.trim()
      state.prUrl = prUrl
      await writePilotState(featureDir, state)
      await appendHistory(featureDir, {
        ts: new Date().toISOString(),
        actor: 'user',
        action: 'pr_opened',
        phase: 'open-pr',
        note: prUrl,
      })

      // Write status back to tracker if configured
      if (state.settings.writeStatusBackOnPrOpen && state.ticket) {
        const ticket = state.ticket
        if (ticket.source === 'linear') {
          const key = await getLinearKey()
          if (key) await postLinearComment(key, ticket.key, `PR opened: ${prUrl}`).catch(() => {})
        } else if (ticket.source === 'jira') {
          const creds = await getJiraCredentials()
          if (creds) await postJiraComment(creds, ticket.key, `PR opened: ${prUrl}`).catch(() => {})
        }
      }

      // Remove worktree
      await api.shell
        .exec({
          command: 'git',
          args: ['worktree', 'remove', worktreePath, '--force'],
          cwd: workspacePath,
        })
        .catch(() => {})

      // Run completed — free the slot and start any queued card
      state.run = state.run
        ? { ...state.run, status: 'completed', completedAt: new Date().toISOString() }
        : state.run
      state.queuePosition = null
      await writePilotState(featureDir, state)

      api.window.broadcast('speckit:state-changed', { state })
      await advanceQueue(api, workspacePath)
      return { prUrl }
    } catch (err) {
      api.notifications.showToast('error', `Open PR failed: ${String(err)}`, 'openPrFailed')
      return { error: String(err) }
    }
  })

  // speckit:checkin-decision — batch check-in: continue/pause/split
  reg(api, 'speckit:checkin-decision', async (payload: unknown) => {
    const { featureDir, decision, batchIndex } = payload as {
      featureDir?: string
      decision: 'continue' | 'pause' | 'split'
      batchIndex?: number
    }
    if (!featureDir) return { error: 'featureDir required' }

    try {
      const handle = activeRunnerHandles.get(featureDir)
      if (handle) {
        handle.stop()
        activeRunnerHandles.delete(featureDir)
      }

      const state = await readPilotState(featureDir)
      if (!state) return { error: 'No pilot state found' }

      if (decision === 'continue') {
        const nextBatch = (batchIndex ?? 0) + 1
        const worktreePath = await ensureWorktreePath(api, featureDir, state)
        const runner = createAgentRunner(api)
        const newHandle = runner.startPhaseRunner({
          featureDir,
          worktreePath,
          phaseCommand: `Continue implementation batch ${nextBatch}`,
          phase: 'implement',
          batchIndex: nextBatch,
          ...makePhaseCallbacks(api, featureDir, 'implement', nextBatch),
        })
        activeRunnerHandles.set(featureDir, newHandle)
        return { ok: true }
      }

      if (decision === 'pause') {
        const ps = state.phases['implement']
        if (ps) ps.batchIndex = batchIndex ?? null
        await writePilotState(featureDir, state)
        api.window.broadcast('speckit:state-changed', { state })
        return { ok: true }
      }

      if (decision === 'split') {
        const ps = state.phases['implement']
        if (ps) {
          ps.status = 'approved'
          ps.batchIndex = batchIndex ?? null
        }
        await writePilotState(featureDir, state)
        await appendHistory(featureDir, {
          ts: new Date().toISOString(),
          actor: 'user',
          action: 'approved',
          phase: 'implement',
          note: `split at batch ${batchIndex}`,
        })
        api.window.broadcast('speckit:state-changed', { state })
        return { ok: true }
      }

      return { error: 'Unknown decision' }
    } catch (err) {
      return { error: String(err) }
    }
  })

  // speckit:self-review-read — read .pilot/self-review.json
  reg(api, 'speckit:self-review-read', async (payload: unknown) => {
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
  reg(api, 'speckit:phase-request-changes', async (payload: unknown) => {
    const { featureDir, phase, note } = payload as {
      featureDir: string
      phase: PhaseId
      note: string
    }
    if (!featureDir || !phase) return { error: 'featureDir and phase required' }
    try {
      let state = await readPilotState(featureDir)
      if (!state) state = createPilotState(featureDir)
      const ps = state.phases[phase]
      if (!ps) return { error: `Unknown phase: ${phase}` }
      ps.feedback = note
      ps.status = 'ready'
      await writePilotState(featureDir, state)
      await appendHistory(featureDir, {
        ts: new Date().toISOString(),
        actor: 'user',
        action: 'request_changes',
        phase,
        note,
      })
      const worktreePath = await ensureWorktreePath(api, featureDir, state)
      const runner = createAgentRunner(api)
      const handle = runner.startPhaseRunner({
        featureDir,
        worktreePath,
        phaseCommand: phaseCommandFor(phase, state.mode, cardTitleOf(state)),
        phase,
        feedbackNote: note,
        ...makePhaseCallbacks(api, featureDir, phase),
      })
      activeRunnerHandles.set(featureDir, handle)
      api.window.broadcast('speckit:state-changed', { state })
      return { state }
    } catch (err) {
      return { error: String(err) }
    }
  })

  // speckit:phase-comment — append an audit note without triggering re-run
  reg(api, 'speckit:phase-comment', async (payload: unknown) => {
    const { featureDir, phase, note } = payload as {
      featureDir: string
      phase: PhaseId
      note: string
    }
    if (!featureDir || !phase) return { error: 'featureDir and phase required' }
    try {
      const state = await readPilotState(featureDir)
      if (!state) return { error: 'No pilot state found' }
      await appendHistory(featureDir, {
        ts: new Date().toISOString(),
        actor: 'user',
        action: 'comment',
        phase,
        note,
      })
      api.window.broadcast('speckit:state-changed', { state })
      return { ok: true, state }
    } catch (err) {
      return { error: String(err) }
    }
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
      label: 'SpecKit Pilot',
      properties: {
        'terminator.speckit-pilot.enabled': {
          type: 'boolean',
          label: 'Enable SpecKit Pilot',
          default: true,
          workspaceScoped: true,
        },
        'terminator.speckit-pilot.maxConcurrentRuns': {
          type: 'number',
          label: 'Maximum cards running in parallel',
          default: 3,
        },
        'terminator.speckit-pilot.logRetentionDays': {
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
      () => {
        // The window first: a command that changes what is on screen behind
        // another window has done nothing you can see.
        api.window.focusSelf()
        api.window.broadcast('speckit:palette-goto', {
          kind: entry.kind,
          sessionId: entry.sessionId,
          terminalSessionId: supervisedRunner?.terminalFor(entry.sessionId) ?? null,
        })
      }
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
