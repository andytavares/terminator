import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { PilotState, PhaseId, HistoryEntry } from '../types/speckit.types.js'
import { PHASE_ORDER, DEFAULT_SETTINGS } from '../types/speckit.types.js'
import { PilotStateSchema } from '../schemas/speckit.schemas.js'

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

export async function readState(featureDir: string): Promise<PilotState | null> {
  const p = statePath(featureDir)
  try {
    const raw = await fs.readFile(p, 'utf-8')
    const parsed = JSON.parse(raw)
    const result = PilotStateSchema.safeParse(parsed)
    if (result.success) {
      return result.data as PilotState
    }
    // Corrupt file — return null so caller can re-create
    return null
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

export function createInitialState(featureDir: string): PilotState {
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
      },
    ])
  ) as Record<PhaseId, import('../types/speckit.types.js').PhaseState>

  return {
    version: 1,
    featureDir,
    phases,
    settings: DEFAULT_SETTINGS,
  }
}

function defaultArtifactPaths(phase: PhaseId, featureDir: string): string[] {
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
  }
}
