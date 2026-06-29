import type { ExtensionAPI, Disposable } from '../../../src/main/extensions/api'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type {
  Feature,
  HistoryEntry,
  JiraCreds,
  PhaseId,
  PilotState,
  TicketRef,
} from './types/speckit.types.js'
import { PHASE_ORDER, DEFAULT_SETTINGS } from './types/speckit.types.js'

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
import { createAgentRunner } from './runner/agent-runner.js'
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
    api.window.broadcast('speckit:state-changed', { state })

    // Auto-start the next phase if the run is still active
    const nextPhaseId = PHASE_ORDER[idx + 1]
    if (nextPhaseId && nextPhaseId !== 'open-pr' && state.run?.status !== 'cancelled') {
      const nextPs = state.phases[nextPhaseId]
      if (nextPs && (nextPs.status === 'locked' || nextPs.status === 'ready')) {
        nextPs.status = 'ready'
        await writePilotState(featureDir, state)
        const runner = createAgentRunner(api)
        const handle = runner.startPhaseRunner({
          featureDir,
          worktreePath: state.worktreePath ?? featureDir,
          phaseCommand: PHASE_COMMANDS[nextPhaseId],
          phase: nextPhaseId,
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
      const [linearKey, jiraCreds] = await Promise.all([getLinearKey(), getJiraCredentials()])
      const fetches: Promise<unknown[]>[] = []
      if (linearKey) fetches.push(fetchLinearTickets(linearKey).catch(() => []))
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
      if (p.source === 'linear' && p.apiKey) {
        await setLinearKey(p.apiKey)
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
        const key = await getLinearKey()
        return { connected: key !== null }
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

      // Create initial state v2
      const state = {
        version: 2 as const,
        featureDir,
        ticket,
        run: {
          status: 'running' as const,
          startedAt: new Date().toISOString(),
          completedAt: null,
          autonomyLevel: autonomyLevel ?? 'standard',
        },
        queuePosition: 'active' as const,
        worktreePath,
        branchName,
        prUrl: null,
        phases: (() => {
          const phases: PilotState['phases'] = {} as PilotState['phases']
          for (const id of PHASE_ORDER) {
            phases[id] = {
              id,
              status: id === 'constitution' ? 'ready' : 'locked',
              approvedHash: null,
              approvedAt: null,
              approvedBy: null,
              lastRunId: null,
              lastRunAt: null,
              artifactPaths: [],
              feedback: null,
              batchIndex: null,
            }
          }
          return phases
        })(),
        settings: DEFAULT_SETTINGS,
      } satisfies PilotState

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

      // Start agent runner on constitution phase
      const runner = createAgentRunner(api)
      const handle = runner.startPhaseRunner({
        featureDir,
        worktreePath,
        phaseCommand: 'Read and affirm the project constitution',
        phase: 'constitution',
        ...makePhaseCallbacks(api, featureDir, 'constitution'),
      })
      activeRunnerHandles.set(featureDir, handle)

      api.window.broadcast('speckit:dispatch-started', { featureDir, branchName, worktreePath })
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
        return { ok: true, state }
      }

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

      api.window.broadcast('speckit:state-changed', { state })
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
      },
    })
  )
}

export function deactivate(): void {
  disposables.forEach((d) => d.dispose())
  disposables.length = 0
}
