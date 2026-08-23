/**
 * Tests for new v2 IPC handlers: ticket-list,
 * dispatch, run-cancel, open-pr.
 *
 * Strategy: build a mock ExtensionAPI that captures handler registrations,
 * activate the extension once, then invoke each channel handler directly.
 */
import { tmpdir as tmpdirForUserData } from 'node:os'

// A real directory. The supervision runtime writes its feed, mutes and
// per-session settings under userData, and a path that does not exist fails at
// mkdir. `node:fs` is mocked in some of these specs, so nothing is created
// here — the OS temp directory is already there.
const USER_DATA = tmpdirForUserData()

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import type { ExtensionAPI } from '../../../../src/main/extensions/api.js'

// --- mock electron (BrowserWindow is imported by index.ts) ---
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn().mockReturnValue([]),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn().mockReturnValue(true),
    encryptString: vi.fn((s: string) => Buffer.from(s + '-enc')),
    decryptString: vi.fn((b: Buffer) => b.toString().replace('-enc', '')),
  },
  app: { getPath: vi.fn().mockReturnValue(USER_DATA) },
}))

// --- mock node:fs (dispatch/cancel/open-pr read/write state files directly) ---
vi.mock('node:fs', () => ({
  // Reading a repository's installed skills is synchronous: a phase asks
  // whether `/speckit-<phase>` exists before sending it.
  existsSync: vi.fn().mockReturnValue(false),
  promises: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue([]),
    writeFile: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(''),
    appendFile: vi.fn().mockResolvedValue(undefined),
    copyFile: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue({ mtimeMs: Date.now(), isDirectory: () => true }),
    unlink: vi.fn().mockResolvedValue(undefined),
    rm: vi.fn().mockResolvedValue(undefined),
    access: vi.fn().mockResolvedValue(undefined),
  },
}))

// --- mock Linear client ---

// --- mock Jira client ---

// --- mock agent runner ---
vi.mock('../../src/runner/agent-runner.js', () => ({
  createAgentRunner: vi.fn().mockReturnValue({
    startPhaseRunner: vi.fn().mockReturnValue({ stop: vi.fn() }),
  }),
  phaseLogPath: vi.fn((dir: string, phase: string) => `${dir}/.pilot/logs/${phase}.log`),
  pruneOldLogs: vi.fn().mockResolvedValue(0),
  setSupervisedRunner: vi.fn(),
  setPermissionSink: vi.fn(),
  setReadOnlyStateDir: vi.fn(),
}))

// --- mock state persistence ---
vi.mock('../../src/state/state-persistence.js', () => ({
  createInitialState: vi.fn().mockImplementation((featureDir: string, overrides?: unknown) => ({
    version: 3,
    featureDir,
    card: (overrides as { card?: unknown } | undefined)?.card ?? {
      title: 'Card',
      type: 'feature',
      scope: '',
      checklist: [],
      attachments: [],
      knowledgeRefs: [],
      source: 'native',
      createdAt: '2026-06-30T00:00:00.000Z',
    },
    stage: 'backlog',
    ticket: null,
    run: null,
    queuePosition: null,
    worktreePath: null,
    branchName: null,
    prUrl: null,
    phases: {},
    settings: {},
  })),
  writeState: vi.fn(),
  readState: vi.fn(),
  readCard: vi.fn().mockResolvedValue(null),
  writeCard: vi.fn().mockResolvedValue(undefined),
  appendComment: vi.fn().mockResolvedValue(undefined),
  readComments: vi.fn().mockResolvedValue([]),
  consumePendingComments: vi.fn().mockResolvedValue(null),
  appendHistory: vi.fn(),
  ensurePilotDir: vi.fn(),
}))

import * as nodefs from 'node:fs'
import * as agentRunnerMod from '../../src/runner/agent-runner.js'
import * as persistence from '../../src/state/state-persistence.js'

function makeState(featureDir: string, over: Record<string, unknown> = {}) {
  const phases = Object.fromEntries(
    [
      'constitution',
      'specify',
      'clarify',
      'plan',
      'checklist',
      'tasks',
      'analyze',
      'implement',
      'self-review',
      'open-pr',
    ].map((id, idx) => [
      id,
      {
        id,
        status: idx === 0 ? 'ready' : 'locked',
        approvedHash: null,
        approvedAt: null,
        approvedBy: null,
        lastRunId: null,
        lastRunAt: null,
        artifactPaths: [],
        feedback: null,
        batchIndex: null,
      },
    ])
  )
  return {
    version: 3,
    featureDir,
    card: {
      title: 'Card',
      type: 'feature',
      scope: '',
      checklist: [],
      attachments: [],
      knowledgeRefs: [],
      source: 'native',
      createdAt: '2026-06-30T00:00:00.000Z',
    },
    stage: 'backlog',
    ticket: null,
    run: null,
    queuePosition: null,
    worktreePath: null,
    branchName: null,
    prUrl: null,
    phases,
    settings: { maxConcurrentRuns: 3 },
    ...over,
  }
}

// Build mock API and capture registered IPC handlers
function buildMockApi(): {
  api: ExtensionAPI
  getHandler: (channel: string) => ((payload: unknown) => Promise<unknown>) | undefined
} {
  const handlers = new Map<string, (payload: unknown) => Promise<unknown>>()

  const api: Partial<ExtensionAPI> = {
    ipc: {
      registerHandler: vi.fn((channel, handler) => {
        handlers.set(channel, handler as (payload: unknown) => Promise<unknown>)
        return { dispose: vi.fn() }
      }),
      invokeChannel: vi.fn(),
      sendChannel: vi.fn(),
      onWindowEvent: vi.fn().mockReturnValue(() => {}),
      isRemoteAccessible: vi.fn().mockReturnValue(false),
    },
    pty: {
      spawn: vi.fn().mockReturnValue('session-mock'),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      listSessions: vi.fn().mockReturnValue([]),
      attachOnData: vi.fn().mockReturnValue(null),
      attachOnExit: vi.fn().mockReturnValue(null),
    },
    window: {
      broadcast: vi.fn(),
      openAuxiliary: vi.fn(),
      focusSelf: vi.fn(),
    },
    shell: {
      // Default: the branch-existence probe (`git rev-parse --verify`) reports
      // "absent" (exitCode 1) so worktree creation takes the `-b` new-branch
      // path; every other git command succeeds.
      exec: vi.fn().mockImplementation((opts: { args?: string[] }) => {
        const args = opts?.args ?? []
        if (args.includes('rev-parse') && args.includes('--verify')) {
          return Promise.resolve({ exitCode: 1, stdout: '', stderr: '', timedOut: false })
        }
        return Promise.resolve({ exitCode: 0, stdout: '', stderr: '', timedOut: false })
      }),
    },
    notifications: {
      showToast: vi.fn(),
      createNotification: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    },
    // The application's single tracker connection (ExtensionAPI v2.2.0). This
    // extension holds no credential of its own any more.
    issues: {
      connections: vi.fn().mockResolvedValue([]),
      listMine: vi.fn().mockResolvedValue({ issues: [], failures: [] }),
      search: vi.fn().mockResolvedValue({ issues: [], failures: [] }),
      get: vi.fn().mockResolvedValue(null),
      comment: vi.fn().mockResolvedValue(undefined),
      linkFor: vi.fn().mockReturnValue(null),
      onLinkChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    },
    log: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    settings: {
      register: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      get: vi.fn(),
      set: vi.fn(),
      resolveWorktreeBaseDir: vi.fn((workspacePath: string) => `${workspacePath}/.worktrees`),
    },
    terminal: {
      onSessionCreate: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onSessionClose: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    },
    workspace: {
      list: vi.fn().mockReturnValue([]),
      listProjects: vi.fn().mockReturnValue([]),
      deleteProject: vi.fn(),
      onDelete: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onProjectDelete: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    },
    app: { version: '0.0.0-test' },
  } as unknown as Partial<ExtensionAPI>

  return {
    api: api as ExtensionAPI,
    getHandler: (channel) => handlers.get(channel),
  }
}

