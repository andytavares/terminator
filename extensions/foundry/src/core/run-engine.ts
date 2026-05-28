import { getStatus, createCheckpoint, revertFiles } from './git.js'
import { appendHistoryEntry } from './history.js'
import type { Run, Harness, GateDecision, HistoryEntry } from '../types/foundry.types.js'

export interface CreateRunParams {
  workspaceRoot: string
  harness: Harness
  providerId: string
  model: string
  prompt: string
  specPath?: string
  existingActiveRun?: Run | null
}

export async function createSpecToCodeRun(
  params: CreateRunParams
): Promise<{ run: Run } | { error: string }> {
  const { workspaceRoot, harness, providerId, model, prompt, specPath, existingActiveRun } = params

  if (
    existingActiveRun &&
    (existingActiveRun.status === 'running' || existingActiveRun.status === 'gate')
  ) {
    return { error: 'A run is already active in this workspace' }
  }

  if (harness.gateDefaults.requireCleanWorkingTree) {
    const status = await getStatus(workspaceRoot)
    if ('error' in status) return { error: status.error }
    if (status.isDirty) {
      return {
        error:
          'Working tree is dirty. Commit or stash changes before running, or disable "require clean working tree" in harness settings.',
      }
    }
  }

  let checkpointCommit: string | undefined
  if (harness.gateDefaults.autoCheckpointBeforeRun) {
    const id = crypto.randomUUID()
    const checkpoint = await createCheckpoint(workspaceRoot, id)
    if ('error' in checkpoint) return { error: checkpoint.error }
    checkpointCommit = checkpoint.commitHash
  }

  const run: Run = {
    id: crypto.randomUUID(),
    mode: 'spec-to-code',
    providerId,
    model,
    prompt,
    specPath,
    status: 'running',
    createdAt: new Date().toISOString(),
    workspaceRoot,
    checkpointCommit,
    currentIteration: 1,
    iterationLimit: harness.iterationLimit,
    iterations: [],
    fileChanges: [],
  }

  return { run }
}

export async function gateDecide(
  run: Run,
  decision: GateDecision,
  note: string | undefined,
  workspaceRoot: string,
  _harness: Harness
): Promise<Run> {
  if (decision === 'reject') {
    const filePaths = run.fileChanges.map((c) => c.filePath)
    if (filePaths.length > 0) await revertFiles(workspaceRoot, filePaths)
    run.status = 'rejected'
    run.completedAt = new Date().toISOString()
    await writeHistory(run, decision, note, workspaceRoot)
    return run
  }

  if (decision === 'approve') {
    run.status = 'done'
    run.completedAt = new Date().toISOString()
    await writeHistory(run, decision, note, workspaceRoot)
    return run
  }

  // request-changes
  const feedback = note ? `[FEEDBACK]: ${note}\n\n` : '[FEEDBACK]: Changes requested.\n\n'
  run.prompt = feedback + (run.prompt ?? '')
  run.currentIteration++
  run.status = 'running'
  run.fileChanges = []
  return run
}

export async function abortRun(run: Run, workspaceRoot: string): Promise<Run> {
  const filePaths = run.fileChanges.map((c) => c.filePath)
  if (filePaths.length > 0) await revertFiles(workspaceRoot, filePaths)
  run.status = 'aborted'
  run.completedAt = new Date().toISOString()
  await appendHistoryEntry(workspaceRoot, buildHistoryEntry(run, 'aborted', []))
  return run
}

function buildHistoryEntry(
  run: Run,
  status: HistoryEntry['status'],
  gateDecisions: HistoryEntry['gateDecisions']
): HistoryEntry {
  const now = new Date().toISOString()
  return {
    runId: run.id,
    mode: run.mode,
    providerId: run.providerId,
    providerLabel: run.providerId,
    model: run.model,
    specPath: run.specPath,
    promptSummary: (run.prompt ?? '').slice(0, 200),
    status,
    tokenCountIn: 0,
    tokenCountOut: 0,
    sensorSummary: '0/0',
    gateDecisions,
    filesChangedCount: run.fileChanges.length,
    /* v8 ignore next 4 */
    durationMs: run.completedAt
      ? new Date(run.completedAt).getTime() - new Date(run.createdAt).getTime()
      : 0,
    createdAt: run.createdAt,
    completedAt: run.completedAt ?? now,
  }
}

async function writeHistory(
  run: Run,
  decision: GateDecision,
  note: string | undefined,
  workspaceRoot: string
) {
  await appendHistoryEntry(
    workspaceRoot,
    buildHistoryEntry(run, run.status as HistoryEntry['status'], [
      {
        iterationNumber: run.currentIteration,
        decision,
        note,
        decidedAt: new Date().toISOString(),
      },
    ])
  )
}
