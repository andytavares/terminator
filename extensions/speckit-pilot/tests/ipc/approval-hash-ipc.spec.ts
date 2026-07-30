/**
 * Approve a spec, edit it by hand, and the board says so.
 *
 * Driven through the real handlers against a real directory, because the
 * failure this closes is not in either pure function — both had tests and
 * neither was called. `approvedHash` was only ever written as `null`.
 */
import { tmpdir as tmpdirForUserData } from 'node:os'

// A real directory. The supervision runtime writes its feed, mutes and
// per-session settings under userData, and a path that does not exist fails at
// mkdir. `node:fs` is mocked in some of these specs, so nothing is created
// here — the OS temp directory is already there.
const USER_DATA = tmpdirForUserData()

import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ExtensionAPI } from '../../../../src/main/extensions/api.js'
import type { PhaseId, PilotState } from '../../src/types/speckit.types.js'

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn().mockReturnValue([]) },
  safeStorage: {
    isEncryptionAvailable: vi.fn().mockReturnValue(false),
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  },
  // A real directory: the supervision runtime writes its feed, mutes and
  // per-session settings under userData, and a path that does not exist fails
  // at mkdir.
  app: { getPath: vi.fn().mockReturnValue(USER_DATA) },
}))

// Approving a phase auto-starts the next one. Nothing here is about that, and
// unmocked it would spawn a real agent.
vi.mock('../../src/runner/agent-runner.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    createAgentRunner: vi.fn().mockReturnValue({
      startPhaseRunner: vi.fn().mockReturnValue({ stop: vi.fn() }),
    }),
  }
})

// The runtime is irrelevant here and would bind a port.
vi.mock('../../src/runtime/control-server.js', () => ({
  createControlServer: vi.fn().mockRejectedValue(new Error('not needed for this test')),
}))

let repo: string
let featureDir: string
/**
 * Where the phase actually wrote the spec.
 *
 * Not `<repo>/specs/021-a/spec.md`: a phase runs in the card's worktree, and
 * `git worktree add` checks out a branch, so the card directory the board
 * created — uncommitted, in the main checkout — is not there. The agent creates
 * it inside the worktree. Verified against real git.
 */
let worktreePath: string
let specPath: string
let getHandler: (channel: string) => ((payload: unknown) => Promise<unknown>) | undefined

function call(channel: string, payload: unknown = {}): Promise<unknown> {
  const handler = getHandler(channel)
  if (handler === undefined) throw new Error(`${channel} is not registered`)
  return handler(payload)
}

/** The card on disk, as the pilot writes it: state in the repo, work in the worktree. */
async function seed(status: PhaseId extends never ? never : string = 'awaiting_review') {
  const { createInitialState } = await import('../../src/state/state-persistence.js')
  const state = createInitialState(featureDir) as PilotState
  state.phases.specify.status = status as PilotState['phases']['specify']['status']
  // Recorded against the main checkout, exactly as `defaultArtifactPaths` does.
  state.phases.specify.artifactPaths = [join(featureDir, 'spec.md')]
  state.worktreePath = worktreePath
  state.branchName = 'feat/a'
  writeFileSync(join(featureDir, '.pilot', 'state.json'), JSON.stringify(state))
}

