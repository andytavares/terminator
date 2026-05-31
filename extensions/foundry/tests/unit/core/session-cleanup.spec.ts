import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { tmpdir } from 'node:os'
import { cleanupLegacySessions } from '../../../src/core/session-cleanup.js'

// Mock child_process for git worktree remove calls
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}))
import * as cp from 'node:child_process'
const mockExecFile = cp.execFile as ReturnType<typeof vi.fn>

function mockExec(stdout: string, stderr = '', error: Error | null = null) {
  mockExecFile.mockImplementation(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (err: Error | null, out: { stdout: string; stderr: string }) => void
    ) => {
      cb(error, { stdout, stderr })
    }
  )
}

async function makeTmp() {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'foundry-cleanup-test-'))
  return { dir, cleanup: () => fs.rm(dir, { recursive: true, force: true }) }
}

describe('cleanupLegacySessions()', () => {
  let dir: string
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    vi.resetAllMocks()
    mockExec('')
    ;({ dir, cleanup } = await makeTmp())
  })
  afterEach(async () => cleanup())

  it('does nothing when no .foundry dir exists', async () => {
    await expect(cleanupLegacySessions(dir)).resolves.not.toThrow()
  })

  it('does nothing when session.json does not exist', async () => {
    await fs.mkdir(path.join(dir, '.foundry'), { recursive: true })
    await expect(cleanupLegacySessions(dir)).resolves.not.toThrow()
  })

  it('removes a legacy session.json that is missing featureBranch', async () => {
    await fs.mkdir(path.join(dir, '.foundry'), { recursive: true })
    const legacySession = {
      run: {
        id: 'run-old',
        status: 'running',
        workspaceRoot: dir,
        worktreePath: path.join(dir, '.worktrees', 'old-run'),
        worktreeBranch: 'foundry/old-run',
        // NOTE: no featureBranch field — this is the legacy format
      },
      logs: [],
    }
    await fs.writeFile(
      path.join(dir, '.foundry', 'session.json'),
      JSON.stringify(legacySession),
      'utf-8'
    )
    await cleanupLegacySessions(dir)
    await expect(fs.access(path.join(dir, '.foundry', 'session.json'))).rejects.toThrow()
  })

  it('does NOT remove a new-format session.json that has featureBranch', async () => {
    await fs.mkdir(path.join(dir, '.foundry'), { recursive: true })
    const newSession = {
      run: {
        id: 'run-new',
        status: 'gate',
        workspaceRoot: dir,
        baseBranch: 'main',
        featureBranch: 'fix/auth',
        worktreePath: path.join(dir, '.worktrees', 'fix-auth'),
      },
      logs: [],
    }
    await fs.writeFile(
      path.join(dir, '.foundry', 'session.json'),
      JSON.stringify(newSession),
      'utf-8'
    )
    await cleanupLegacySessions(dir)
    await expect(fs.access(path.join(dir, '.foundry', 'session.json'))).resolves.not.toThrow()
  })

  it('attempts to remove the referenced worktree directory on cleanup', async () => {
    await fs.mkdir(path.join(dir, '.foundry'), { recursive: true })
    const worktreePath = path.join(dir, '.worktrees', 'old-run')
    await fs.mkdir(worktreePath, { recursive: true })
    const legacySession = {
      run: {
        id: 'run-old',
        status: 'running',
        workspaceRoot: dir,
        worktreePath,
        worktreeBranch: 'foundry/old-run',
      },
      logs: [],
    }
    await fs.writeFile(
      path.join(dir, '.foundry', 'session.json'),
      JSON.stringify(legacySession),
      'utf-8'
    )
    await cleanupLegacySessions(dir)
    // Session file removed
    await expect(fs.access(path.join(dir, '.foundry', 'session.json'))).rejects.toThrow()
    // Worktree directory removed
    await expect(fs.access(worktreePath)).rejects.toThrow()
  })

  it('handles malformed session.json without throwing', async () => {
    await fs.mkdir(path.join(dir, '.foundry'), { recursive: true })
    await fs.writeFile(path.join(dir, '.foundry', 'session.json'), 'not json{{{', 'utf-8')
    await expect(cleanupLegacySessions(dir)).resolves.not.toThrow()
  })
})
