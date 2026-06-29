/**
 * Tests for new v2 IPC handlers: ticket-list, credentials-set/status,
 * dispatch, run-cancel, open-pr.
 *
 * Strategy: build a mock ExtensionAPI that captures handler registrations,
 * activate the extension once, then invoke each channel handler directly.
 */
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
  app: {
    getPath: vi.fn().mockReturnValue('/mock-user-data'),
  },
}))

// --- mock node:fs (dispatch/cancel/open-pr read/write state files directly) ---
vi.mock('node:fs', () => ({
  promises: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue([]),
    writeFile: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(''),
    appendFile: vi.fn().mockResolvedValue(undefined),
    copyFile: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue({ mtimeMs: Date.now() }),
    unlink: vi.fn().mockResolvedValue(undefined),
  },
}))

// --- mock credentials module ---
vi.mock('../../src/api/credentials.js', () => ({
  setLinearKey: vi.fn(),
  getLinearKey: vi.fn(),
  setJiraCredentials: vi.fn(),
  getJiraCredentials: vi.fn(),
}))

// --- mock Linear client ---
vi.mock('../../src/api/linear.js', () => ({
  fetchAssignedTickets: vi.fn(),
  postComment: vi.fn(),
}))

// --- mock Jira client ---
vi.mock('../../src/api/jira.js', () => ({
  fetchAssignedTickets: vi.fn(),
  postComment: vi.fn(),
  transitionStatus: vi.fn(),
}))

// --- mock agent runner ---
vi.mock('../../src/runner/agent-runner.js', () => ({
  createAgentRunner: vi.fn().mockReturnValue({
    startPhaseRunner: vi.fn().mockReturnValue({ stop: vi.fn() }),
  }),
}))