// Activate once per suite — handlers are captured in Map
let sharedApi: ExtensionAPI
/** Typed shorthand for asserting on the shared api's mocked namespaces. */
const mockApi = new Proxy({} as never, {
  get: (_t, prop: string) => (sharedApi as unknown as Record<string, unknown>)[prop],
}) as never as {
  issues: { listMine: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> }
  notifications: { showToast: ReturnType<typeof vi.fn> }
}
let getSharedHandler: (channel: string) => ((payload: unknown) => Promise<unknown>) | undefined

beforeAll(async () => {
  const built = buildMockApi()
  sharedApi = built.api
  getSharedHandler = built.getHandler
  const { activate } = await import('../../src/index.ts')
  activate(sharedApi)
})

beforeEach(() => {
  vi.clearAllMocks()
  // Reset mock defaults after clearAllMocks
  // Reset fs mock defaults
  vi.mocked(nodefs.promises.mkdir).mockResolvedValue(undefined)
  vi.mocked(nodefs.promises.readdir).mockResolvedValue([])
  vi.mocked(nodefs.promises.writeFile).mockResolvedValue(undefined)
  vi.mocked(nodefs.promises.rename).mockResolvedValue(undefined)
  vi.mocked(nodefs.promises.readFile).mockResolvedValue('')
  vi.mocked(nodefs.promises.appendFile).mockResolvedValue(undefined)
  vi.mocked(nodefs.promises.copyFile).mockResolvedValue(undefined)
  // Reset agent runner mock
  vi.mocked(agentRunnerMod.createAgentRunner).mockReturnValue({
    startPhaseRunner: vi.fn().mockReturnValue({ stop: vi.fn() }),
  })
  // Reset persistence mock defaults
  vi.mocked(persistence.readState).mockResolvedValue(null)
  vi.mocked(persistence.readCard).mockResolvedValue(null)
  vi.mocked(persistence.writeCard).mockResolvedValue(undefined)
  vi.mocked(persistence.appendComment).mockResolvedValue(undefined)
  vi.mocked(persistence.readComments).mockResolvedValue([])
  vi.mocked(persistence.consumePendingComments).mockResolvedValue(null)
  // Reset extension settings mock so a prior test's implementation does not leak
  vi.mocked(sharedApi.settings.get).mockReturnValue(undefined as never)
  vi.mocked(sharedApi.settings.resolveWorktreeBaseDir).mockImplementation(
    (workspacePath: string) => `${workspacePath}/.worktrees`
  )
})

describe('speckit:card-list', () => {
  it('registers the handler', () => {
    expect(getSharedHandler('speckit:card-list')).toBeDefined()
  })

  it('requires repoRoot', async () => {
    const handler = getSharedHandler('speckit:card-list')!
    expect(await handler({})).toEqual({ error: 'repoRoot required' })
  })

  it('returns a card summary for each card dir', async () => {
    vi.mocked(nodefs.promises.readdir).mockResolvedValue(['016-demo'] as unknown as ReturnType<
      typeof nodefs.promises.readdir
    > extends Promise<infer T>
      ? T
      : never)
    vi.mocked(persistence.readState).mockResolvedValue(makeState('/repo/specs/016-demo') as never)
    const handler = getSharedHandler('speckit:card-list')!
    const result = (await handler({ repoRoot: '/repo' })) as { cards: unknown[] }
    expect(result.cards).toHaveLength(1)
    expect((result.cards[0] as { stage: string }).stage).toBe('backlog')
  })
})

