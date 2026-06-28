import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { PilotState, PhaseId, HistoryEntry } from '../types/speckit.types.js'
import { PHASE_ORDER, DEFAULT_SETTINGS } from '../types/speckit.types.js'
import { PilotStateAnyVersionSchema } from '../schemas/speckit.schemas.js'

function pilotDir(featureDir: string): string {
  return path.join(featureDir, '.pilot')
}

function statePath(featureDir: string): string {
  return path.join(pilotDir(featureDir), 'state.json')
}

function historyPath(featureDir: string): string {
  return path.join(pilotDir(featureDir), 'history.jsonl')
}

export async function ensurePilotDir(featureDir: string): Promise<void> {
  await fs.mkdir(pilotDir(featureDir), { recursive: true })
}

/** Migrate a v1 state to v2 by adding null defaults for new fields. */
function migrateToV2(raw: unknown): PilotState {
  const v1 = raw as {
    version: 1
    featureDir: string
    phases: PilotState['phases']
    settings: PilotState['settings']
  }
  return {
    version: 2,
    featureDir: v1.featureDir,
    ticket: null,
    run: null,
    queuePosition: null,
    worktreePath: null,
    branchName: null,
    prUrl: null,
    phases: v1.phases,
    settings: {
      ...DEFAULT_SETTINGS,
      ...v1.settings,
    },
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
    if (data.version === 1) return migrateToV2(data)
    return data as PilotState
  } catch {
    return null
  }
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

  return {
    version: 2,
    featureDir,
    ticket: overrides?.ticket ?? null,
    run: overrides?.run ?? null,
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
