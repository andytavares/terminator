import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { tmpdir } from 'node:os'
import { createSpecToCodeRun, gateDecide, abortRun } from '../../../src/core/run-engine.js'
import type { Harness } from '../../../src/types/foundry.types.js'

// Auto-mock the dependencies
vi.mock('../../../src/core/git.js')
vi.mock('../../../src/core/sensors.js')
vi.mock('../../../src/core/history.js')

import * as gitMod from '../../../src/core/git.js'
import * as histMod from '../../../src/core/history.js'

const DEFAULT_HARNESS: Harness = {
  version: 1,
  sensors: [{ name: 'lint', command: 'eslint src' }],
  gateDefaults: {
    requireGateAfterEachIteration: true,
    sensorsMustPassBeforeGate: true,
    autoCheckpointBeforeRun: true,
    requireCleanWorkingTree: true,
  },
  providerRef: null,
  iterationLimit: 3,
  agentsMdPath: 'AGENTS.md',
}

async function makeTmp() {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'foundry-run-engine-test-'))
  return { dir, cleanup: () => fs.rm(dir, { recursive: true, force: true }) }
}

function setupDefaultMocks() {
  vi.mocked(gitMod.getStatus).mockResolvedValue({ isDirty: false, modifiedFiles: [] })
  vi.mocked(gitMod.createCheckpoint).mockResolvedValue({ commitHash: 'abc123f' })
  vi.mocked(gitMod.revertFiles).mockImplementation(async (_wr, files) => ({
    ok: true as const,
    reverted: files,
  }))
  vi.mocked(histMod.appendHistoryEntry).mockResolvedValue(undefined)
}

describe('createSpecToCodeRun()', () => {
  let dir: string
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    vi.resetAllMocks()
    setupDefaultMocks()
    ;({ dir, cleanup } = await makeTmp())
  })
  afterEach(async () => cleanup())

  it('returns run with UUID and running status', async () => {
    const result = await createSpecToCodeRun({
      workspaceRoot: dir,
      harness: DEFAULT_HARNESS,
      providerId: 'p1',
      model: 'claude',
      prompt: 'Build auth',
    })
    if ('error' in result) throw new Error(result.error)
    expect(result.run.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(result.run.status).toBe('running')
  })

  it('calls createCheckpoint when autoCheckpointBeforeRun is true', async () => {
    await createSpecToCodeRun({
      workspaceRoot: dir,
      harness: DEFAULT_HARNESS,
      providerId: 'p1',
      model: 'claude',
      prompt: 'Build auth',
    })
    expect(vi.mocked(gitMod.createCheckpoint)).toHaveBeenCalledOnce()
  })

  it('blocks run when dirty tree and requireCleanWorkingTree: true', async () => {
    vi.mocked(gitMod.getStatus).mockResolvedValueOnce({
      isDirty: true,
      modifiedFiles: ['src/foo.ts'],
    })
    const result = await createSpecToCodeRun({
      workspaceRoot: dir,
      harness: DEFAULT_HARNESS,
      providerId: 'p1',
      model: 'claude',
      prompt: 'Build auth',
    })
    expect(result).toHaveProperty('error')
    expect((result as { error: string }).error).toContain('dirty')
  })

  it('proceeds when dirty tree and requireCleanWorkingTree: false', async () => {
    vi.mocked(gitMod.getStatus).mockResolvedValueOnce({
      isDirty: true,
      modifiedFiles: ['src/foo.ts'],
    })
    const harness = {
      ...DEFAULT_HARNESS,
      gateDefaults: { ...DEFAULT_HARNESS.gateDefaults, requireCleanWorkingTree: false },
    }
    const result = await createSpecToCodeRun({
      workspaceRoot: dir,
      harness,
      providerId: 'p1',
      model: 'claude',
      prompt: 'Build auth',
    })
    expect(result).not.toHaveProperty('error')
  })

  it('returns error when createCheckpoint fails', async () => {
    vi.mocked(gitMod.createCheckpoint).mockResolvedValueOnce({ error: 'git failure' })
    const result = await createSpecToCodeRun({
      workspaceRoot: dir,
      harness: DEFAULT_HARNESS,
      providerId: 'p1',
      model: 'claude',
      prompt: 'Build auth',
    })
    expect(result).toHaveProperty('error')
    expect((result as { error: string }).error).toContain('git failure')
  })
})

describe('gateDecide()', () => {
  let dir: string
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    vi.resetAllMocks()
    setupDefaultMocks()
    ;({ dir, cleanup } = await makeTmp())
  })
  afterEach(async () => cleanup())

  async function makeActiveRun() {
    const r = await createSpecToCodeRun({
      workspaceRoot: dir,
      harness: DEFAULT_HARNESS,
      providerId: 'p1',
      model: 'claude',
      prompt: 'Build auth',
    })
    if ('error' in r) throw new Error(`makeActiveRun failed: ${r.error}`)
    return r.run
  }

  it('approve: marks run done and writes history entry', async () => {
    const run = await makeActiveRun()
    const result = await gateDecide(run, 'approve', undefined, dir, DEFAULT_HARNESS)
    expect(result.status).toBe('done')
    expect(vi.mocked(histMod.appendHistoryEntry)).toHaveBeenCalledOnce()
  })

  it('reject: reverts files and writes rejected history entry', async () => {
    const run = await makeActiveRun()
    run.fileChanges = [
      { filePath: 'src/foo.ts', status: 'new', linesAdded: 10, linesRemoved: 0, unifiedDiff: '' },
    ]
    const result = await gateDecide(run, 'reject', undefined, dir, DEFAULT_HARNESS)
    expect(result.status).toBe('rejected')
    expect(vi.mocked(gitMod.revertFiles)).toHaveBeenCalledWith(dir, ['src/foo.ts'])
    expect(vi.mocked(histMod.appendHistoryEntry)).toHaveBeenCalledOnce()
  })

  it('request-changes: prepends [FEEDBACK]: prefix to next prompt', async () => {
    const run = await makeActiveRun()
    const result = await gateDecide(
      run,
      'request-changes',
      'Need tests for error cases',
      dir,
      DEFAULT_HARNESS
    )
    expect(result.status).toBe('running')
    expect(result.prompt).toContain('[FEEDBACK]')
  })
})