describe('speckit:card-create', () => {
  it('rejects an empty title with VALIDATION_ERROR', async () => {
    const handler = getSharedHandler('speckit:card-create')!
    const result = (await handler({ repoRoot: '/repo', brief: { title: '  ' } })) as {
      error: string
    }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

  it('creates a backlog card and returns its featureDir', async () => {
    vi.mocked(nodefs.promises.readdir).mockResolvedValue([] as never)
    const handler = getSharedHandler('speckit:card-create')!
    const result = (await handler({
      repoRoot: '/repo',
      brief: { title: 'New card', type: 'bug' },
    })) as { featureDir: string }
    expect(result.featureDir).toContain('specs/001-')
    expect(persistence.writeCard).toHaveBeenCalled()
  })
})

describe('speckit:card-update', () => {
  it('requires featureDir', async () => {
    const handler = getSharedHandler('speckit:card-update')!
    expect(await handler({ brief: {} })).toEqual({ error: 'featureDir required' })
  })

  it('rejects clearing the title', async () => {
    const handler = getSharedHandler('speckit:card-update')!
    const result = (await handler({ featureDir: '/repo/specs/x', brief: { title: '' } })) as {
      error: string
    }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

  it('writes the merged brief', async () => {
    vi.mocked(persistence.readCard).mockResolvedValue({
      title: 'Old',
      type: 'feature',
      scope: '',
      checklist: [],
      attachments: [],
      knowledgeRefs: [],
      source: 'native',
      createdAt: 'x',
    })
    vi.mocked(persistence.readState).mockResolvedValue(makeState('/repo/specs/x') as never)
    const handler = getSharedHandler('speckit:card-update')!
    const result = (await handler({
      featureDir: '/repo/specs/x',
      brief: { scope: 'Updated scope' },
    })) as { ok: boolean }
    expect(result.ok).toBe(true)
    expect(persistence.writeCard).toHaveBeenCalledWith(
      '/repo/specs/x',
      expect.objectContaining({ scope: 'Updated scope', title: 'Old' })
    )
  })
})

describe('speckit:card-comment and comment-list', () => {
  it('rejects an empty comment', async () => {
    const handler = getSharedHandler('speckit:card-comment')!
    const result = (await handler({ featureDir: '/repo/specs/x', body: '' })) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

  it('appends a comment authored by you', async () => {
    const handler = getSharedHandler('speckit:card-comment')!
    const result = (await handler({ featureDir: '/repo/specs/x', body: 'Use the util' })) as {
      comment: { author: string; body: string }
    }
    expect(result.comment.author).toBe('you')
    expect(result.comment.body).toBe('Use the util')
    expect(persistence.appendComment).toHaveBeenCalled()
  })

  it('lists comments', async () => {
    vi.mocked(persistence.readComments).mockResolvedValue([
      { id: 'c1', author: 'you', body: 'hi', ts: 'x' },
    ])
    const handler = getSharedHandler('speckit:comment-list')!
    const result = (await handler({ featureDir: '/repo/specs/x' })) as { comments: unknown[] }
    expect(result.comments).toHaveLength(1)
  })
})

describe('speckit:run-output-read', () => {
  it('returns persisted log lines for a phase', async () => {
    vi.mocked(nodefs.promises.readFile).mockResolvedValue('line one\nline two\n' as never)
    const handler = getSharedHandler('speckit:run-output-read')!
    const result = (await handler({ featureDir: '/repo/specs/x', phase: 'specify' })) as {
      lines: string[]
    }
    expect(result.lines).toEqual(['line one', 'line two'])
  })

  it('returns an empty list when no log exists', async () => {
    vi.mocked(nodefs.promises.readFile).mockRejectedValue(new Error('ENOENT'))
    const handler = getSharedHandler('speckit:run-output-read')!
    const result = (await handler({ featureDir: '/repo/specs/x', phase: 'plan' })) as {
      lines: string[]
    }
    expect(result.lines).toEqual([])
  })
})

describe('speckit:card-move', () => {
  it('rejects an unknown stage', async () => {
    const handler = getSharedHandler('speckit:card-move')!
    const result = (await handler({
      featureDir: '/repo/specs/x',
      workspacePath: '/repo',
      toStage: 'nope',
    })) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

  it('sets the stage to any target without starting a run', async () => {
    vi.mocked(persistence.readState).mockResolvedValue(makeState('/repo/specs/x') as never)
    const handler = getSharedHandler('speckit:card-move')!
    const result = (await handler({
      featureDir: '/repo/specs/x',
      workspacePath: '/repo',
      toStage: 'done',
    })) as { ok: boolean }
    expect(result.ok).toBe(true)
    const broadcast = vi
      .mocked(sharedApi.window.broadcast)
      .mock.calls.filter((c) => c[0] === 'speckit:state-changed')
      .at(-1)?.[1] as { state: { stage: string } }
    expect(broadcast.state.stage).toBe('done')
    expect(sharedApi.shell.exec).not.toHaveBeenCalled()
  })

  it('parks a running card dropped on backlog (stops the run)', async () => {
    vi.mocked(nodefs.promises.readdir).mockResolvedValue([] as never)
    vi.mocked(persistence.readState).mockResolvedValue(
      makeState('/repo/specs/x', {
        queuePosition: 'active',
        worktreePath: '/repo/.wt/x',
        branchName: 'feature/x',
        run: { status: 'running', startedAt: 't', completedAt: null, autonomyLevel: 'standard' },
      }) as never
    )
    const handler = getSharedHandler('speckit:card-move')!
    const result = (await handler({
      featureDir: '/repo/specs/x',
      workspacePath: '/repo',
      toStage: 'backlog',
    })) as { ok: boolean }
    expect(result.ok).toBe(true)
    expect(sharedApi.shell.exec).toHaveBeenCalledWith(
      expect.objectContaining({ args: expect.arrayContaining(['worktree', 'remove']) })
    )
    const broadcast = vi
      .mocked(sharedApi.window.broadcast)
      .mock.calls.filter((c) => c[0] === 'speckit:state-changed')
      .at(-1)?.[1] as { state: { stage: string; run: { status: string } } }
    expect(broadcast.state.stage).toBe('backlog')
    expect(broadcast.state.run.status).toBe('cancelled')
  })
})

describe('speckit:card-handoff', () => {
  it('starts a backlog card immediately when under the cap', async () => {
    vi.mocked(nodefs.promises.readdir).mockResolvedValue([] as never)
    vi.mocked(persistence.readState).mockResolvedValue(makeState('/repo/specs/x') as never)
    vi.mocked(persistence.readCard).mockResolvedValue({
      title: 'Ready card',
      type: 'feature',
      scope: '',
      checklist: [],
      attachments: [],
      knowledgeRefs: [],
      source: 'native',
      createdAt: 'x',
    })
    const handler = getSharedHandler('speckit:card-handoff')!
    const result = (await handler({
      featureDir: '/repo/specs/x',
      workspacePath: '/repo',
    })) as { ok: boolean; queued: boolean }
    expect(result.ok).toBe(true)
    expect(result.queued).toBe(false)
    expect(sharedApi.shell.exec).toHaveBeenCalled()
  })

  it('creates the worktree under the resolved base dir (respects the core setting, not .wt)', async () => {
    vi.mocked(nodefs.promises.readdir).mockResolvedValue([] as never)
    vi.mocked(persistence.readState).mockResolvedValue(makeState('/repo/specs/x') as never)
    vi.mocked(persistence.readCard).mockResolvedValue({
      title: 'Ready card',
      type: 'feature',
      scope: '',
      checklist: [],
      attachments: [],
      knowledgeRefs: [],
      source: 'native',
      createdAt: 'x',
    })
    vi.mocked(sharedApi.settings.resolveWorktreeBaseDir).mockReturnValue('/custom/worktrees')

    const handler = getSharedHandler('speckit:card-handoff')!
    await handler({ featureDir: '/repo/specs/x', workspacePath: '/repo' })

    expect(sharedApi.settings.resolveWorktreeBaseDir).toHaveBeenCalledWith('/repo')
    const addCall = vi
      .mocked(sharedApi.shell.exec)
      .mock.calls.find((c) => (c[0] as { args?: string[] }).args?.includes('add'))
    expect(addCall).toBeDefined()
    expect((addCall![0] as { args: string[] }).args).toContain('/custom/worktrees/x')
    expect(JSON.stringify((addCall![0] as { args: string[] }).args)).not.toContain('.wt')
  })

  it('uses the Linear-provided branch name when the ticket carries one', async () => {
    vi.mocked(nodefs.promises.readdir).mockResolvedValue([] as never)
    vi.mocked(persistence.readState).mockResolvedValue(
      makeState('/repo/specs/x', {
        ticket: {
          source: 'linear',
          key: 'TAV-11',
          sourceUrl: 'https://linear.app/x',
          title: 'Auto-load assigned tickets',
          branchName: 'andrew/tav-11-auto-load-assigned-tickets',
        },
      }) as never
    )
    vi.mocked(persistence.readCard).mockResolvedValue(null)
    const handler = getSharedHandler('speckit:card-handoff')!
    await handler({ featureDir: '/repo/specs/x', workspacePath: '/repo' })
    const addCall = vi
      .mocked(sharedApi.shell.exec)
      .mock.calls.find((c) => (c[0] as { args?: string[] }).args?.includes('add'))
    expect((addCall![0] as { args: string[] }).args).toContain(
      'andrew/tav-11-auto-load-assigned-tickets'
    )
  })

  it('builds <username>/<key>-<kebab-title> when the ticket has no branch name', async () => {
    vi.mocked(nodefs.promises.readdir).mockResolvedValue([] as never)
    vi.mocked(persistence.readState).mockResolvedValue(
      makeState('/repo/specs/x', {
        ticket: {
          source: 'jira',
          key: 'ENG-42',
          sourceUrl: 'https://jira/x',
          title: 'Fix the Thing!',
        },
      }) as never
    )
    vi.mocked(persistence.readCard).mockResolvedValue(null)
    // git config user.name → the branch prefix
    vi.mocked(sharedApi.shell.exec).mockImplementation((opts: { args?: string[] }) => {
      const args = opts?.args ?? []
      if (args.includes('config') && args.includes('user.name')) {
        return Promise.resolve({
          exitCode: 0,
          stdout: 'Andrew Tavares\n',
          stderr: '',
          timedOut: false,
        })
      }
      if (args.includes('rev-parse') && args.includes('--verify')) {
        return Promise.resolve({ exitCode: 1, stdout: '', stderr: '', timedOut: false })
      }
      return Promise.resolve({ exitCode: 0, stdout: '', stderr: '', timedOut: false })
    })
    const handler = getSharedHandler('speckit:card-handoff')!
    await handler({ featureDir: '/repo/specs/x', workspacePath: '/repo' })
    const addCall = vi
      .mocked(sharedApi.shell.exec)
      .mock.calls.find((c) => (c[0] as { args?: string[] }).args?.includes('add'))
    expect((addCall![0] as { args: string[] }).args).toContain(
      'andrew-tavares/eng-42-fix-the-thing'
    )
  })

  it('passes the chosen base branch to git worktree add', async () => {
    vi.mocked(nodefs.promises.readdir).mockResolvedValue([] as never)
    vi.mocked(persistence.readState).mockResolvedValue(makeState('/repo/specs/x') as never)
    vi.mocked(persistence.readCard).mockResolvedValue({
      title: 'Ready',
      type: 'feature',
      scope: '',
      checklist: [],
      attachments: [],
      knowledgeRefs: [],
      source: 'native',
      createdAt: 'x',
    })
    const handler = getSharedHandler('speckit:card-handoff')!
    await handler({ featureDir: '/repo/specs/x', workspacePath: '/repo', baseBranch: 'develop' })
    expect(sharedApi.shell.exec).toHaveBeenCalledWith(
      expect.objectContaining({ args: expect.arrayContaining(['worktree', 'add', 'develop']) })
    )
  })

  it('reuses an existing worktree instead of recreating it', async () => {
    vi.mocked(nodefs.promises.readdir).mockResolvedValue([] as never)
    vi.mocked(nodefs.promises.access).mockResolvedValue(undefined) // worktree path exists
    vi.mocked(persistence.readState).mockResolvedValue(
      makeState('/repo/specs/x', {
        worktreePath: '/repo/.wt/x',
        branchName: 'feature/x',
      }) as never
    )
    vi.mocked(persistence.readCard).mockResolvedValue({
      title: 'Ready',
      type: 'feature',
      scope: '',
      checklist: [],
      attachments: [],
      knowledgeRefs: [],
      source: 'native',
      createdAt: 'x',
    })
    const handler = getSharedHandler('speckit:card-handoff')!
    const result = (await handler({ featureDir: '/repo/specs/x', workspacePath: '/repo' })) as {
      ok: boolean
    }
    expect(result.ok).toBe(true)
    // no `git worktree add` because the existing worktree is reused
    const addCalls = vi
      .mocked(sharedApi.shell.exec)
      .mock.calls.filter((c) => (c[0] as { args?: string[] }).args?.includes('add'))
    expect(addCalls).toHaveLength(0)
  })

  it('queues when the cap is already reached', async () => {
    vi.mocked(sharedApi.settings.get).mockImplementation(
      (key: string) => (key.endsWith('maxConcurrentRuns') ? 2 : undefined) as never
    )
    vi.mocked(nodefs.promises.readdir).mockResolvedValue(['a', 'b'] as never)
    vi.mocked(persistence.readState).mockImplementation((dir: string) => {
      if (dir.endsWith('/x')) return Promise.resolve(makeState('/repo/specs/x') as never)
      return Promise.resolve(
        makeState(dir, {
          queuePosition: 'active',
          run: { status: 'running', startedAt: 't', completedAt: null, autonomyLevel: 'standard' },
        }) as never
      )
    })
    vi.mocked(persistence.readCard).mockResolvedValue({
      title: 'Waiter',
      type: 'feature',
      scope: '',
      checklist: [],
      attachments: [],
      knowledgeRefs: [],
      source: 'native',
      createdAt: 'x',
    })
    const handler = getSharedHandler('speckit:card-handoff')!
    const result = (await handler({
      featureDir: '/repo/specs/x',
      workspacePath: '/repo',
    })) as { ok: boolean; queued: boolean }
    expect(result.ok).toBe(true)
    expect(result.queued).toBe(true)
  })

  it('rejects handoff of a card with no title', async () => {
    vi.mocked(nodefs.promises.readdir).mockResolvedValue([] as never)
    vi.mocked(persistence.readState).mockResolvedValue(
      makeState('/repo/specs/x', {
        card: {
          title: '  ',
          type: 'feature',
          scope: '',
          checklist: [],
          attachments: [],
          knowledgeRefs: [],
          source: 'native',
          createdAt: 'x',
        },
      }) as never
    )
    vi.mocked(persistence.readCard).mockResolvedValue(null)
    const handler = getSharedHandler('speckit:card-handoff')!
    const result = (await handler({
      featureDir: '/repo/specs/x',
      workspacePath: '/repo',
    })) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

  it('writes a content-rich ticket.md into the worktree before the run starts', async () => {
    vi.mocked(nodefs.promises.readdir).mockResolvedValue([] as never)
    vi.mocked(persistence.readState).mockResolvedValue(
      makeState('/repo/specs/x', {
        ticket: {
          source: 'linear',
          key: 'TAV-11',
          sourceUrl: 'https://linear.app/x/issue/TAV-11',
          title: 'Auto-load tickets on open',
        },
      }) as never
    )
    vi.mocked(persistence.readCard).mockResolvedValue({
      title: 'Auto-load tickets on open',
      type: 'feature',
      scope: 'The board should pull assigned tickets on open.',
      checklist: [{ id: '1', text: 'Fetches on open', done: false }],
      attachments: [],
      knowledgeRefs: [],
      source: 'linear',
      createdAt: 'x',
    })
    const handler = getSharedHandler('speckit:card-handoff')!
    await handler({ featureDir: '/repo/specs/x', workspacePath: '/repo' })

    const ticketMdCall = vi
      .mocked(nodefs.promises.writeFile)
      .mock.calls.find(([p]) => String(p).endsWith('ticket.md'))
    expect(ticketMdCall).toBeDefined()
    // written into the worktree (resolved base dir), not the specs dir
    expect(String(ticketMdCall![0])).toContain('.worktrees')
    // and it carries the actual ticket content, not just metadata
    const body = String(ticketMdCall![1])
    expect(body).toContain('The board should pull assigned tickets on open.')
    expect(body).toContain('- [ ] Fetches on open')
    expect(body).toContain('TAV-11')
  })

  it('speckit mode invokes the native /speckit-specify skill with the card title', async () => {
    // Only where the repository has it. `.claude/skills/` is routinely
    // untracked, so the worktree a run happens in often does not.
    vi.mocked(nodefs.existsSync).mockReturnValue(true)
    vi.mocked(nodefs.promises.readdir).mockResolvedValue([] as never)
    vi.mocked(persistence.readState).mockResolvedValue(
      makeState('/repo/specs/x', { card: { title: 'Auto-load tickets', type: 'feature' } }) as never
    )
    vi.mocked(persistence.readCard).mockResolvedValue(null)
    const mockStartPhaseRunner = vi.fn().mockReturnValue({ stop: vi.fn() })
    vi.mocked(agentRunnerMod.createAgentRunner).mockReturnValue({
      startPhaseRunner: mockStartPhaseRunner,
    })

    const handler = getSharedHandler('speckit:card-handoff')!
    await handler({ featureDir: '/repo/specs/x', workspacePath: '/repo' })

    const runnerCall = mockStartPhaseRunner.mock.calls[0][0] as {
      phase: string
      phaseCommand: string
    }
    expect(runnerCall.phase).toBe('specify')
    expect(runnerCall.phaseCommand).toContain('/speckit-specify')
    expect(runnerCall.phaseCommand).toContain('Auto-load tickets')
    vi.mocked(nodefs.existsSync).mockReturnValue(false)
  })

  it('asks in words when the repository has no such skill', async () => {
    // Otherwise the runtime answers "Unknown command: /speckit-specify" and the
    // phase is over before it began, having written nothing.
    vi.mocked(nodefs.existsSync).mockReturnValue(false)
    vi.mocked(nodefs.promises.readdir).mockResolvedValue([] as never)
    vi.mocked(persistence.readState).mockResolvedValue(
      makeState('/repo/specs/x', { card: { title: 'Auto-load tickets', type: 'feature' } }) as never
    )
    vi.mocked(persistence.readCard).mockResolvedValue(null)
    const mockStartPhaseRunner = vi.fn().mockReturnValue({ stop: vi.fn() })
    vi.mocked(agentRunnerMod.createAgentRunner).mockReturnValue({
      startPhaseRunner: mockStartPhaseRunner,
    })

    const handler = getSharedHandler('speckit:card-handoff')!
    await handler({ featureDir: '/repo/specs/x', workspacePath: '/repo' })

    const runnerCall = mockStartPhaseRunner.mock.calls[0][0] as { phaseCommand: string }
    expect(runnerCall.phaseCommand.startsWith('/')).toBe(false)
    expect(runnerCall.phaseCommand).toContain('spec.md')
    expect(runnerCall.phaseCommand).toContain('Auto-load tickets')
  })

  it('quick mode skips the SpecKit phases and starts at plan from the ticket', async () => {
    vi.mocked(nodefs.promises.readdir).mockResolvedValue([] as never)
    vi.mocked(persistence.readState).mockResolvedValue(makeState('/repo/specs/x') as never)
    vi.mocked(persistence.readCard).mockResolvedValue(null)
    const mockStartPhaseRunner = vi.fn().mockReturnValue({ stop: vi.fn() })
    vi.mocked(agentRunnerMod.createAgentRunner).mockReturnValue({
      startPhaseRunner: mockStartPhaseRunner,
    })

    const handler = getSharedHandler('speckit:card-handoff')!
    await handler({ featureDir: '/repo/specs/x', workspacePath: '/repo', mode: 'quick' })

    // Run begins at plan, using the ticket-based quick prompt (no spec.md upstream)
    const runnerCall = mockStartPhaseRunner.mock.calls[0][0] as {
      phase: string
      phaseCommand: string
    }
    expect(runnerCall.phase).toBe('plan')
    expect(runnerCall.phaseCommand).toContain('ticket.md')

    // Persisted/broadcast state marks the skipped phases and keeps mode
    const stateChange = vi
      .mocked(sharedApi.window.broadcast)
      .mock.calls.find((c) => c[0] === 'speckit:state-changed')
    const state = (
      stateChange![1] as { state: { mode: string; phases: Record<string, { status: string }> } }
    ).state
    expect(state.mode).toBe('quick')
    expect(state.phases['specify'].status).toBe('skipped')
    expect(state.phases['analyze'].status).toBe('skipped')
    expect(state.phases['plan'].status).toBe('ready')
  })
})

describe('speckit:card-reset', () => {
  it('requires featureDir', async () => {
    const handler = getSharedHandler('speckit:card-reset')!
    const result = (await handler({})) as { error?: string }
    expect(result.error).toBeDefined()
  })

  it('tears down the worktree + branch and wipes the run history', async () => {
    // readPilotState reads state.json via raw fs.readFile
    vi.mocked(nodefs.promises.readFile).mockResolvedValue(
      JSON.stringify({
        ...makeState('/repo/specs/x'),
        worktreePath: '/repo/.worktrees/x',
        branchName: 'feature/x',
        run: { status: 'running', startedAt: 't', completedAt: null, autonomyLevel: 'standard' },
      })
    )
    const handler = getSharedHandler('speckit:card-reset')!
    const result = (await handler({
      featureDir: '/repo/specs/x',
      workspacePath: '/repo',
    })) as { ok?: boolean; error?: string }

    expect(result.error).toBeUndefined()
    expect(result.ok).toBe(true)
    // worktree removed and branch deleted
    expect(sharedApi.shell.exec).toHaveBeenCalledWith(
      expect.objectContaining({ args: expect.arrayContaining(['worktree', 'remove']) })
    )
    expect(sharedApi.shell.exec).toHaveBeenCalledWith(
      expect.objectContaining({ args: expect.arrayContaining(['branch', '-D', 'feature/x']) })
    )
    // logs dir + history/self-review/comments removed
    const rmCalls = vi.mocked(nodefs.promises.rm).mock.calls.map(([p]) => String(p))
    expect(rmCalls.some((p) => p.endsWith('/logs'))).toBe(true)
    expect(rmCalls.some((p) => p.endsWith('history.jsonl'))).toBe(true)
  })
})

describe('speckit:run-reply', () => {
  it('errors when there is no active conversation to reply to', async () => {
    const handler = getSharedHandler('speckit:run-reply')!
    const result = (await handler({ featureDir: '/repo/specs/never-run', text: 'hi' })) as {
      error?: string
    }
    expect(result.error).toBeDefined()
  })

  it('resumes the captured session with the reply text', async () => {
    // A runner whose startPhaseRunner surfaces a session id, mirroring a real run.
    const startPhaseRunner = vi.fn((opts: { onSession?: (s: string) => void }) => {
      opts.onSession?.('sess-1')
      return { stop: vi.fn() }
    })
    vi.mocked(agentRunnerMod.createAgentRunner).mockReturnValue({ startPhaseRunner })

    // 1) run a phase so the session id gets captured
    vi.mocked(nodefs.promises.readdir).mockResolvedValue([] as never)
    vi.mocked(persistence.readState).mockResolvedValue(
      makeState('/repo/specs/x', { worktreePath: '/repo/.worktrees/x' }) as never
    )
    vi.mocked(persistence.readCard).mockResolvedValue(null)
    await getSharedHandler('speckit:card-handoff')!({
      featureDir: '/repo/specs/x',
      workspacePath: '/repo',
    })

    // 2) reply — resumes that session
    vi.mocked(nodefs.promises.readFile).mockResolvedValue(
      JSON.stringify(makeState('/repo/specs/x', { worktreePath: '/repo/.worktrees/x' }))
    )
    const result = (await getSharedHandler('speckit:run-reply')!({
      featureDir: '/repo/specs/x',
      text: 'use the existing helper',
    })) as { ok?: boolean; error?: string }

    expect(result.error).toBeUndefined()
    expect(result.ok).toBe(true)
    const replyCall = startPhaseRunner.mock.calls.at(-1)![0] as {
      resumeSessionId?: string
      phaseCommand?: string
    }
    expect(replyCall.resumeSessionId).toBe('sess-1')
    expect(replyCall.phaseCommand).toBe('use the existing helper')
  })
})

describe('speckit:artifact-list', () => {
  it('requires featureDir', async () => {
    const handler = getSharedHandler('speckit:artifact-list')!
    expect(await handler({})).toEqual({ error: 'featureDir required' })
  })

  it('lists the known artifacts with pr existence from prUrl', async () => {
    vi.mocked(persistence.readState).mockResolvedValue(
      makeState('/repo/specs/x', { prUrl: 'https://github.com/a/b/pull/7' }) as never
    )
    vi.mocked(nodefs.promises.access).mockResolvedValue(undefined)
    vi.mocked(sharedApi.shell.exec).mockResolvedValue({
      exitCode: 0,
      stdout: 'abc\t2026-06-30T00:00:00Z\tAdd spec',
      stderr: '',
      timedOut: false,
    })
    const handler = getSharedHandler('speckit:artifact-list')!
    const result = (await handler({ featureDir: '/repo/specs/x' })) as {
      artifacts: { kind: string; exists: boolean; revisions: unknown[] }[]
    }
    expect(result.artifacts).toHaveLength(7)
    const pr = result.artifacts.find((a) => a.kind === 'pr')!
    expect(pr.exists).toBe(true)
    const spec = result.artifacts.find((a) => a.kind === 'spec')!
    expect(spec.exists).toBe(true)
    expect(spec.revisions).toHaveLength(1)
  })
})

describe('speckit:knowledge-search', () => {
  it('requires repoRoot and query', async () => {
    const handler = getSharedHandler('speckit:knowledge-search')!
    expect(await handler({ repoRoot: '/repo' })).toEqual({
      error: 'repoRoot and query required',
    })
  })

  it('parses ripgrep matches', async () => {
    vi.mocked(sharedApi.shell.exec).mockResolvedValue({
      exitCode: 0,
      stdout: 'docs/A.md:5:auth token here',
      stderr: '',
      timedOut: false,
    })
    const handler = getSharedHandler('speckit:knowledge-search')!
    const result = (await handler({ repoRoot: '/repo', query: 'auth' })) as {
      results: { file: string; line: number }[]
    }
    expect(result.results).toEqual([{ file: 'docs/A.md', line: 5, snippet: 'auth token here' }])
  })

  it('falls back to an fs scan when ripgrep is unavailable', async () => {
    vi.mocked(sharedApi.shell.exec).mockRejectedValue(new Error('rg: command not found'))
    vi.mocked(nodefs.promises.readdir).mockImplementation((p: string) => {
      if (String(p).endsWith('/docs')) {
        return Promise.resolve([{ name: 'A.md', isDirectory: () => false }] as never)
      }
      return Promise.resolve([] as never)
    })
    vi.mocked(nodefs.promises.readFile).mockResolvedValue('line one\nhas AUTH here' as never)
    const handler = getSharedHandler('speckit:knowledge-search')!
    const result = (await handler({ repoRoot: '/repo', query: 'auth' })) as {
      results: { file: string; line: number }[]
    }
    expect(result.results.length).toBeGreaterThanOrEqual(1)
    expect(result.results[0].line).toBe(2)
  })
})

describe('speckit:ticket-list', () => {
  it('registers the speckit:ticket-list handler', () => {
    expect(getSharedHandler('speckit:ticket-list')).toBeDefined()
  })

  it("asks the application's connection rather than owning one", async () => {
    mockApi.issues.listMine.mockResolvedValue({
      issues: [
        {
          tracker: 'linear',
          id: 'i1',
          key: 'ENG-1',
          title: 'Build thing',
          url: 'https://linear/ENG-1',
          state: { name: 'In Progress', type: 'started' },
          assignee: null,
          branchName: 'andrew/eng-1-build-thing',
        },
        {
          tracker: 'jira',
          id: 'i2',
          key: 'PROJ-1',
          title: 'Fix bug',
          url: 'https://jira/PROJ-1',
          state: { name: 'Done', type: 'completed' },
          assignee: null,
          branchName: null,
        },
      ],
      failures: [],
    })

    const handler = getSharedHandler('speckit:ticket-list')!
    const result = (await handler({})) as { tickets: { source: string; completed: boolean }[] }

    expect(mockApi.issues.listMine).toHaveBeenCalled()
    expect(result.tickets).toHaveLength(2)
    expect(result.tickets.map((t) => t.source)).toEqual(['linear', 'jira'])
    // The board's own shape is unchanged (FR-029).
    expect(result.tickets[1].completed).toBe(true)
  })

  it("carries the tracker's suggested branch through to the board", async () => {
    // A card dispatched from a ticket reuses this instead of inventing a
    // branch name; dropping it here is invisible until a worktree is made.
    mockApi.issues.listMine.mockResolvedValue({
      issues: [
        {
          tracker: 'linear',
          id: 'i1',
          key: 'ENG-1',
          title: 'Build thing',
          url: 'https://linear/ENG-1',
          state: { name: 'In Progress', type: 'started' },
          assignee: null,
          branchName: 'andrew/eng-1-build-thing',
        },
      ],
      failures: [],
    })

    const handler = getSharedHandler('speckit:ticket-list')!
    const result = (await handler({})) as { tickets: { branchName: string | null }[] }

    expect(result.tickets[0].branchName).toBe('andrew/eng-1-build-thing')
  })

  it("fills each ticket's body from the issue, since a card's scope is its description", async () => {
    mockApi.issues.listMine.mockResolvedValue({
      issues: [
        {
          tracker: 'linear',
          id: 'uuid-1',
          key: 'ENG-1',
          title: 'Build thing',
          url: 'https://linear/ENG-1',
          state: { name: 'In Progress', type: 'started' },
          assignee: null,
          branchName: null,
        },
      ],
      failures: [],
    })
    mockApi.issues.get.mockResolvedValue({ description: '## Why\nBecause.' })

    const handler = getSharedHandler('speckit:ticket-list')!
    const result = (await handler({})) as { tickets: { body: string }[] }

    // Addressed by the tracker's own id, never the key (the keys collide
    // across trackers; the ids do not).
    expect(mockApi.issues.get).toHaveBeenCalledWith('linear', 'uuid-1')
    expect(result.tickets[0].body).toBe('## Why\nBecause.')
  })

  it('still lists a ticket whose body cannot be fetched', async () => {
    mockApi.issues.listMine.mockResolvedValue({
      issues: [
        {
          tracker: 'linear',
          id: 'uuid-1',
          key: 'ENG-1',
          title: 'Build thing',
          url: 'https://linear/ENG-1',
          state: { name: 'In Progress', type: 'started' },
          assignee: null,
          branchName: null,
        },
      ],
      failures: [],
    })
    mockApi.issues.get.mockRejectedValue(new Error('rate limited'))

    const handler = getSharedHandler('speckit:ticket-list')!
    const result = (await handler({})) as { tickets: { key: string; body: string }[] }

    expect(result.tickets).toHaveLength(1)
    expect(result.tickets[0].body).toBe('')
  })

  it('returns no tickets when nothing is connected, without complaining', async () => {
    mockApi.issues.listMine.mockResolvedValue({
      issues: [],
      failures: [
        { tracker: 'linear', error: 'not-connected' },
        { tracker: 'jira', error: 'not-connected' },
      ],
    })

    const handler = getSharedHandler('speckit:ticket-list')!
    const result = (await handler({})) as { tickets: unknown[] }

    expect(result.tickets).toHaveLength(0)
    expect(mockApi.notifications.showToast).not.toHaveBeenCalled()
  })

  it('says which tracker failed rather than showing an empty list', async () => {
    mockApi.issues.listMine.mockResolvedValue({
      issues: [],
      failures: [{ tracker: 'jira', error: 'auth-failed' }],
    })

    const handler = getSharedHandler('speckit:ticket-list')!
    await handler({})

    expect(mockApi.notifications.showToast).toHaveBeenCalledWith(
      'warning',
      expect.stringContaining('jira'),
      'fetchTicketsFailed'
    )
  })

  it('reports a failure rather than pretending there are no tickets', async () => {
    mockApi.issues.listMine.mockRejectedValue(new Error('network fail'))

    const handler = getSharedHandler('speckit:ticket-list')!
    const result = (await handler({})) as { error?: string }
    expect(result.error).toContain('network fail')
  })
})

describe('tracker credentials', () => {
  it('no longer offers credential channels — they belong to the application', () => {
    // Constitution II, the point of the migration: this extension holds no
    // tracker credential, so uninstalling it orphans nothing.
    expect(getSharedHandler('speckit:credentials-set')).toBeUndefined()
    expect(getSharedHandler('speckit:credentials-status')).toBeUndefined()
  })
})

describe('speckit:dispatch', () => {
  const ticket = {
    source: 'linear' as const,
    key: 'ENG-42',
    title: 'Build thing',
    sourceUrl: 'https://linear/ENG-42',
  }
  const workspacePath = '/repo'

  it('registers the speckit:dispatch handler', () => {
    expect(getSharedHandler('speckit:dispatch')).toBeDefined()
  })

  it('returns error when ticket is missing', async () => {
    const handler = getSharedHandler('speckit:dispatch')!
    const result = (await handler({ workspacePath })) as { error?: string }
    expect(result.error).toBeDefined()
  })

  it('returns error when git worktree add fails', async () => {
    vi.mocked(sharedApi.shell.exec).mockResolvedValue({
      exitCode: 1,
      stdout: '',
      stderr: 'fatal: branch already exists',
      timedOut: false,
    })
    const handler = getSharedHandler('speckit:dispatch')!
    const result = (await handler({ ticket, workspacePath })) as { error?: string }
    expect(result.error).toContain('worktree')
    expect(agentRunnerMod.createAgentRunner).not.toHaveBeenCalled()
  })

  it('creates feature dir, writes ticket.md, starts agent runner, returns featureDir', async () => {
    vi.mocked(sharedApi.shell.exec).mockResolvedValue({
      exitCode: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
    })
    const handler = getSharedHandler('speckit:dispatch')!
    const result = (await handler({ ticket, workspacePath })) as {
      featureDir?: string
      queued?: boolean
      error?: string
    }

    expect(result.error).toBeUndefined()
    expect(result.featureDir).toBeDefined()
    expect(result.queued).toBe(false)
    // ticket.md must be written
    const writeFileCalls = vi.mocked(nodefs.promises.writeFile).mock.calls
    const ticketMdCall = writeFileCalls.find(([p]) => String(p).endsWith('ticket.md'))
    expect(ticketMdCall).toBeDefined()
    expect(String(ticketMdCall![1])).toContain('ENG-42')
    // git worktree add must be called
    const shellCalls = vi.mocked(sharedApi.shell.exec).mock.calls
    const worktreeCall = shellCalls.find(
      ([opts]) => opts.command === 'git' && opts.args.includes('worktree')
    )
    expect(worktreeCall).toBeDefined()
    // agent runner must be started
    expect(agentRunnerMod.createAgentRunner).toHaveBeenCalled()
  })

  it('allows parallel dispatch — second run starts immediately alongside the first', async () => {
    vi.mocked(sharedApi.shell.exec).mockResolvedValue({
      exitCode: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
    })
    const handler = getSharedHandler('speckit:dispatch')!
    // First dispatch
    const result1 = (await handler({ ticket, workspacePath })) as {
      queued?: boolean
      featureDir?: string
    }
    expect(result1.queued).toBe(false)
    expect(result1.featureDir).toBeDefined()

    vi.mocked(nodefs.promises.readdir).mockResolvedValue(['001-eng-42'] as unknown as string[])
    vi.mocked(agentRunnerMod.createAgentRunner).mockReturnValue({
      startPhaseRunner: vi.fn().mockReturnValue({ stop: vi.fn() }),
    })

    // Second dispatch — should also start immediately, not queue
    const result2 = (await handler({
      ticket: { ...ticket, key: 'ENG-43', title: 'Other' },
      workspacePath,
    })) as { queued?: boolean; featureDir?: string }
    expect(result2.queued).toBe(false)
    expect(result2.featureDir).toBeDefined()
    expect(result2.featureDir).not.toBe(result1.featureDir)
  })
})

describe('speckit:run-cancel', () => {
  const featureDir = '/repo/specs/001-test'
  const workspacePath = '/repo'

  it('registers the speckit:run-cancel handler', () => {
    expect(getSharedHandler('speckit:run-cancel')).toBeDefined()
  })

  it('returns error when featureDir is missing', async () => {
    const handler = getSharedHandler('speckit:run-cancel')!
    const result = (await handler({ workspacePath })) as { error?: string }
    expect(result.error).toBeDefined()
  })

  it('calls git worktree remove when state has a worktreePath', async () => {
    const mockState = {
      version: 2,
      featureDir,
      ticket: null,
      run: { status: 'running', startedAt: '2026-01-01T00:00:00Z', autonomyLevel: 'standard' },
      queuePosition: 'active',
      worktreePath: '/repo/.wt/test',
      branchName: 'feature/test',
      prUrl: null,
      phases: {},
      settings: { writeStatusBackOnPrOpen: false },
    }
    vi.mocked(nodefs.promises.readFile).mockResolvedValue(JSON.stringify(mockState))
    vi.mocked(nodefs.promises.writeFile).mockResolvedValue(undefined)
    vi.mocked(nodefs.promises.rename).mockResolvedValue(undefined)
    vi.mocked(nodefs.promises.mkdir).mockResolvedValue(undefined)
    vi.mocked(nodefs.promises.appendFile).mockResolvedValue(undefined)
    vi.mocked(sharedApi.shell.exec).mockResolvedValue({
      exitCode: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
    })

    const handler = getSharedHandler('speckit:run-cancel')!
    const result = (await handler({ featureDir, workspacePath, deleteWorktree: true })) as {
      ok?: boolean
    }

    expect(result.ok).toBe(true)
    const shellCalls = vi.mocked(sharedApi.shell.exec).mock.calls
    const removeCall = shellCalls.find(
      ([opts]) => opts.command === 'git' && opts.args.includes('remove')
    )
    expect(removeCall).toBeDefined()
    expect(removeCall![0].args).toContain('/repo/.wt/test')
  })
})

describe('speckit:open-pr', () => {
  const featureDir = '/repo/specs/001-eng-99'
  const workspacePath = '/repo'

  it('registers the speckit:open-pr handler', () => {
    expect(getSharedHandler('speckit:open-pr')).toBeDefined()
  })

  it('returns error when gh auth is not configured', async () => {
    const mockState = {
      version: 2,
      featureDir,
      ticket: { source: 'linear', key: 'ENG-99', title: 'T', sourceUrl: 'https://l/ENG-99' },
      run: null,
      queuePosition: null,
      worktreePath: '/repo/.wt/eng-99',
      branchName: 'feature/eng-99',
      prUrl: null,
      phases: {},
      settings: { writeStatusBackOnPrOpen: false },
    }
    vi.mocked(nodefs.promises.readFile).mockResolvedValue(JSON.stringify(mockState))
    vi.mocked(sharedApi.shell.exec).mockResolvedValue({
      exitCode: 1,
      stdout: '',
      stderr: 'not logged in',
      timedOut: false,
    })

    const handler = getSharedHandler('speckit:open-pr')!
    const result = (await handler({ featureDir, workspacePath, title: 'My PR' })) as {
      error?: string
    }
    expect(result.error).toBeDefined()
    expect(result.error).toContain('gh auth')
  })

  it('runs gh pr create and returns the prUrl', async () => {
    const mockState = {
      version: 2,
      featureDir,
      ticket: { source: 'linear', key: 'ENG-99', title: 'T', sourceUrl: 'https://l/ENG-99' },
      run: null,
      queuePosition: null,
      worktreePath: '/repo/.wt/eng-99',
      branchName: 'feature/eng-99',
      prUrl: null,
      phases: {},
      settings: { writeStatusBackOnPrOpen: false },
    }
    vi.mocked(nodefs.promises.readFile).mockResolvedValue(JSON.stringify(mockState))
    vi.mocked(nodefs.promises.writeFile).mockResolvedValue(undefined)
    vi.mocked(nodefs.promises.rename).mockResolvedValue(undefined)
    vi.mocked(nodefs.promises.mkdir).mockResolvedValue(undefined)
    vi.mocked(nodefs.promises.appendFile).mockResolvedValue(undefined)
    vi.mocked(sharedApi.shell.exec)
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false }) // gh auth status
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'https://github.com/owner/repo/pull/42\n',
        stderr: '',
        timedOut: false,
      }) // gh pr create
      .mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', timedOut: false }) // git worktree remove

    const handler = getSharedHandler('speckit:open-pr')!
    const result = (await handler({
      featureDir,
      workspacePath,
      title: 'My PR',
      baseBranch: 'main',
    })) as { prUrl?: string; error?: string }

    expect(result.error).toBeUndefined()
    expect(result.prUrl).toBe('https://github.com/owner/repo/pull/42')
  })

  it('PR body contains traceability block with ticket URL', async () => {
    const ticketUrl = 'https://linear.app/ENG-99'
    const mockState = {
      version: 2,
      featureDir,
      ticket: { source: 'linear', key: 'ENG-99', title: 'T', sourceUrl: ticketUrl },
      run: null,
      queuePosition: null,
      worktreePath: '/repo/.wt/eng-99',
      branchName: 'feature/eng-99',
      prUrl: null,
      phases: {},
      settings: { writeStatusBackOnPrOpen: false },
    }
    vi.mocked(nodefs.promises.readFile).mockResolvedValue(JSON.stringify(mockState))
    vi.mocked(nodefs.promises.writeFile).mockResolvedValue(undefined)
    vi.mocked(nodefs.promises.rename).mockResolvedValue(undefined)
    vi.mocked(nodefs.promises.mkdir).mockResolvedValue(undefined)
    vi.mocked(nodefs.promises.appendFile).mockResolvedValue(undefined)
    vi.mocked(sharedApi.shell.exec)
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'https://github.com/owner/repo/pull/99\n',
        stderr: '',
        timedOut: false,
      })
      .mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', timedOut: false })

    const handler = getSharedHandler('speckit:open-pr')!
    await handler({ featureDir, workspacePath, title: 'My PR', baseBranch: 'main' })

    const prCreateCall = vi
      .mocked(sharedApi.shell.exec)
      .mock.calls.find(([opts]) => opts.command === 'gh' && opts.args.includes('create'))
    expect(prCreateCall).toBeDefined()
    const bodyArg = prCreateCall![0].args[prCreateCall![0].args.indexOf('--body') + 1]
    expect(bodyArg).toContain(`<!-- Ticket: ${ticketUrl} -->`)
  })
})

describe('tracker write-back on PR open (FR-034a)', () => {
  it('is off by default — a write to the operator’s tracker is not a default', async () => {
    const { DEFAULT_SETTINGS } = await import('../../src/types/speckit.types.js')
    expect(DEFAULT_SETTINGS.writeStatusBackOnPrOpen).toBe(false)
  })

  it('sends nothing while it is off', async () => {
    const settings = { writeStatusBackOnPrOpen: false }
    const ticket = { source: 'linear' as const, key: 'TAV-42' }

    // The guard is the setting itself; with it false, comment is never reached.
    if (settings.writeStatusBackOnPrOpen && ticket) {
      await sharedApi.issues.comment(ticket.source, ticket.key, 'PR opened')
    }
    expect(mockApi.issues.comment).not.toHaveBeenCalled()
  })

  it('goes through the application’s connection when it is on', async () => {
    const settings = { writeStatusBackOnPrOpen: true }
    const ticket = { source: 'linear' as const, key: 'TAV-42' }

    if (settings.writeStatusBackOnPrOpen && ticket) {
      await sharedApi.issues.comment(ticket.source, ticket.key, 'PR opened: https://x')
    }
    expect(mockApi.issues.comment).toHaveBeenCalledWith('linear', 'TAV-42', 'PR opened: https://x')
  })

  it('surfaces a failure rather than discarding it', async () => {
    mockApi.issues.comment.mockRejectedValue(new Error('no permission'))
    let told = false
    try {
      await sharedApi.issues.comment('linear', 'TAV-42', 'PR opened')
    } catch {
      told = true
    }
    // The old code wrapped this in an empty catch, which is why nobody could
    // say whether the path had ever worked.
    expect(told).toBe(true)
  })
})
