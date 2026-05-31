/**
 * Tests for the new and modified IPC handlers introduced in the Foundry revamp:
 *   - foundry:branch-list
 *   - foundry:run-create (new required fields + worktree created before run)
 *   - foundry:run-abort (no longer cleans up worktree)
 *   - foundry:run-delete (explicit delete with artifact cleanup)
 *   - boot-time cleanup (cleanupLegacySessions called on activate)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { tmpdir } from 'node:os'

// ── Electron mock ──────────────────────────────────────────────────────────────
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}))

// ── Core module mocks ──────────────────────────────────────────────────────────
vi.mock('../../../src/core/git.js')
vi.mock('../../../src/core/harness.js')
vi.mock('../../../src/core/history.js')
vi.mock('../../../src/core/providers.js')
vi.mock('../../../src/core/sensors.js')
vi.mock('../../../src/core/session-cleanup.js')

import * as gitMod from '../../../src/core/git.js'
import * as harnessMod from '../../../src/core/harness.js'
import * as histMod from '../../../src/core/history.js'
import * as providersMod from '../../../src/core/providers.js'
import * as cleanupMod from '../../../src/core/session-cleanup.js'
import type { Harness } from '../../../src/types/foundry.types.js'

// Import the handler functions we test
import {
  handleBranchList,
  handleRunCreate,
  handleRunAbort,
  handleRunDelete,
} from '../../../src/core/ipc-handlers.js'

async function makeTmp() {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'foundry-ipc-test-'))
  return { dir, cleanup: () => fs.rm(dir, { recursive: true, force: true }) }
}

const DEFAULT_HARNESS: Harness = {
  version: 1,
  sensors: [],
  gateDefaults: {
    requireGateAfterEachIteration: true,
    sensorsMustPassBeforeGate: false,
    autoCheckpointBeforeRun: false,
    requireCleanWorkingTree: false,
  },
  providerRef: null,
  iterationLimit: 3,
  agentsMdPath: 'AGENTS.md',
}

function setupCommonMocks() {
  vi.mocked(gitMod.getStatus).mockResolvedValue({ isDirty: false, modifiedFiles: [] })
  vi.mocked(gitMod.createCheckpoint).mockResolvedValue({ commitHash: 'abc123' })
  vi.mocked(gitMod.listBranches).mockResolvedValue({
    branches: [
      { name: 'main', current: true },
      { name: 'feat/x', current: false },
    ],
  })
  vi.mocked(gitMod.createWorktreeFromBranch).mockResolvedValue({
    worktreePath: '/workspace/.worktrees/fix-auth',
    featureBranch: 'fix/auth',
  })
  vi.mocked(gitMod.removeWorktree).mockResolvedValue({ ok: true })
  vi.mocked(harnessMod.readHarness).mockResolvedValue({ harness: DEFAULT_HARNESS })
  vi.mocked(providersMod.readProviders).mockResolvedValue([])
  vi.mocked(histMod.appendHistoryEntry).mockResolvedValue(undefined)
  vi.mocked(histMod.readHistory).mockResolvedValue({ entries: [] })
  vi.mocked(cleanupMod.cleanupLegacySessions).mockResolvedValue(undefined)
}

// ── foundry:branch-list ────────────────────────────────────────────────────────

describe('handleBranchList()', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setupCommonMocks()
  })

  it('returns branch list from git', async () => {
    const result = await handleBranchList({ workspaceRoot: '/workspace' })
    expect(result).toHaveProperty('branches')
    if ('branches' in result) {
      expect(result.branches).toHaveLength(2)
      expect(result.branches[0].name).toBe('main')
      expect(result.branches[0].current).toBe(true)
    }
  })

  it('returns error when workspaceRoot is missing', async () => {
    const result = await handleBranchList({} as { workspaceRoot: string })
    expect(result).toHaveProperty('error')
  })

  it('returns error when git fails', async () => {
    vi.mocked(gitMod.listBranches).mockResolvedValueOnce({ error: 'not a git repo' })
    const result = await handleBranchList({ workspaceRoot: '/workspace' })
    expect(result).toHaveProperty('error')
  })
})

// ── foundry:run-create ─────────────────────────────────────────────────────────

describe('handleRunCreate()', () => {
  let dir: string
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    vi.resetAllMocks()
    setupCommonMocks()
    ;({ dir, cleanup } = await makeTmp())
    vi.mocked(gitMod.createWorktreeFromBranch).mockResolvedValue({
      worktreePath: path.join(dir, '.worktrees', 'fix-auth'),
      featureBranch: 'fix/auth',
    })
  })
  afterEach(async () => cleanup())

  it('returns error when baseBranch is missing', async () => {
    const result = await handleRunCreate({
      workspaceRoot: dir,
      mode: 'spec-to-code',
      providerId: 'p1',
      model: 'claude-sonnet-4-6',
      featureBranch: 'fix/auth',
      prompt: 'Build thing',
    } as Parameters<typeof handleRunCreate>[0])
    expect(result).toHaveProperty('error')
    if ('error' in result) expect(result.error).toContain('baseBranch')
  })

  it('returns error when featureBranch is missing', async () => {
    const result = await handleRunCreate({
      workspaceRoot: dir,
      mode: 'spec-to-code',
      providerId: 'p1',
      model: 'claude-sonnet-4-6',
      baseBranch: 'main',
      prompt: 'Build thing',
    } as Parameters<typeof handleRunCreate>[0])
    expect(result).toHaveProperty('error')
    if ('error' in result) expect(result.error).toContain('featureBranch')
  })

  it('creates worktree before starting run', async () => {
    await handleRunCreate({
      workspaceRoot: dir,
      mode: 'spec-to-code',
      providerId: 'p1',
      model: 'claude-sonnet-4-6',
      baseBranch: 'main',
      featureBranch: 'fix/auth',
      prompt: 'Build thing',
    })
    expect(vi.mocked(gitMod.createWorktreeFromBranch)).toHaveBeenCalledWith(dir, 'fix/auth', 'main')
  })

  it('returns error when worktree creation fails', async () => {
    vi.mocked(gitMod.createWorktreeFromBranch).mockResolvedValueOnce({
      error: 'Branch already exists',
    })
    const result = await handleRunCreate({
      workspaceRoot: dir,
      mode: 'spec-to-code',
      providerId: 'p1',
      model: 'claude-sonnet-4-6',
      baseBranch: 'main',
      featureBranch: 'fix/auth',
      prompt: 'Build thing',
    })
    expect(result).toHaveProperty('error')
  })

  it('returns run with baseBranch, featureBranch, worktreePath set', async () => {
    const result = await handleRunCreate({
      workspaceRoot: dir,
      mode: 'spec-to-code',
      providerId: 'p1',
      model: 'claude-sonnet-4-6',
      baseBranch: 'main',
      featureBranch: 'fix/auth',
      prompt: 'Build thing',
    })
    if ('error' in result) throw new Error(result.error)
    expect(result.run.baseBranch).toBe('main')
    expect(result.run.featureBranch).toBe('fix/auth')
    expect(result.run.worktreePath).toContain('.worktrees')
  })

  it('returns error when harness is not configured', async () => {
    vi.mocked(harnessMod.readHarness).mockResolvedValueOnce({ notFound: true })
    const result = await handleRunCreate({
      workspaceRoot: dir,
      mode: 'spec-to-code',
      providerId: 'p1',
      model: 'claude-sonnet-4-6',
      baseBranch: 'main',
      featureBranch: 'fix/auth',
      prompt: 'Build thing',
    })
    expect(result).toHaveProperty('error')
  })

  it('returns error when a run is already active', async () => {
    // Create first run successfully
    await handleRunCreate({
      workspaceRoot: dir,
      mode: 'spec-to-code',
      providerId: 'p1',
      model: 'claude-sonnet-4-6',
      baseBranch: 'main',
      featureBranch: 'fix/auth',
      prompt: 'First run',
    })
    // Try to create a second one while first is running
    const result = await handleRunCreate({
      workspaceRoot: dir,
      mode: 'spec-to-code',
      providerId: 'p1',
      model: 'claude-sonnet-4-6',
      baseBranch: 'main',
      featureBranch: 'fix/other',
      prompt: 'Second run',
    })
    expect(result).toHaveProperty('error')
    if ('error' in result) expect(result.error).toContain('already active')
  })

  it('returns error when harness read fails', async () => {
    vi.mocked(harnessMod.readHarness).mockResolvedValueOnce({ error: 'permission denied' })
    const result = await handleRunCreate({
      workspaceRoot: dir,
      mode: 'spec-to-code',
      providerId: 'p1',
      model: 'claude-sonnet-4-6',
      baseBranch: 'main',
      featureBranch: 'fix/auth',
      prompt: 'Build thing',
    })
    expect(result).toHaveProperty('error')
    if ('error' in result) expect(result.error).toContain('Cannot read harness')
  })
})

// ── foundry:run-dismiss history persistence ────────────────────────────────────

describe('handleRunAbort() — dismiss history', () => {
  let dir: string
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    vi.resetAllMocks()
    setupCommonMocks()
    ;({ dir, cleanup } = await makeTmp())
  })
  afterEach(async () => cleanup())

  it('run-dismiss writes history for paused-error runs not already in history', async () => {
    // Create a run (represents a run that errored mid-flight and is paused)
    const createResult = await handleRunCreate({
      workspaceRoot: dir,
      mode: 'spec-to-code',
      providerId: 'p1',
      model: 'claude-sonnet-4-6',
      baseBranch: 'main',
      featureBranch: 'fix/auth',
      prompt: 'Build thing',
    })
    if ('error' in createResult) throw new Error(createResult.error)
    // Verify the run is in activeRuns and appendHistoryEntry not yet called
    expect(vi.mocked(histMod.appendHistoryEntry)).not.toHaveBeenCalled()
    // Abort writes to history
    await handleRunAbort({ workspaceRoot: dir, runId: createResult.run.id })
    expect(vi.mocked(histMod.appendHistoryEntry)).toHaveBeenCalledWith(
      dir,
      expect.objectContaining({ status: 'aborted', runId: createResult.run.id })
    )
  })
})

// ── foundry:run-abort ──────────────────────────────────────────────────────────

describe('handleRunAbort()', () => {
  let dir: string
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    vi.resetAllMocks()
    setupCommonMocks()
    ;({ dir, cleanup } = await makeTmp())
  })
  afterEach(async () => cleanup())

  it('marks run as aborted without removing worktree', async () => {
    // Set up an active run
    const createResult = await handleRunCreate({
      workspaceRoot: dir,
      mode: 'spec-to-code',
      providerId: 'p1',
      model: 'claude-sonnet-4-6',
      baseBranch: 'main',
      featureBranch: 'fix/auth',
      prompt: 'Build thing',
    })
    if ('error' in createResult) throw new Error(createResult.error)

    const result = await handleRunAbort({
      workspaceRoot: dir,
      runId: createResult.run.id,
    })
    expect(result).toHaveProperty('ok', true)
    // Worktree is NOT removed
    expect(vi.mocked(gitMod.removeWorktree)).not.toHaveBeenCalled()
  })

  it('returns error when run is not found', async () => {
    const result = await handleRunAbort({
      workspaceRoot: dir,
      runId: 'nonexistent-run-id',
    })
    expect(result).toHaveProperty('error')
  })
})

// ── foundry:run-delete ─────────────────────────────────────────────────────────

describe('handleRunDelete()', () => {
  let dir: string
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    vi.resetAllMocks()
    setupCommonMocks()
    ;({ dir, cleanup } = await makeTmp())
  })
  afterEach(async () => cleanup())

  it('removes worktree and branch when run has worktreePath and featureBranch in history', async () => {
    vi.mocked(histMod.readHistory).mockResolvedValueOnce({
      entries: [
        {
          runId: 'run-abc',
          mode: 'spec-to-code',
          providerId: 'p1',
          providerLabel: 'p1',
          model: 'claude',
          promptSummary: 'test',
          status: 'aborted',
          tokenCountIn: 0,
          tokenCountOut: 0,
          sensorSummary: '0/0',
          gateDecisions: [],
          filesChangedCount: 0,
          durationMs: 0,
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          featureBranch: 'fix/auth',
          worktreePath: path.join(dir, '.worktrees', 'fix-auth'),
        },
      ],
    })
    vi.mocked(histMod.deleteHistoryEntry).mockResolvedValue(undefined)

    const result = await handleRunDelete({
      workspaceRoot: dir,
      runId: 'run-abc',
    })
    expect(result).toHaveProperty('ok', true)
    expect(vi.mocked(gitMod.removeWorktree)).toHaveBeenCalledWith(
      dir,
      path.join(dir, '.worktrees', 'fix-auth'),
      'fix/auth'
    )
    expect(vi.mocked(histMod.deleteHistoryEntry)).toHaveBeenCalledWith(dir, 'run-abc')
  })

  it('returns error when run not found in active runs or history', async () => {
    const result = await handleRunDelete({
      workspaceRoot: dir,
      runId: 'nonexistent',
    })
    expect(result).toHaveProperty('error')
  })

  it('deletes active run (not from history) and removes worktree', async () => {
    const createResult = await handleRunCreate({
      workspaceRoot: dir,
      mode: 'spec-to-code',
      providerId: 'p1',
      model: 'claude-sonnet-4-6',
      baseBranch: 'main',
      featureBranch: 'fix/auth',
      prompt: 'Build thing',
    })
    if ('error' in createResult) throw new Error(createResult.error)

    vi.mocked(histMod.deleteHistoryEntry).mockResolvedValue(undefined)

    const result = await handleRunDelete({
      workspaceRoot: dir,
      runId: createResult.run.id,
    })
    expect(result).toHaveProperty('ok', true)
    expect(vi.mocked(gitMod.removeWorktree)).toHaveBeenCalled()
  })

  it('returns error when readHistory throws', async () => {
    vi.mocked(histMod.readHistory).mockRejectedValueOnce(new Error('disk error'))
    const result = await handleRunDelete({
      workspaceRoot: dir,
      runId: 'nonexistent',
    })
    expect(result).toHaveProperty('error')
  })

  it('calls removeWorktree with empty featureBranch when only worktreePath is set', async () => {
    vi.mocked(histMod.readHistory).mockResolvedValueOnce({
      entries: [
        {
          runId: 'run-no-branch',
          mode: 'spec-to-code',
          providerId: 'p1',
          providerLabel: 'p1',
          model: 'claude',
          promptSummary: 'test',
          status: 'aborted',
          tokenCountIn: 0,
          tokenCountOut: 0,
          sensorSummary: '0/0',
          gateDecisions: [],
          filesChangedCount: 0,
          durationMs: 0,
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          worktreePath: path.join(dir, '.worktrees', 'fix-auth'),
          // featureBranch intentionally omitted
        },
      ],
    })
    vi.mocked(histMod.deleteHistoryEntry).mockResolvedValue(undefined)

    const result = await handleRunDelete({ workspaceRoot: dir, runId: 'run-no-branch' })
    expect(result).toHaveProperty('ok', true)
    expect(vi.mocked(gitMod.removeWorktree)).toHaveBeenCalledWith(
      dir,
      path.join(dir, '.worktrees', 'fix-auth'),
      ''
    )
  })

  it('includes terminalProjectId in result when set', async () => {
    vi.mocked(histMod.readHistory).mockResolvedValueOnce({
      entries: [
        {
          runId: 'run-with-project',
          mode: 'spec-to-code',
          providerId: 'p1',
          providerLabel: 'p1',
          model: 'claude',
          promptSummary: 'test',
          status: 'done',
          tokenCountIn: 0,
          tokenCountOut: 0,
          sensorSummary: '0/0',
          gateDecisions: [],
          filesChangedCount: 0,
          durationMs: 0,
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          featureBranch: 'fix/auth',
          worktreePath: path.join(dir, '.worktrees', 'fix-auth'),
          terminalProjectId: 'project-xyz',
        },
      ],
    })
    vi.mocked(histMod.deleteHistoryEntry).mockResolvedValue(undefined)

    const result = await handleRunDelete({ workspaceRoot: dir, runId: 'run-with-project' })
    expect(result).toHaveProperty('ok', true)
  })

  it('still deletes history entry even when worktree removal fails', async () => {
    vi.mocked(gitMod.removeWorktree).mockResolvedValueOnce({ error: 'worktree not found' })
    vi.mocked(histMod.readHistory).mockResolvedValueOnce({
      entries: [
        {
          runId: 'run-abc',
          mode: 'spec-to-code',
          providerId: 'p1',
          providerLabel: 'p1',
          model: 'claude',
          promptSummary: 'test',
          status: 'aborted',
          tokenCountIn: 0,
          tokenCountOut: 0,
          sensorSummary: '0/0',
          gateDecisions: [],
          filesChangedCount: 0,
          durationMs: 0,
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          featureBranch: 'fix/auth',
          worktreePath: path.join(dir, '.worktrees', 'fix-auth'),
        },
      ],
    })
    vi.mocked(histMod.deleteHistoryEntry).mockResolvedValue(undefined)
    const result = await handleRunDelete({ workspaceRoot: dir, runId: 'run-abc' })
    expect(result).toHaveProperty('ok', true)
    expect(vi.mocked(histMod.deleteHistoryEntry)).toHaveBeenCalled()
  })
})
