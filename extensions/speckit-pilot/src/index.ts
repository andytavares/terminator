import type { ExtensionAPI, Disposable } from '../../../src/main/extensions/api'
import { BrowserWindow } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { Feature, HistoryEntry, PhaseId, PilotState } from './types/speckit.types.js'
import { PHASE_ORDER, DEFAULT_SETTINGS } from './types/speckit.types.js'

const disposables: Disposable[] = []

// Active session registry: sessionId → session metadata
const activeSessions: Map<string, { id: string; name: string }> = new Map()

// Active implement run registry: featureDir → runId
const activeRuns: Map<string, string> = new Map()

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
    // Mark downstream approved phases as stale
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
      action: 'approved',
      phase,
      note,
    })
    broadcastStateChanged(state)
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
    broadcastStateChanged(state)
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
    broadcastStateChanged(state)
    return { state }
  })

  // speckit:artifact-read — read current file + last approved (via git) for diff
  reg(api, 'speckit:artifact-read', async (payload: unknown) => {
    const { filePath, featureDir, repoRoot } = payload as {
      filePath: string
      featureDir?: string
      repoRoot?: string
    }
    if (!filePath) return { error: 'filePath required' }
    let current: string | null = null
    try {
      current = await fs.promises.readFile(filePath, 'utf-8')
    } catch {
      current = null
    }
    // Try to get approved version from git
    let approved: string | null = null
    const cwd = repoRoot || featureDir || path.dirname(filePath)
    try {
      const { exec } = await import('node:child_process')
      const { promisify } = await import('node:util')
      const execAsync = promisify(exec)
      const relPath = path.relative(cwd, filePath)
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
          broadcastStateChanged(state)
        }
      }
    }
    return { ok: true }
  })

  // speckit:checkpoint-create — create a git checkpoint commit before implement run
  reg(api, 'speckit:checkpoint-create', async (payload: unknown) => {
    const { featureDir, repoRoot } = payload as { featureDir: string; repoRoot?: string }
    if (!featureDir) return { error: 'featureDir required' }
    const cwd = repoRoot || featureDir
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
    broadcastStateChanged(state)
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
    broadcastStateChanged(state)
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
      },
    })
  )
}

export function deactivate(): void {
  disposables.forEach((d) => d.dispose())
  disposables.length = 0
}