describe('gateDecide() edge cases', () => {
  let dir: string
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    vi.resetAllMocks()
    setupDefaultMocks()
    ;({ dir, cleanup } = await makeTmp())
  })
  afterEach(async () => cleanup())

  it('buildHistoryEntry handles run without completedAt (durationMs = 0)', async () => {
    const r = await createSpecToCodeRun({
      workspaceRoot: dir,
      harness: DEFAULT_HARNESS,
      providerId: 'p1',
      model: 'claude',
      prompt: 'test',
    })
    if ('error' in r) throw new Error(r.error)
    // completedAt is undefined at gate time — test that it doesn't throw
    delete (r.run as Partial<typeof r.run>).completedAt
    const result = await gateDecide(r.run, 'approve', undefined, dir, DEFAULT_HARNESS)
    expect(result.status).toBe('done')
  })
})

describe('abortRun()', () => {
  let dir: string
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    vi.resetAllMocks()
    setupDefaultMocks()
    ;({ dir, cleanup } = await makeTmp())
  })
  afterEach(async () => cleanup())

  async function makeRun() {
    const r = await createSpecToCodeRun({
      workspaceRoot: dir,
      harness: DEFAULT_HARNESS,
      providerId: 'p1',
      model: 'claude',
      prompt: 'Build auth',
    })
    if ('error' in r) throw new Error(`makeRun failed: ${r.error}`)
    return r.run
  }

  it('reverts all file changes and completes within 2000ms (SC-005)', async () => {
    const run = await makeRun()
    run.fileChanges = [
      { filePath: 'src/a.ts', status: 'new', linesAdded: 5, linesRemoved: 0, unifiedDiff: '' },
      { filePath: 'src/b.ts', status: 'modified', linesAdded: 3, linesRemoved: 1, unifiedDiff: '' },
    ]
    vi.resetAllMocks()
    setupDefaultMocks()
    const start = Date.now()
    const result = await abortRun(run, dir)
    const elapsed = Date.now() - start
    expect(result.status).toBe('aborted')
    expect(vi.mocked(gitMod.revertFiles)).toHaveBeenCalledWith(dir, ['src/a.ts', 'src/b.ts'])
    expect(elapsed).toBeLessThan(2000)
  })

  it('writes aborted history entry', async () => {
    const run = await makeRun()
    vi.resetAllMocks()
    setupDefaultMocks()
    await abortRun(run, dir)
    expect(vi.mocked(histMod.appendHistoryEntry)).toHaveBeenCalledOnce()
    const [, entry] = vi.mocked(histMod.appendHistoryEntry).mock.calls[0]
    expect(entry.status).toBe('aborted')
  })

  it('second concurrent createSpecToCodeRun for same workspace returns error', async () => {
    const r1 = await createSpecToCodeRun({
      workspaceRoot: dir,
      harness: DEFAULT_HARNESS,
      providerId: 'p1',
      model: 'claude',
      prompt: 'Build auth',
    })
    if ('error' in r1) throw new Error(r1.error)

    const r2 = await createSpecToCodeRun({
      workspaceRoot: dir,
      harness: DEFAULT_HARNESS,
      providerId: 'p1',
      model: 'claude',
      prompt: 'Another run',
      existingActiveRun: r1.run,
    })
    expect(r2).toHaveProperty('error')
    expect((r2 as { error: string }).error).toContain('already active')
  })
})

describe('gateDecide() coverage gaps', () => {
  let dir: string
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    vi.resetAllMocks()
    setupDefaultMocks()
    ;({ dir, cleanup } = await makeTmp())
  })
  afterEach(async () => cleanup())

  it('request-changes with no note uses default feedback text', async () => {
    const r = await createSpecToCodeRun({
      workspaceRoot: dir,
      harness: DEFAULT_HARNESS,
      providerId: 'p1',
      model: 'claude',
      prompt: 'Build auth',
    })
    if ('error' in r) throw new Error(r.error)
    const result = await gateDecide(r.run, 'request-changes', undefined, dir, DEFAULT_HARNESS)
    expect(result.status).toBe('running')
    expect(result.prompt).toContain('[FEEDBACK]')
    expect(result.currentIteration).toBe(2)
  })

  it('abortRun with no fileChanges skips revert, handles undefined prompt', async () => {
    const r = await createSpecToCodeRun({
      workspaceRoot: dir,
      harness: DEFAULT_HARNESS,
      providerId: 'p1',
      model: 'claude',
      prompt: '',
    })
    if ('error' in r) throw new Error(r.error)
    r.run.fileChanges = []
    r.run.prompt = undefined
    const result = await abortRun(r.run, dir)
    expect(result.status).toBe('aborted')
    expect(vi.mocked(gitMod.revertFiles)).not.toHaveBeenCalled()
    const [, entry] = vi.mocked(histMod.appendHistoryEntry).mock.calls[0]
    expect(entry.promptSummary).toBe('')
  })
})