beforeAll(async () => {
  repo = mkdtempSync(join(tmpdir(), 'approval-hash-'))
  featureDir = join(repo, 'specs', '021-a')
  worktreePath = join(repo, '.worktrees', 'feat-a')
  specPath = join(worktreePath, 'specs', '021-a', 'spec.md')
  mkdirSync(join(featureDir, '.pilot'), { recursive: true })
  mkdirSync(join(worktreePath, 'specs', '021-a'), { recursive: true })

  const handlers = new Map<string, (payload: unknown) => Promise<unknown>>()
  const api = {
    ipc: {
      registerHandler: vi.fn((channel: string, handler: (payload: unknown) => Promise<unknown>) => {
        handlers.set(channel, handler)
        return { dispose: vi.fn() }
      }),
      invokeChannel: vi.fn(),
      sendChannel: vi.fn(),
      onWindowEvent: vi.fn().mockReturnValue(() => {}),
      isRemoteAccessible: vi.fn().mockReturnValue(false),
    },
    window: { broadcast: vi.fn(), openAuxiliary: vi.fn(), focusSelf: vi.fn() },
    shell: {
      exec: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', timedOut: false }),
    },
    notifications: {
      showToast: vi.fn(),
      createNotification: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    settings: {
      register: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      get: vi.fn(),
      set: vi.fn(),
      resolveWorktreeBaseDir: vi.fn().mockReturnValue(join(repo, '.worktrees')),
    },
    terminal: {
      onSessionCreate: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onSessionClose: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    },
    workspace: {
      list: vi.fn().mockReturnValue([]),
      listProjects: vi.fn().mockReturnValue([]),
      createProject: vi.fn(),
      deleteProject: vi.fn(),
      onDelete: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onProjectDelete: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    },
    pty: {
      spawn: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      listSessions: vi.fn().mockReturnValue([]),
      attachOnData: vi.fn().mockReturnValue(null),
      attachOnExit: vi.fn().mockReturnValue(null),
      openTerminalTab: vi.fn(),
    },
    app: { version: '0.0.0-test' },
  } as unknown as ExtensionAPI

  const { activate } = await import('../../src/index.ts')
  activate(api)
  getHandler = (channel) => handlers.get(channel)
})

afterAll(() => rmSync(repo, { recursive: true, force: true, maxRetries: 5 }))

beforeEach(async () => {
  writeFileSync(specPath, '# Spec\n\nThe thing, as approved.\n')
  await seed()
})

describe('approving a phase', () => {
  it('hashes the artifact the phase wrote, not the path it was recorded under', async () => {
    // The recorded path is in the main checkout and nothing is there. Hashing
    // that would hash a permanently missing file: consistent, and useless.
    const { state } = (await call('speckit:phase-approve', {
      featureDir,
      phase: 'specify',
    })) as { state: PilotState }
    const withoutTheFile = state.phases.specify.approvedHash

    rmSync(specPath)
    const { state: second } = (await call('speckit:phase-approve', {
      featureDir,
      phase: 'specify',
    })) as { state: PilotState }
    expect(second.phases.specify.approvedHash).not.toBe(withoutTheFile)
  })

  it('records what it approved', async () => {
    const { state } = (await call('speckit:phase-approve', {
      featureDir,
      phase: 'specify',
    })) as { state: PilotState }
    expect(state.phases.specify.approvedHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('leaves a phase with no artifacts unhashed rather than hashing nothing', async () => {
    // `analyze`, `implement` and `open-pr` produce none, and a hash of nothing
    // would make every one of them look modified on the next read.
    const { state } = (await call('speckit:phase-approve', {
      featureDir,
      phase: 'analyze',
    })) as { state: PilotState }
    expect(state.phases.analyze.approvedHash).toBeNull()
  })
})

describe('reading the card afterwards', () => {
  it('says nothing while the artifact is what was approved', async () => {
    await call('speckit:phase-approve', { featureDir, phase: 'specify' })
    const { state } = (await call('speckit:pilot-state', { featureDir })) as { state: PilotState }
    expect(state.phases.specify.status).toBe('approved')
  })

  it('marks it modified once the artifact is edited by hand', async () => {
    await call('speckit:phase-approve', { featureDir, phase: 'specify' })
    writeFileSync(specPath, '# Spec\n\nThe thing, and one more thing nobody approved.\n')

    const { state } = (await call('speckit:pilot-state', { featureDir })) as { state: PilotState }
    expect(state.phases.specify.status).toBe('modified')
  })

  it('marks it modified when the artifact is deleted', async () => {
    await call('speckit:phase-approve', { featureDir, phase: 'specify' })
    rmSync(specPath)

    const { state } = (await call('speckit:pilot-state', { featureDir })) as { state: PilotState }
    expect(state.phases.specify.status).toBe('modified')
  })

  it('does not write the verdict back, so undoing the edit undoes it', async () => {
    // The record of what you approved is the approval. Rewriting it on a read
    // would make "modified" outlive the edit.
    await call('speckit:phase-approve', { featureDir, phase: 'specify' })
    writeFileSync(specPath, 'edited')
    await call('speckit:pilot-state', { featureDir })

    writeFileSync(specPath, '# Spec\n\nThe thing, as approved.\n')
    const { state } = (await call('speckit:pilot-state', { featureDir })) as { state: PilotState }
    expect(state.phases.specify.status).toBe('approved')
  })

  it('leaves a phase approved before hashes were kept alone', async () => {
    // Reporting every one of those as modified would be noise nobody can act on.
    await seed('approved')
    const { state } = (await call('speckit:pilot-state', { featureDir })) as { state: PilotState }
    expect(state.phases.specify.status).toBe('approved')
  })
})

describe('the gate preview', () => {
  it('shows the artifact the phase wrote, from the worktree it wrote it in', async () => {
    // Reading the recorded path instead showed "No artifact to preview" for
    // every supervised run, which is every run.
    writeFileSync(specPath, '# Spec\n\nWhat the agent wrote.\n')
    const result = (await call('speckit:artifact-read', {
      filePath: join(featureDir, 'spec.md'),
      featureDir,
    })) as { current: string | null }
    expect(result.current).toContain('What the agent wrote.')
  })

  it('reports nothing rather than throwing when there is no such artifact', async () => {
    const result = (await call('speckit:artifact-read', {
      filePath: join(featureDir, 'nothing.md'),
      featureDir,
    })) as { current: string | null }
    expect(result.current).toBeNull()
  })
})

describe('skipping a phase', () => {
  it('skips it, and lets it back', async () => {
    const skipped = (await call('speckit:phase-skip', { featureDir, phase: 'checklist' })) as {
      state: PilotState
    }
    expect(skipped.state.phases.checklist.status).toBe('skipped')

    const restored = (await call('speckit:phase-unskip', { featureDir, phase: 'checklist' })) as {
      state: PilotState
    }
    expect(restored.state.phases.checklist.status).toBe('ready')
  })
})
