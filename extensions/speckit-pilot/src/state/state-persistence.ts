import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type {
  PilotState,
  PhaseId,
  HistoryEntry,
  CardBrief,
  CardComment,
} from '../types/speckit.types.js'
import { PHASE_ORDER, DEFAULT_SETTINGS, createDefaultBrief } from '../types/speckit.types.js'
import { PilotStateAnyVersionSchema } from '../schemas/speckit.schemas.js'
import { deriveStage } from './derive-stage.js'

function pilotDir(featureDir: string): string {
  return path.join(featureDir, '.pilot')
}

function statePath(featureDir: string): string {
  return path.join(pilotDir(featureDir), 'state.json')
}

function historyPath(featureDir: string): string {
  return path.join(pilotDir(featureDir), 'history.jsonl')
}

function cardPath(featureDir: string): string {
  return path.join(pilotDir(featureDir), 'card.json')
}

function commentsPath(featureDir: string): string {
  return path.join(pilotDir(featureDir), 'comments.jsonl')
}

export async function ensurePilotDir(featureDir: string): Promise<void> {
  await fs.mkdir(pilotDir(featureDir), { recursive: true })
}

/** Shape shared by v1/v2 states before v3's card/stage fields were added. */
interface PreV3State {
  version: 1 | 2
  featureDir: string
  ticket?: PilotState['ticket']
  run?: PilotState['run']
  queuePosition?: PilotState['queuePosition']
  worktreePath?: PilotState['worktreePath']
  branchName?: PilotState['branchName']
  prUrl?: PilotState['prUrl']
  phases: PilotState['phases']
  settings: PilotState['settings']
}

/**
 * Migrate a v1 or v2 state up to v3: synthesize a card brief, derive the stage,
 * and default any missing settings. Pure with respect to the input object.
 */
function migrateToV3(raw: PreV3State): PilotState {
  const ticket = raw.ticket ?? null
  const run = raw.run ?? null
  const phases = raw.phases
  const title = ticket?.title ?? path.basename(raw.featureDir)
  const card: CardBrief = createDefaultBrief(title, ticket?.source ?? 'native')
  const settings = { ...DEFAULT_SETTINGS, ...raw.settings }
  return {
    version: 3,
    featureDir: raw.featureDir,
    card,
    stage: deriveStage(phases, run),
    ticket,
    run,
    queuePosition: raw.queuePosition ?? null,
    worktreePath: raw.worktreePath ?? null,
    branchName: raw.branchName ?? null,
    prUrl: raw.prUrl ?? null,
    phases,
    settings,
  }
}

export async function readState(featureDir: string): Promise<PilotState | null> {
  const p = statePath(featureDir)
  try {
    const raw = await fs.readFile(p, 'utf-8')
    const parsed = JSON.parse(raw)
    const result = PilotStateAnyVersionSchema.safeParse(parsed)
    if (!result.success) return null
    const data = result.data
    if (data.version === 3) return data as PilotState
    return migrateToV3(data as PreV3State)
  } catch {
    return null
  }
}

export async function readCard(featureDir: string): Promise<CardBrief | null> {
  try {
    const raw = await fs.readFile(cardPath(featureDir), 'utf-8')
    return JSON.parse(raw) as CardBrief
  } catch {
    return null
  }
}

export async function writeCard(featureDir: string, card: CardBrief): Promise<void> {
  await ensurePilotDir(featureDir)
  const p = cardPath(featureDir)
  const tmp = `${p}.tmp`
  await fs.writeFile(tmp, JSON.stringify(card, null, 2), 'utf-8')
  await fs.rename(tmp, p)
}

export async function appendComment(featureDir: string, comment: CardComment): Promise<void> {
  await ensurePilotDir(featureDir)
  await fs.appendFile(commentsPath(featureDir), JSON.stringify(comment) + '\n', 'utf-8')
}

export async function readComments(featureDir: string): Promise<CardComment[]> {
  try {
    const raw = await fs.readFile(commentsPath(featureDir), 'utf-8')
    return raw
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as CardComment)
  } catch {
    return []
  }
}

/**
 * Collect your not-yet-applied comments, mark them applied to the given run, and
 * return their concatenated bodies (or null if none) so a phase run can be steered.
 */
export async function consumePendingComments(
  featureDir: string,
  runId: string
): Promise<string | null> {
  const comments = await readComments(featureDir)
  const pending = comments.filter((c) => c.author === 'you' && !c.appliedToRunId)
  if (pending.length === 0) return null
  const updated = comments.map((c) =>
    c.author === 'you' && !c.appliedToRunId ? { ...c, appliedToRunId: runId } : c
  )
  await fs.writeFile(
    commentsPath(featureDir),
    updated.map((c) => JSON.stringify(c)).join('\n') + '\n',
    'utf-8'
  )
  return pending.map((c) => c.body).join('\n')
}

export async function writeState(featureDir: string, state: PilotState): Promise<void> {
  await ensurePilotDir(featureDir)
  const p = statePath(featureDir)
  const tmp = `${p}.tmp`
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), 'utf-8')
  await fs.rename(tmp, p)
}

export async function appendHistory(featureDir: string, entry: HistoryEntry): Promise<void> {
  await ensurePilotDir(featureDir)
  const p = historyPath(featureDir)
  await fs.appendFile(p, JSON.stringify(entry) + '\n', 'utf-8')
}

export function createInitialState(
  featureDir: string,
  overrides?: {
    card?: CardBrief
    ticket?: PilotState['ticket']
    run?: PilotState['run']
    queuePosition?: PilotState['queuePosition']
    worktreePath?: PilotState['worktreePath']
    branchName?: PilotState['branchName']
  }
): PilotState {
  const phases = Object.fromEntries(
    PHASE_ORDER.map((id, idx) => [
      id,
      {
        id,
        status: idx === 0 ? ('ready' as const) : ('locked' as const),
        approvedHash: null,
        approvedAt: null,
        approvedBy: null,
        lastRunId: null,
        lastRunAt: null,
        artifactPaths: defaultArtifactPaths(id, featureDir),
        feedback: null,
        batchIndex: null,
      },
    ])
  ) as Record<PhaseId, import('../types/speckit.types.js').PhaseState>

  const run = overrides?.run ?? null
  const ticket = overrides?.ticket ?? null
  const card =
    overrides?.card ??
    createDefaultBrief(ticket?.title ?? path.basename(featureDir), ticket?.source ?? 'native')

  return {
    version: 3,
    featureDir,
    card,
    stage: deriveStage(phases, run),
    ticket,
    run,
    queuePosition: overrides?.queuePosition ?? null,
    worktreePath: overrides?.worktreePath ?? null,
    branchName: overrides?.branchName ?? null,
    prUrl: null,
    phases,
    settings: DEFAULT_SETTINGS,
  }
}

export function defaultArtifactPaths(phase: PhaseId, featureDir: string): string[] {
  switch (phase) {
    case 'constitution':
      return ['.specify/memory/constitution.md']
    case 'specify':
      return [`${featureDir}/spec.md`]
    case 'clarify':
      return [`${featureDir}/spec.md`]
    case 'plan':
      return [`${featureDir}/plan.md`, `${featureDir}/research.md`, `${featureDir}/data-model.md`]
    case 'checklist':
      return [`${featureDir}/checklists/requirements.md`]
    case 'tasks':
      return [`${featureDir}/tasks.md`]
    case 'analyze':
      return []
    case 'implement':
      return []
    case 'self-review':
      return [`${featureDir}/.pilot/self-review.json`]
    case 'open-pr':
      return []
  }
}
