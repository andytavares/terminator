/**
 * Tests for Phase 4 IPC handlers: phase-request-changes, phase-comment.
 * These are the "human gate actions" handlers for US2.
 *
 * Strategy: same mock-API approach as index-ipc.spec.ts — import index.ts
 * so vi.mock() intercepts sub-modules before the bundle inlines them.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import type { ExtensionAPI } from '../../../../src/main/extensions/api.js'
import type { PilotState } from '../../src/types/speckit.types.js'

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn().mockReturnValue([]),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn().mockReturnValue(true),
    encryptString: vi.fn((s: string) => Buffer.from(s + '-enc')),
    decryptString: vi.fn((b: Buffer) => b.toString().replace('-enc', '')),
  },
  app: {
    getPath: vi.fn().mockReturnValue('/mock-user-data'),
  },
}))

vi.mock('node:fs', () => ({
  promises: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue([]),
    writeFile: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(''),
    appendFile: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue({ mtimeMs: Date.now() }),
    unlink: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('../../src/api/credentials.js', () => ({
  setLinearKey: vi.fn(),
  getLinearKey: vi.fn().mockResolvedValue(null),
  setJiraCredentials: vi.fn(),
  getJiraCredentials: vi.fn().mockResolvedValue(null),
}))

vi.mock('../../src/api/linear.js', () => ({
  fetchAssignedTickets: vi.fn().mockResolvedValue([]),
  postComment: vi.fn(),
}))

vi.mock('../../src/api/jira.js', () => ({
  fetchAssignedTickets: vi.fn().mockResolvedValue([]),
  postComment: vi.fn(),
  transitionStatus: vi.fn(),
}))

vi.mock('../../src/runner/agent-runner.js', () => ({
  createAgentRunner: vi.fn().mockReturnValue({
    startPhaseRunner: vi.fn().mockReturnValue({ stop: vi.fn() }),
  }),
}))

import * as nodefs from 'node:fs'
import * as agentRunnerMod from '../../src/runner/agent-runner.js'

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
      exec: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', timedOut: false }),
    },
    notifications: {
      showToast: vi.fn(),
      createNotification: vi.fn().mockReturnValue({ dispose: vi.fn() }),
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
    },
    terminal: {
      onSessionCreate: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onSessionClose: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    },
    app: { version: '0.0.0-test' },
  } as unknown as Partial<ExtensionAPI>

  return {
    api: api as ExtensionAPI,
    getHandler: (channel) => handlers.get(channel),
  }
}

let sharedApi: ExtensionAPI
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
  vi.mocked(nodefs.promises.mkdir).mockResolvedValue(undefined)
  vi.mocked(nodefs.promises.readdir).mockResolvedValue([])
  vi.mocked(nodefs.promises.writeFile).mockResolvedValue(undefined)
  vi.mocked(nodefs.promises.rename).mockResolvedValue(undefined)
  vi.mocked(nodefs.promises.readFile).mockResolvedValue('')
  vi.mocked(nodefs.promises.appendFile).mockResolvedValue(undefined)
  vi.mocked(agentRunnerMod.createAgentRunner).mockReturnValue({
    startPhaseRunner: vi.fn().mockReturnValue({ stop: vi.fn() }),
  })
})

const featureDir = '/repo/specs/001-eng-1'

function makeState(): PilotState {
  return {
    version: 2,
    featureDir,
    ticket: { source: 'linear', key: 'ENG-1', title: 'Test ticket', sourceUrl: 'https://l/ENG-1' },
    run: {
      status: 'running',
      startedAt: '2026-01-01T00:00:00Z',
      completedAt: null,
      autonomyLevel: 'standard',
    },
    queuePosition: 'active',
    worktreePath: '/repo/.wt/eng-1',
    branchName: 'feature/eng-1',
    prUrl: null,
    phases: {
      constitution: {
        id: 'constitution',
        status: 'approved',
        approvedHash: null,
        approvedAt: null,
        approvedBy: null,
        lastRunId: null,
        lastRunAt: null,
        artifactPaths: [],
        feedback: null,
        batchIndex: null,
      },
      specify: {
        id: 'specify',
        status: 'awaiting_review',
        approvedHash: null,
        approvedAt: null,
        approvedBy: null,
        lastRunId: null,
        lastRunAt: null,
        artifactPaths: [],
        feedback: null,
        batchIndex: null,
      },
      clarify: {
        id: 'clarify',
        status: 'locked',
        approvedHash: null,
        approvedAt: null,
        approvedBy: null,
        lastRunId: null,
        lastRunAt: null,
        artifactPaths: [],
        feedback: null,
        batchIndex: null,
      },
      plan: {
        id: 'plan',
        status: 'locked',
        approvedHash: null,
        approvedAt: null,
        approvedBy: null,
        lastRunId: null,
        lastRunAt: null,
        artifactPaths: [],
        feedback: null,
        batchIndex: null,
      },
      checklist: {
        id: 'checklist',
        status: 'locked',
        approvedHash: null,
        approvedAt: null,
        approvedBy: null,
        lastRunId: null,
        lastRunAt: null,
        artifactPaths: [],
        feedback: null,
        batchIndex: null,
      },
      tasks: {
        id: 'tasks',
        status: 'locked',
        approvedHash: null,
        approvedAt: null,
        approvedBy: null,
        lastRunId: null,
        lastRunAt: null,
        artifactPaths: [],
        feedback: null,
        batchIndex: null,
      },
      analyze: {
        id: 'analyze',
        status: 'locked',
        approvedHash: null,
        approvedAt: null,
        approvedBy: null,
        lastRunId: null,
        lastRunAt: null,
        artifactPaths: [],
        feedback: null,
        batchIndex: null,
      },
      implement: {
        id: 'implement',
        status: 'locked',
        approvedHash: null,
        approvedAt: null,
        approvedBy: null,
        lastRunId: null,
        lastRunAt: null,
        artifactPaths: [],
        feedback: null,
        batchIndex: null,
      },
      'self-review': {
        id: 'self-review',
        status: 'locked',
        approvedHash: null,
        approvedAt: null,
        approvedBy: null,
        lastRunId: null,
        lastRunAt: null,
        artifactPaths: [],
        feedback: null,
        batchIndex: null,
      },
      'open-pr': {
        id: 'open-pr',
        status: 'locked',
        approvedHash: null,
        approvedAt: null,
        approvedBy: null,
        lastRunId: null,
        lastRunAt: null,
        artifactPaths: [],
        feedback: null,
        batchIndex: null,
      },
    },
    settings: {
      defaultAutonomy: 'standard',
      batchCheckinsEnabled: false,
      writeStatusBackOnPrOpen: false,
      linear: null,
      jira: null,
      commandTimeoutMs: 300000,
      maxFilesPerImplementRun: 20,
      gates: {
        constitution: { autoApprove: false, enabled: true },
        specify: { autoApprove: false, enabled: true },
        clarify: { autoApprove: false, enabled: true },
        plan: { autoApprove: false, enabled: true },
        checklist: { autoApprove: false, enabled: true },
        tasks: { autoApprove: false, enabled: true },
        analyze: { autoApprove: false, enabled: true },
        implement: { autoApprove: false, enabled: true },
        'self-review': { autoApprove: false, enabled: true },
        'open-pr': { autoApprove: false, enabled: true },
      },
    },
  } as PilotState
}

describe('speckit:self-review-read', () => {
  it('registers the handler', () => {
    expect(getSharedHandler('speckit:self-review-read')).toBeDefined()
  })

  it('returns error when featureDir is missing', async () => {
    const handler = getSharedHandler('speckit:self-review-read')!
    const result = (await handler({})) as { error?: string }
    expect(result.error).toBeDefined()
  })

  it('returns parsed SelfReviewResult from .pilot/self-review.json', async () => {
    const mockResult = {
      format: { passed: true, output: 'ok' },
      lint: { passed: true, errorCount: 0, warningCount: 2, output: '2 warnings' },
      coverage: { passed: true, percentage: 92, output: '92% coverage' },
      googleReview: { passed: true, blockerCount: 0, output: 'no blockers' },
      summary: 'All checks passed',
    }
    vi.mocked(nodefs.promises.readFile).mockResolvedValue(JSON.stringify(mockResult))
    const handler = getSharedHandler('speckit:self-review-read')!
    const result = (await handler({ featureDir })) as { result?: typeof mockResult; error?: string }
    expect(result.error).toBeUndefined()
    expect(result.result?.coverage?.percentage).toBe(92)
  })

  it('returns error when self-review.json is missing', async () => {
    vi.mocked(nodefs.promises.readFile).mockRejectedValue(
      Object.assign(new Error('not found'), { code: 'ENOENT' })
    )
    const handler = getSharedHandler('speckit:self-review-read')!
    const result = (await handler({ featureDir })) as { error?: string; notFound?: boolean }
    expect(result.error !== undefined || result.notFound === true).toBe(true)
  })
})

describe('speckit:phase-request-changes', () => {
  it('registers the handler', () => {
    expect(getSharedHandler('speckit:phase-request-changes')).toBeDefined()
  })

  it('returns error when featureDir is missing', async () => {
    const handler = getSharedHandler('speckit:phase-request-changes')!
    const result = (await handler({ phase: 'specify', note: 'Fix it' })) as { error?: string }
    expect(result.error).toBeDefined()
  })

  it('stores feedback note in PhaseState.feedback', async () => {
    vi.mocked(nodefs.promises.readFile).mockResolvedValue(JSON.stringify(makeState()))
    const handler = getSharedHandler('speckit:phase-request-changes')!
    const result = (await handler({
      featureDir,
      phase: 'specify',
      note: 'Add acceptance criteria',
    })) as { state?: PilotState; error?: string }
    expect(result.error).toBeUndefined()
    expect(result.state?.phases['specify']?.feedback).toBe('Add acceptance criteria')
  })

  it('sets phase status to ready', async () => {
    vi.mocked(nodefs.promises.readFile).mockResolvedValue(JSON.stringify(makeState()))
    const handler = getSharedHandler('speckit:phase-request-changes')!
    const result = (await handler({ featureDir, phase: 'specify', note: 'needs work' })) as {
      state?: PilotState
    }
    expect(result.state?.phases['specify']?.status).toBe('ready')
  })

  it('appends request_changes history entry', async () => {
    vi.mocked(nodefs.promises.readFile).mockResolvedValue(JSON.stringify(makeState()))
    const handler = getSharedHandler('speckit:phase-request-changes')!
    await handler({ featureDir, phase: 'specify', note: 'needs work' })
    const appendCalls = vi.mocked(nodefs.promises.appendFile).mock.calls
    const historyCall = appendCalls.find(([p]) => String(p).endsWith('history.jsonl'))
    expect(historyCall).toBeDefined()
    expect(String(historyCall![1])).toContain('request_changes')
  })

  it('calls agentRunner.startPhaseRunner with feedbackNote', async () => {
    vi.mocked(nodefs.promises.readFile).mockResolvedValue(JSON.stringify(makeState()))
    const mockStartPhaseRunner = vi.fn().mockReturnValue({ stop: vi.fn() })
    vi.mocked(agentRunnerMod.createAgentRunner).mockReturnValue({
      startPhaseRunner: mockStartPhaseRunner,
    })
    const handler = getSharedHandler('speckit:phase-request-changes')!
    await handler({ featureDir, phase: 'specify', note: 'Add ACs' })
    expect(mockStartPhaseRunner).toHaveBeenCalledWith(
      expect.objectContaining({ feedbackNote: 'Add ACs', phase: 'specify' })
    )
  })

  it('broadcasts speckit:state-changed after update', async () => {
    vi.mocked(nodefs.promises.readFile).mockResolvedValue(JSON.stringify(makeState()))
    const handler = getSharedHandler('speckit:phase-request-changes')!
    await handler({ featureDir, phase: 'specify', note: 'please revise' })
    expect(sharedApi.window.broadcast).toHaveBeenCalledWith(
      'speckit:state-changed',
      expect.objectContaining({ state: expect.anything() })
    )
  })
})

describe('speckit:phase-comment', () => {
  it('registers the handler', () => {
    expect(getSharedHandler('speckit:phase-comment')).toBeDefined()
  })

  it('returns error when featureDir is missing', async () => {
    const handler = getSharedHandler('speckit:phase-comment')!
    const result = (await handler({ phase: 'specify', note: 'LGTM' })) as { error?: string }
    expect(result.error).toBeDefined()
  })

  it('appends comment entry to history with note text', async () => {
    vi.mocked(nodefs.promises.readFile).mockResolvedValue(JSON.stringify(makeState()))
    const handler = getSharedHandler('speckit:phase-comment')!
    await handler({ featureDir, phase: 'specify', note: 'Looks good to me' })
    const appendCalls = vi.mocked(nodefs.promises.appendFile).mock.calls
    const historyCall = appendCalls.find(([p]) => String(p).endsWith('history.jsonl'))
    expect(historyCall).toBeDefined()
    const entry = JSON.parse(String(historyCall![1]).trim())
    expect(entry.action).toBe('comment')
    expect(entry.note).toBe('Looks good to me')
  })

  it('does NOT trigger a re-run', async () => {
    vi.mocked(nodefs.promises.readFile).mockResolvedValue(JSON.stringify(makeState()))
    const mockStartPhaseRunner = vi.fn().mockReturnValue({ stop: vi.fn() })
    vi.mocked(agentRunnerMod.createAgentRunner).mockReturnValue({
      startPhaseRunner: mockStartPhaseRunner,
    })
    const handler = getSharedHandler('speckit:phase-comment')!
    await handler({ featureDir, phase: 'specify', note: 'Nice work' })
    expect(mockStartPhaseRunner).not.toHaveBeenCalled()
  })

  it('broadcasts updated state after comment', async () => {
    vi.mocked(nodefs.promises.readFile).mockResolvedValue(JSON.stringify(makeState()))
    const handler = getSharedHandler('speckit:phase-comment')!
    await handler({ featureDir, phase: 'specify', note: 'LGTM' })
    expect(sharedApi.window.broadcast).toHaveBeenCalledWith(
      'speckit:state-changed',
      expect.objectContaining({ state: expect.anything() })
    )
  })
})

// T059 — speckit:checkin-decision tests
describe('speckit:checkin-decision', () => {
  it('registers the handler', () => {
    expect(getSharedHandler('speckit:checkin-decision')).toBeDefined()
  })

  it('returns error when featureDir is missing', async () => {
    const handler = getSharedHandler('speckit:checkin-decision')!
    const result = (await handler({ decision: 'continue' })) as { error?: string }
    expect(result.error).toBeDefined()
  })

  it('continues runner on "continue" decision', async () => {
    vi.mocked(nodefs.promises.readFile).mockResolvedValue(JSON.stringify(makeState()))
    const mockStartPhaseRunner = vi.fn().mockReturnValue({ stop: vi.fn() })
    vi.mocked(agentRunnerMod.createAgentRunner).mockReturnValue({
      startPhaseRunner: mockStartPhaseRunner,
    })
    const handler = getSharedHandler('speckit:checkin-decision')!
    const result = (await handler({ featureDir, decision: 'continue', batchIndex: 0 })) as {
      ok?: boolean
      error?: string
    }
    expect(result.error).toBeUndefined()
    expect(result.ok).toBe(true)
    expect(mockStartPhaseRunner).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'implement', batchIndex: 1 })
    )
  })

  it('stops runner and persists batchIndex on "pause" decision', async () => {
    const state = makeState()
    vi.mocked(nodefs.promises.readFile).mockResolvedValue(JSON.stringify(state))
    const handler = getSharedHandler('speckit:checkin-decision')!
    const result = (await handler({ featureDir, decision: 'pause', batchIndex: 1 })) as {
      ok?: boolean
    }
    expect(result.ok).toBe(true)
    // batchIndex must be persisted — check writeFile was called
    const writeCalls = vi.mocked(nodefs.promises.writeFile).mock.calls
    const stateWrite = writeCalls.find(([p]) => String(p).endsWith('state.json.tmp'))
    expect(stateWrite).toBeDefined()
  })

  it('stops runner and creates follow-up queue entry on "split" decision', async () => {
    const state = makeState()
    vi.mocked(nodefs.promises.readFile).mockResolvedValue(JSON.stringify(state))
    const handler = getSharedHandler('speckit:checkin-decision')!
    const result = (await handler({ featureDir, decision: 'split', batchIndex: 1 })) as {
      ok?: boolean
    }
    expect(result.ok).toBe(true)
  })
})
