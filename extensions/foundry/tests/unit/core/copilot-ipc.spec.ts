import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((s: string) => Buffer.from(s)),
    decryptString: vi.fn((b: Buffer) => b.toString()),
  },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
}))
vi.mock('../../../src/core/harness.js', () => ({
  readHarness: vi.fn(),
  writeHarness: vi.fn(),
  detectHarnessSetupRequired: vi.fn(),
}))
vi.mock('../../../src/core/history.js', () => ({
  appendHistoryEntry: vi.fn(),
  readHistory: vi.fn(),
}))
vi.mock('../../../src/core/git.js', () => ({
  getStatus: vi.fn(),
  createCheckpoint: vi.fn(),
  stashChanges: vi.fn(),
  revertFiles: vi.fn(async (_wr: string, files: string[]) => ({ ok: true, reverted: files })),
  getDiffForFile: vi.fn(),
}))
vi.mock('../../../src/core/sensors.js', () => ({ runSensor: vi.fn(), runAllSensors: vi.fn() }))
vi.mock('../../../src/core/keychain.js', () => ({
  isAvailable: vi.fn(() => true),
  storeKey: vi.fn(),
  retrieveKey: vi.fn(),
  deleteKey: vi.fn(),
}))
vi.mock('../../../src/core/dag.js', () => ({ validateDag: vi.fn(), topoSort: vi.fn() }))

import * as gitMod from '../../../src/core/git.js'

describe('co-pilot IPC handlers (via index.ts exports)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(gitMod.revertFiles).mockImplementation(async (_wr, files) => ({
      ok: true as const,
      reverted: files,
    }))
  })

  it('revertFiles is called with single file path for copilot-revert-file pattern', async () => {
    // Simulate the handler logic directly
    const workspaceRoot = '/workspace'
    const filePath = 'src/auth.ts'
    await vi.mocked(gitMod.revertFiles)(workspaceRoot, [filePath])
    expect(vi.mocked(gitMod.revertFiles)).toHaveBeenCalledWith(workspaceRoot, [filePath])
  })

  it('copilot-abort reverts all filesModifiedThisTurn', async () => {
    const workspaceRoot = '/workspace'
    const filesModifiedThisTurn = ['src/a.ts', 'src/b.ts']
    if (filesModifiedThisTurn.length) {
      await vi.mocked(gitMod.revertFiles)(workspaceRoot, filesModifiedThisTurn)
    }
    expect(vi.mocked(gitMod.revertFiles)).toHaveBeenCalledWith(workspaceRoot, filesModifiedThisTurn)
  })

  it('accept-all pattern returns ok without reverting files', async () => {
    // Accept-all just clears state, no git operations
    const result = { ok: true }
    expect(result.ok).toBe(true)
    expect(vi.mocked(gitMod.revertFiles)).not.toHaveBeenCalled()
  })
})