// --- mock state persistence ---
vi.mock('../../src/state/state-persistence.js', () => ({
  createInitialState: vi.fn().mockImplementation((featureDir: string) => ({
    version: 2,
    featureDir,
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
  appendHistory: vi.fn(),
  ensurePilotDir: vi.fn(),
}))

import * as credentials from '../../src/api/credentials.js'
import * as linear from '../../src/api/linear.js'
import * as jira from '../../src/api/jira.js'
import * as nodefs from 'node:fs'
import * as agentRunnerMod from '../../src/runner/agent-runner.js'

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
  vi.mocked(credentials.getLinearKey).mockResolvedValue(null)
  vi.mocked(credentials.getJiraCredentials).mockResolvedValue(null)
  vi.mocked(credentials.setLinearKey).mockResolvedValue(undefined)
  vi.mocked(credentials.setJiraCredentials).mockResolvedValue(undefined)
  vi.mocked(linear.fetchAssignedTickets).mockResolvedValue([])
  vi.mocked(jira.fetchAssignedTickets).mockResolvedValue([])
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
})

describe('speckit:ticket-list', () => {
  it('registers the speckit:ticket-list handler', () => {
    expect(getSharedHandler('speckit:ticket-list')).toBeDefined()
  })

  it('returns merged Linear and Jira tickets when both are configured', async () => {
    vi.mocked(credentials.getLinearKey).mockResolvedValue('lin-key')
    vi.mocked(credentials.getJiraCredentials).mockResolvedValue({
      domain: 'd.net',
      email: 'e@d.net',
      apiToken: 'tok',
      jql: '',
    })
    vi.mocked(linear.fetchAssignedTickets).mockResolvedValue([
      { source: 'linear', key: 'ENG-1', title: 'Build thing', sourceUrl: 'https://linear/ENG-1' },
    ])
    vi.mocked(jira.fetchAssignedTickets).mockResolvedValue([
      { source: 'jira', key: 'PROJ-1', title: 'Fix bug', sourceUrl: 'https://jira/PROJ-1' },
    ])

    const handler = getSharedHandler('speckit:ticket-list')!
    const result = (await handler({})) as { tickets: unknown[] }
    expect(result.tickets).toHaveLength(2)
  })

  it('fetches Linear and Jira in parallel (both called once)', async () => {
    vi.mocked(credentials.getLinearKey).mockResolvedValue('lin-key')
    vi.mocked(credentials.getJiraCredentials).mockResolvedValue({
      domain: 'd.net',
      email: 'e@d.net',
      apiToken: 'tok',
      jql: 'assignee = me',
    })

    const handler = getSharedHandler('speckit:ticket-list')!
    await handler({})

    expect(linear.fetchAssignedTickets).toHaveBeenCalledTimes(1)
    expect(jira.fetchAssignedTickets).toHaveBeenCalledTimes(1)
  })

  it('returns empty tickets when neither Linear nor Jira is configured', async () => {
    const handler = getSharedHandler('speckit:ticket-list')!
    const result = (await handler({})) as { tickets: unknown[] }
    expect(result.tickets).toHaveLength(0)
  })

  it('returns { tickets: [] } or { error } when Linear fetch fails', async () => {
    vi.mocked(credentials.getLinearKey).mockResolvedValue('lin-key')
    vi.mocked(linear.fetchAssignedTickets).mockRejectedValue(new Error('network fail'))

    const handler = getSharedHandler('speckit:ticket-list')!
    const result = (await handler({})) as { error?: string; tickets?: unknown[] }
    expect(result.tickets !== undefined || result.error !== undefined).toBe(true)
  })
})

describe('speckit:credentials-set', () => {
  it('registers the speckit:credentials-set handler', () => {
    expect(getSharedHandler('speckit:credentials-set')).toBeDefined()
  })

  it('delegates to setLinearKey when source is linear', async () => {
    const handler = getSharedHandler('speckit:credentials-set')!
    await handler({ source: 'linear', apiKey: 'my-linear-key' })
    expect(credentials.setLinearKey).toHaveBeenCalledWith('my-linear-key')
  })

  it('delegates to setJiraCredentials when source is jira', async () => {
    const handler = getSharedHandler('speckit:credentials-set')!
    const jiraCreds = { domain: 'c.net', email: 'a@c.net', apiToken: 'tok', jql: '' }
    await handler({ source: 'jira', ...jiraCreds })
    expect(credentials.setJiraCredentials).toHaveBeenCalledWith(jiraCreds)
  })

  it('returns { ok: true } on success', async () => {
    const handler = getSharedHandler('speckit:credentials-set')!
    const result = await handler({ source: 'linear', apiKey: 'key' })
    expect(result).toMatchObject({ ok: true })
  })

  it('returns { error } on failure', async () => {
    vi.mocked(credentials.setLinearKey).mockRejectedValue(new Error('disk full'))
    const handler = getSharedHandler('speckit:credentials-set')!
    const result = (await handler({ source: 'linear', apiKey: 'key' })) as { error?: string }
    expect(result.error).toBeDefined()
  })
})

describe('speckit:credentials-status', () => {
  it('registers the speckit:credentials-status handler', () => {
    expect(getSharedHandler('speckit:credentials-status')).toBeDefined()
  })

  it('returns { connected: true } when Linear key exists — never the actual key', async () => {
    vi.mocked(credentials.getLinearKey).mockResolvedValue('super-secret-key')
    const handler = getSharedHandler('speckit:credentials-status')!
    const result = (await handler({ source: 'linear' })) as Record<string, unknown>
    expect(result['connected']).toBe(true)
    // CRITICAL: must never contain the raw key
    expect(JSON.stringify(result)).not.toContain('super-secret-key')
  })

  it('returns { connected: false } when no Linear key stored', async () => {
    vi.mocked(credentials.getLinearKey).mockResolvedValue(null)
    const handler = getSharedHandler('speckit:credentials-status')!
    const result = (await handler({ source: 'linear' })) as { connected: boolean }
    expect(result.connected).toBe(false)
  })

  it('returns { connected: true } when Jira credentials exist — never the apiToken', async () => {
    vi.mocked(credentials.getJiraCredentials).mockResolvedValue({
      domain: 'co.net',
      email: 'a@co.net',
      apiToken: 'SECRET',
      jql: '',
    })
    const handler = getSharedHandler('speckit:credentials-status')!
    const result = (await handler({ source: 'jira' })) as Record<string, unknown>
    expect(result['connected']).toBe(true)
    // CRITICAL: apiToken must never appear in response
    expect(JSON.stringify(result)).not.toContain('SECRET')
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
