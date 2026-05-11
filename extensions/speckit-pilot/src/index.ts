import type { ExtensionAPI, Disposable } from '../../../src/main/extensions/api'
import { BrowserWindow } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { Feature, PhaseId, PilotState } from './types/speckit.types.js'
import { PHASE_ORDER, DEFAULT_SETTINGS } from './types/speckit.types.js'

const disposables: Disposable[] = []

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

// Create initial pilot state derived from file existence
function createPilotState(featureDir: string): PilotState {
  const phases: PilotState['phases'] = {} as PilotState['phases']
  for (const id of PHASE_ORDER) {
    phases[id] = {
      id,
      status: 'locked',
      approvedHash: null,
      approvedAt: null,
      approvedBy: null,
      lastRunId: null,
      lastRunAt: null,
      artifactPaths: [],
    }
  }
  return { version: 1, featureDir, phases, settings: DEFAULT_SETTINGS }
}

function broadcastStateChanged(state: PilotState) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('speckit:state-changed', { state })
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
    await writePilotState(featureDir, state)
    broadcastStateChanged(state)
    return { state }
  })

  // speckit:phase-revoke — revoke approval
  reg(api, 'speckit:phase-revoke', async (payload: unknown) => {
    const { featureDir, phase } = payload as { featureDir: string; phase: PhaseId }
    if (!featureDir || !phase) return { error: 'featureDir and phase required' }
    let state = await readPilotState(featureDir)
    if (!state) state = createPilotState(featureDir)
    const ps = state.phases[phase]
    if (!ps) return { error: `Unknown phase: ${phase}` }
    ps.status = 'ready'
    ps.approvedAt = null
    ps.approvedBy = null
    ps.approvedHash = null
    await writePilotState(featureDir, state)
    broadcastStateChanged(state)
    return { state }
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
      },
    })
  )
}

export function deactivate(): void {
  disposables.forEach((d) => d.dispose())
  disposables.length = 0
}
