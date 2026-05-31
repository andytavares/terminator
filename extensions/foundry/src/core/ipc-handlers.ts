/**
 * Pure handler functions for Foundry IPC channels.
 * Extracted so they can be unit-tested independently of the Electron runtime.
 * index.ts wires these into api.ipc.registerHandler().
 */
import { listBranches, createWorktreeFromBranch, removeWorktree } from './git.js'
import { readHarness } from './harness.js'
import { readHistory, deleteHistoryEntry, appendHistoryEntry } from './history.js'
import type { Run, RunMode, SubAgent } from '../types/foundry.types.js'

// ── Shared in-memory state (same instance shared with index.ts) ───────────────
// activeRuns is keyed workspaceRoot → Run
export const activeRuns = new Map<string, Run>()

// ── foundry:branch-list ───────────────────────────────────────────────────────

export interface BranchInfo {
  name: string
  current: boolean
}

export async function handleBranchList(payload: {
  workspaceRoot: string
}): Promise<{ branches: BranchInfo[] } | { error: string }> {
  const { workspaceRoot } = payload
  if (!workspaceRoot) return { error: 'workspaceRoot required' }
  const result = await listBranches(workspaceRoot)
  if ('error' in result) return { error: result.error }
  return { branches: result.branches }
}

// ── foundry:run-create ────────────────────────────────────────────────────────

export interface RunCreatePayload {
  workspaceRoot: string
  mode: RunMode
  providerId: string
  model: string
  baseBranch: string
  featureBranch: string
  specPath?: string
  prompt?: string
  iterationLimit?: number
  manualDag?: Array<{ id: string; role: string; task: string; dependsOn: string[] }>
}

export async function handleRunCreate(
  payload: RunCreatePayload
): Promise<{ run: Run } | { error: string }> {
  const {
    workspaceRoot,
    mode,
    providerId,
    model,
    baseBranch,
    featureBranch,
    specPath,
    prompt,
    iterationLimit,
    manualDag,
  } = payload

  if (!workspaceRoot || !mode || !providerId || !model)
    return { error: 'workspaceRoot, mode, providerId, model required' }
  if (!baseBranch) return { error: 'baseBranch required — select a base branch to start from' }
  if (!featureBranch) return { error: 'featureBranch required — provide a feature branch name' }

  // Block if a run is already active for this workspace
  const existing = activeRuns.get(workspaceRoot)
  if (existing && (existing.status === 'running' || existing.status === 'gate')) {
    return { error: 'A run is already active in this workspace' }
  }

  // Read harness config first — fail fast before creating the worktree
  const harnessResult = await readHarness(workspaceRoot)
  if ('error' in harnessResult) return { error: `Cannot read harness: ${harnessResult.error}` }
  if ('notFound' in harnessResult) return { error: 'Harness not configured. Run setup first.' }

  // Create the worktree BEFORE the run starts — explicit baseBranch and featureBranch
  const worktreeResult = await createWorktreeFromBranch(workspaceRoot, featureBranch, baseBranch)
  if ('error' in worktreeResult) {
    return { error: `Could not create worktree: ${worktreeResult.error}` }
  }

  const run: Run = {
    id: crypto.randomUUID(),
    mode,
    providerId,
    model,
    specPath,
    prompt,
    status: 'running',
    createdAt: new Date().toISOString(),
    workspaceRoot,
    currentIteration: 1,
    iterationLimit: iterationLimit ?? harnessResult.harness.iterationLimit,
    iterations: [],
    fileChanges: [],
    baseBranch,
    featureBranch,
    worktreePath: worktreeResult.worktreePath,
  }

  if (mode === 'orchestrate' && manualDag && manualDag.length > 0) {
    run.subAgents = manualDag.map((a) => ({
      agentId: a.id,
      role: a.role,
      dependsOn: a.dependsOn,
      inputFrom: a.dependsOn,
      outputArtifacts: [],
      status: 'pending' as const,
    })) as SubAgent[]
  }

  activeRuns.set(workspaceRoot, run)

  return { run }
}

// ── foundry:run-abort ─────────────────────────────────────────────────────────

export async function handleRunAbort(payload: {
  workspaceRoot: string
  runId: string
}): Promise<{ ok: boolean } | { error: string }> {
  const { workspaceRoot, runId } = payload
  const run = activeRuns.get(workspaceRoot)
  if (!run || run.id !== runId) return { error: 'Run not found' }

  // Abort leaves the worktree intact — no cleanup, no file revert.
  // The user can inspect the worktree and use foundry:run-delete to clean up explicitly.
  run.status = 'aborted'
  run.completedAt = new Date().toISOString()

  await appendHistoryEntry(workspaceRoot, {
    runId: run.id,
    mode: run.mode,
    providerId: run.providerId,
    providerLabel: run.providerId,
    model: run.model,
    specPath: run.specPath,
    promptSummary: (run.prompt ?? '').slice(0, 200),
    status: 'aborted',
    tokenCountIn: run.tokenCountIn ?? 0,
    tokenCountOut: run.tokenCountOut ?? 0,
    sensorSummary: '0/0',
    gateDecisions: [],
    filesChangedCount: run.fileChanges.length,
    durationMs: run.completedAt
      ? new Date(run.completedAt).getTime() - new Date(run.createdAt).getTime()
      : 0,
    createdAt: run.createdAt,
    completedAt: run.completedAt,
    featureBranch: run.featureBranch,
    baseBranch: run.baseBranch,
    worktreePath: run.worktreePath,
    terminalProjectId: run.terminalProjectId,
  })

  activeRuns.delete(workspaceRoot)

  return { ok: true }
}

// ── foundry:run-delete ────────────────────────────────────────────────────────

export async function handleRunDelete(payload: {
  workspaceRoot: string
  runId: string
}): Promise<{ ok: boolean } | { error: string }> {
  const { workspaceRoot, runId } = payload

  // Look for the run in active runs first
  let worktreePath: string | undefined
  let featureBranch: string | undefined
  let terminalProjectId: string | undefined

  const activeRun = activeRuns.get(workspaceRoot)
  if (activeRun && activeRun.id === runId) {
    worktreePath = activeRun.worktreePath
    featureBranch = activeRun.featureBranch
    terminalProjectId = activeRun.terminalProjectId
    activeRuns.delete(workspaceRoot)
  } else {
    // Look in history for the run data
    try {
      const { entries } = await readHistory(workspaceRoot, 0, 200)
      const entry = entries.find((e) => e.runId === runId)
      if (!entry) return { error: `Run "${runId}" not found` }
      worktreePath = entry.worktreePath
      featureBranch = entry.featureBranch
      terminalProjectId = entry.terminalProjectId
    } catch {
      return { error: `Run "${runId}" not found` }
    }
  }

  // Remove git worktree and branch (best-effort — don't fail the delete on git errors)
  if (worktreePath && featureBranch) {
    await removeWorktree(workspaceRoot, worktreePath, featureBranch).catch(() => undefined)
  } else if (worktreePath) {
    await removeWorktree(workspaceRoot, worktreePath, '').catch(() => undefined)
  }

  // Remove from history
  await deleteHistoryEntry(workspaceRoot, runId).catch(() => undefined)

  return { ok: true, ...(terminalProjectId ? { terminalProjectId } : {}) } as { ok: boolean }
}

// Re-export worktreePath→Run lookup helper for index.ts
export function getWorktreeOwnerRun(workspaceRoot: string): Run | undefined {
  return [...activeRuns.values()].find((r) => r.worktreePath === workspaceRoot)
}
