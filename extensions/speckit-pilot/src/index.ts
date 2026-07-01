import type { ExtensionAPI, Disposable } from '../../../src/main/extensions/api'
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
  TicketRef,
} from './types/speckit.types.js'
import { PHASE_ORDER, STAGE_ORDER, createDefaultBrief } from './types/speckit.types.js'
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
import type { ArtifactRef, BoardStage } from './types/speckit.types.js'

const PHASE_COMMANDS: Record<PhaseId, string> = {
  constitution: 'Read and affirm the project constitution',
  specify: 'Write a detailed feature specification in spec.md based on the ticket in ticket.md',
  clarify: 'Review spec.md, identify and resolve open questions and ambiguities, update spec.md',
  plan: 'Create a detailed technical implementation plan in plan.md based on spec.md',
  checklist: 'Generate an implementation checklist from plan.md, save to checklists/',
  tasks: 'Break the checklist into granular file-level tasks, save to tasks.md',
  analyze: 'Analyze existing codebase patterns relevant to tasks.md and document findings',
  implement: 'Implement the tasks described in tasks.md according to the plan',
  'self-review': '', // handled by SELF_REVIEW_CMD in agent-runner; not dispatched as a prompt
  'open-pr': '', // not auto-started; triggered explicitly by user action
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
import { createAgentRunner, phaseLogPath, pruneOldLogs } from './runner/agent-runner.js'
import type { RunnerHandle } from './runner/agent-runner.js'

const disposables: Disposable[] = []

// Active session registry: sessionId → session metadata
const activeSessions: Map<string, { id: string; name: string }> = new Map()

// Active implement run registry: featureDir → runId
const activeRuns: Map<string, string> = new Map()

// Active agent runner handles: featureDir → RunnerHandle
const activeRunnerHandles: Map<string, RunnerHandle> = new Map()

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

// Create a git worktree for a card; returns its path + branch name.
async function createWorktree(
  api: ExtensionAPI,
  featureDir: string,
  workspacePath: string,
  baseBranch?: string
): Promise<{ worktreePath: string; branchName: string }> {
  const slug = path.basename(featureDir).replace(/^\d+-/, '') || path.basename(featureDir)
  const branchName = `feature/${slug}`
  const worktreeRoot =
    (api.settings.get<string>('terminator.speckit-pilot.worktreeRoot') || '').trim() ||
    path.join(workspacePath, '.wt')
  const worktreePath = path.join(worktreeRoot, slug)
  const args = ['worktree', 'add', worktreePath, '-b', branchName]
  if (baseBranch) args.push(baseBranch)
  const res = await api.shell.exec({ command: 'git', args, cwd: workspacePath })
  if (res.exitCode !== 0) throw new Error(res.stderr || res.stdout || 'git worktree add failed')
  return { worktreePath, branchName }
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
  phase: PhaseId
): Promise<void> {
  const runId = `run-${Date.now()}`
  const feedbackNote = (await consumePendingComments(featureDir, runId)) ?? undefined
  const runner = createAgentRunner(api)
  const handle = runner.startPhaseRunner({
    featureDir,
    worktreePath,
    phaseCommand: PHASE_COMMANDS[phase],
    phase,
    feedbackNote,
    ...makePhaseCallbacks(api, featureDir, phase),
  })
  activeRunnerHandles.set(featureDir, handle)
}

// Prepare a card's phases for a run, honoring the "skip Constitution" setting.
function primePhasesForRun(state: PilotState): void {
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
  baseBranch?: string
): Promise<{ ok: true; dispatched: true; queued: boolean } | { error: string; message?: string }> {
  const state = await readMigratedState(featureDir)
  if (!state) return { error: 'No card state found' }
  const card = await readCard(featureDir)
  const title = card?.title ?? state.card.title
  if (!title || title.trim().length === 0) {
    return { error: 'VALIDATION_ERROR', message: 'A card needs a title before handoff' }
  }
  const now = new Date().toISOString()
  state.run = {
    status: 'running',
    startedAt: now,
    completedAt: null,
    autonomyLevel: state.run?.autonomyLevel ?? state.settings.defaultAutonomy ?? 'standard',
  }
  primePhasesForRun(state)

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
    const created = await createWorktree(api, featureDir, workspacePath, baseBranch)
    worktreePath = created.worktreePath
    branchName = created.branchName
  }
  if (!worktreePath) return { error: 'Could not resolve a worktree for the card' }
  state.worktreePath = worktreePath
  state.branchName = branchName
  state.queuePosition = 'active'
  state.stage = deriveStage(state.phases, state.run)
  await writePilotState(featureDir, state)
  await startRunAt(api, featureDir, worktreePath, firstRunnablePhase(state))
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
    const s = item.state
    try {
      const { worktreePath, branchName } = await createWorktree(api, s.featureDir, workspacePath)
      s.worktreePath = worktreePath
      s.branchName = branchName
      s.queuePosition = 'active'
      s.stage = deriveStage(s.phases, s.run)
      await writePilotState(s.featureDir, s)
      await startRunAt(api, s.featureDir, worktreePath, firstRunnablePhase(s))
      api.window.broadcast('speckit:dispatch-started', {
        featureDir: s.featureDir,
        branchName,
        worktreePath,
      })
      api.window.broadcast('speckit:state-changed', { state: s })
    } catch (err) {
      api.notifications.showToast('error', `Could not start queued card: ${String(err)}`)
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

export function activate(api: ExtensionAPI): void {
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
      api.notifications.showToast('error', `Could not create card: ${String(err)}`)
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
        if (state.worktreePath) {
          await api.shell
            .exec({
              command: 'git',
              args: ['worktree', 'remove', state.worktreePath, '--force'],
              cwd: workspacePath,
            })
            .catch(() => {})
          if (state.branchName) {
            await api.shell
              .exec({
                command: 'git',
                args: ['branch', '-D', state.branchName],
                cwd: workspacePath,
              })
              .catch(() => {})
          }
        }
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
      api.notifications.showToast('error', `Could not move card: ${String(err)}`)
      return { error: String(err) }
    }
  })

  // speckit:card-handoff — explicit "start" action: run the card through the pipeline
  reg(api, 'speckit:card-handoff', async (payload: unknown) => {
    const { featureDir, workspacePath, baseBranch } = payload as {
      featureDir: string
      workspacePath: string
      baseBranch?: string
    }
    if (!featureDir || !workspacePath) return { error: 'featureDir and workspacePath required' }
    try {
      return await handoffCard(api, featureDir, workspacePath, baseBranch)
    } catch (err) {
      api.notifications.showToast('error', `Handoff failed: ${String(err)}`)
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
      const res = await api.shell.exec({
        command: 'rg',
        args: [
          '--line-number',
          '--no-heading',
          '--color',
          'never',
          '--glob',
          '*.md',
          '--',
          query,
          '.',
        ],
        cwd: repoRoot,
      })
      // rg exit 0 = matches, 1 = no matches (both authoritative)
      if (res.exitCode === 0 || res.exitCode === 1) {
        return { results: parseRgLines(res.stdout) }
      }
    } catch {
      // rg unavailable — fall through to fs scan
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
        const runner = createAgentRunner(api)
        const handle = runner.startPhaseRunner({
          featureDir,
          worktreePath: state.worktreePath ?? featureDir,
          phaseCommand: PHASE_COMMANDS[nextPhaseId],
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
      api.notifications.showToast('error', `Could not fetch tickets: ${String(err)}`)
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
      api.notifications.showToast('error', `Could not save credentials: ${String(err)}`)
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
    const { ticket, workspacePath, autonomyLevel, baseBranch } = payload as {
      ticket: TicketRef
      workspacePath: string
      autonomyLevel?: 'guided' | 'standard' | 'fast'
      baseBranch?: string
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

      // Write ticket reference file
      await fs.promises.writeFile(
        path.join(featureDir, 'ticket.md'),
        `# Ticket: ${ticket.key}\n\n**Title:** ${ticket.title}\n**Source:** ${ticket.source}\n**URL:** ${ticket.sourceUrl}\n`,
        'utf-8'
      )

      const branchName = `feature/${slug}`
      const worktreeRoot =
        (api.settings.get<string>('terminator.speckit-pilot.worktreeRoot') || '').trim() ||
        path.join(workspacePath, '.wt')
      const worktreePath = path.join(worktreeRoot, slug)

      // Create initial state v3 (constitution ready, active run, ticket-seeded card)
      const state = createInitialState(featureDir, {
        card: createDefaultBrief(ticket.title, ticket.source),
        ticket,
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

      // Create git worktree branching from baseBranch (or HEAD if not specified)
      const worktreeArgs = ['worktree', 'add', worktreePath, '-b', branchName]
      if (baseBranch) worktreeArgs.push(baseBranch)
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
      await startRunAt(api, featureDir, worktreePath, firstRunnablePhase(state))

      api.window.broadcast('speckit:dispatch-started', { featureDir, branchName, worktreePath })
      api.window.broadcast('speckit:state-changed', { state })
      return { featureDir, queued: false }
    } catch (err) {
      api.notifications.showToast('error', `Dispatch failed: ${String(err)}`)
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
      api.notifications.showToast('error', `Cancel failed: ${String(err)}`)
      return { error: String(err) }
    }
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
      api.notifications.showToast('error', `Open PR failed: ${String(err)}`)
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
        const runner = createAgentRunner(api)
        const newHandle = runner.startPhaseRunner({
          featureDir,
          worktreePath: state.worktreePath ?? featureDir,
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
      const runner = createAgentRunner(api)
      const handle = runner.startPhaseRunner({
        featureDir,
        worktreePath: state.worktreePath ?? featureDir,
        phaseCommand: PHASE_COMMANDS[phase],
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
        activeSessions.set(session.id, { id: session.id, name: session.name ?? session.id })
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
        'terminator.speckit-pilot.worktreeRoot': {
          type: 'string',
          label: 'Worktree root directory (leave empty to use .wt/ inside workspace)',
          default: '',
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
      },
    })
  )
}

export function deactivate(): void {
  disposables.forEach((d) => d.dispose())
  disposables.length = 0
}
