import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── hoisted fake electron-store, stateful across calls in one test ─────────

const { storeState } = vi.hoisted(() => ({ storeState: { data: {} as Record<string, unknown> } }))

vi.mock('electron-store', () => ({
  default: class {
    get(key: string) {
      return storeState.data[key]
    }
    set(key: string, value: unknown) {
      storeState.data[key] = value
    }
    delete(key: string) {
      delete storeState.data[key]
    }
    get store() {
      return storeState.data
    }
  },
}))

import { dispatchChannel, type AgentsAPI } from '@terminator/extension-sdk'
import { registerReviewAgentHandlers, type ReviewAgentDeps } from '../../src/ipc/review-agent.ipc'
import { bindWorkspaceRoots } from '../../src/ipc/repo-root'
import type { AgentRun } from '../../src/schemas/review-agent.schema'
import { eventually } from '../../../../tests/support/eventually'
import { partialFake } from '../../../../tests/support/fakes'

type RunReview = NonNullable<ReviewAgentDeps['runReview']>
type RunSummary = NonNullable<ReviewAgentDeps['runSummary']>

type Handler = (payload: unknown) => Promise<unknown>

function captureAgentHandlers(deps: Partial<ReviewAgentDeps>) {
  const handlers: Record<string, Handler> = {}
  const broadcast = vi.fn()
  const start = vi.fn<AgentsAPI['start']>(async () => ({
    sessionId: 'tab-1',
    agentId: 'claude',
    configOptions: [],
  }))
  const runOnce = vi.fn<AgentsAPI['runOnce']>()
  const agents = partialFake<ReviewAgentDeps['agents']>({ start, runOnce })
  const settings: Record<string, unknown> = {}
  const fullDeps: ReviewAgentDeps = {
    getSetting: <T>(key: string) => settings[key] as T | undefined,
    broadcast,
    agents,
    projectIdFor: (repoRoot) => (repoRoot === '/repo' ? 'project-1' : undefined),
    storagePath: '/storage/git-integration',
    ...deps,
  }
  bindWorkspaceRoots(() => ['/repo'])
  const registration = registerReviewAgentHandlers((spec) => {
    handlers[spec.channel] = (payload) => dispatchChannel(spec, payload)
  }, fullDeps)
  return { handlers, broadcast, start, runOnce, settings, registration }
}

const scope = {
  kind: 'file' as const,
  path: 'a.ts',
  startLine: null,
  endLine: null,
  side: null,
  chapter: null,
}

function makeDoneRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'run-done',
    repoRoot: '/repo',
    prNumber: 1,
    headSHA: 'sha1',
    sessionId: 'sess',
    scope,
    request: 'review',
    question: null,
    status: 'done',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    activity: [],
    summary: 'ok',
    findings: [],
    walkthrough: [],
    error: null,
    ...overrides,
  }
}

/** A start request for `scope` on PR 1 at sha1, overridden by `overrides`. */
function startPayload(overrides: Record<string, unknown> = {}) {
  return {
    repoRoot: '/repo',
    prNumber: 1,
    headSHA: 'sha1',
    baseRefName: 'main',
    scope,
    request: 'review',
    ...overrides,
  }
}

/** A run whose completion the test decides. */
function deferredRun() {
  let resolveDone: (r: AgentRun) => void = () => {}
  const done = new Promise<AgentRun>((r) => {
    resolveDone = r
  })
  return { done, resolveDone: (r: AgentRun) => resolveDone(r) }
}

/** An undismissed nit on line 1 of a.ts. */
function nitFinding(id: string): AgentRun['findings'][number] {
  return {
    id,
    severity: 'nit',
    path: 'a.ts',
    startLine: 1,
    endLine: 1,
    side: 'RIGHT',
    title: 't',
    body: 'b',
    suggestedCode: null,
    dismissed: false,
  }
}

beforeEach(() => {
  storeState.data = {}
})

describe('review-agent IPC', () => {
  it('review-agent:start returns a running run immediately, then broadcasts on finish', async () => {
    const { done: donePromise, resolveDone } = deferredRun()
    const cancel = vi.fn()
    const runReview = vi.fn<RunReview>(() => ({ runId: 'run-done', done: donePromise, cancel }))
    const ensureWorktree = vi.fn(async () => '/wt')

    const { handlers, broadcast } = captureAgentHandlers({ ensureWorktree, runReview })

    const result = (await handlers['review-agent:start'](
      startPayload({ title: 't', body: 'b' })
    )) as { run: AgentRun }

    expect(result.run.status).toBe('running')
    expect(broadcast).not.toHaveBeenCalled()

    resolveDone(makeDoneRun({ id: result.run.id }))

    // The run finishes in the background and stores itself before it broadcasts.
    await eventually(() =>
      expect(broadcast).toHaveBeenCalledWith(
        'review-agent:event',
        expect.objectContaining({ run: expect.objectContaining({ status: 'done' }) })
      )
    )
  })
})

describe('review-agent IPC — a second start with the same scope while running returns the same running run', () => {
  it('a second start with the same scope while running returns the same running run', async () => {
    const { done: donePromise, resolveDone } = deferredRun()
    const runReview = vi.fn<RunReview>(() => ({ runId: 'x', done: donePromise, cancel: vi.fn() }))
    const ensureWorktree = vi.fn(async () => '/wt')
    const { handlers } = captureAgentHandlers({ ensureWorktree, runReview })

    const first = (await handlers['review-agent:start'](startPayload())) as { run: AgentRun }

    const second = (await handlers['review-agent:start'](startPayload())) as { run: AgentRun }

    expect(second.run.id).toBe(first.run.id)
    expect(runReview).toHaveBeenCalledTimes(1)
    resolveDone(makeDoneRun({ id: first.run.id }))
  })
})

describe('review-agent IPC — uses the model override when given, else the setting, else sonnet', () => {
  it('uses the model override when given, else the setting, else sonnet', async () => {
    const runReview = vi.fn<RunReview>(() => ({
      runId: 'x',
      done: Promise.resolve(makeDoneRun()),
      cancel: vi.fn(),
    }))
    const ensureWorktree = vi.fn(async () => '/wt')
    const { handlers, settings } = captureAgentHandlers({ ensureWorktree, runReview })

    await handlers['review-agent:start'](startPayload())
    await eventually(() => expect(runReview).toHaveBeenCalledTimes(1))
    expect(runReview.mock.calls[0][0].model).toBe('sonnet')

    settings['terminator.git-integration.review.agentModel'] = 'opus'
    await handlers['review-agent:start'](startPayload({ prNumber: 2, headSHA: 'sha2' }))
    await eventually(() => expect(runReview).toHaveBeenCalledTimes(2))
    expect(runReview.mock.calls[1][0].model).toBe('opus')

    await handlers['review-agent:start'](
      startPayload({ prNumber: 3, headSHA: 'sha3', model: 'sonnet' })
    )
    await eventually(() => expect(runReview).toHaveBeenCalledTimes(3))
    expect(runReview.mock.calls[2][0].model).toBe('sonnet')
  })
})

describe('review-agent IPC — passes no effort for the Default choice or an unset one, else the chosen level', () => {
  it('passes no effort for the Default choice or an unset one, else the chosen level', async () => {
    const runReview = vi.fn<RunReview>(() => ({
      runId: 'x',
      done: Promise.resolve(makeDoneRun()),
      cancel: vi.fn(),
    }))
    const ensureWorktree = vi.fn(async () => '/wt')
    const { handlers, settings } = captureAgentHandlers({ ensureWorktree, runReview })
    const start = (prNumber: number) =>
      handlers['review-agent:start'](startPayload({ prNumber, headSHA: `sha${prNumber}` }))

    for (const [i, value] of (['default', '', 'high'] as const).entries()) {
      settings['terminator.git-integration.review.agentEffort'] = value
      await start(i + 1)
      await eventually(() => expect(runReview).toHaveBeenCalledTimes(i + 1))
    }

    expect(runReview.mock.calls.map((c) => c[0].effort)).toEqual([undefined, undefined, 'high'])
  })
})

describe('review-agent IPC — stops a run after the configured timeout', () => {
  it('gives the agent the "Review agent timeout" in minutes, five when unset', async () => {
    const runReview = vi.fn<RunReview>(() => ({
      runId: 'x',
      done: Promise.resolve(makeDoneRun()),
      cancel: vi.fn(),
    }))
    const ensureWorktree = vi.fn(async () => '/wt')
    const { handlers, settings } = captureAgentHandlers({ ensureWorktree, runReview })

    await handlers['review-agent:start'](startPayload())
    await eventually(() => expect(runReview).toHaveBeenCalledTimes(1))
    settings['terminator.git-integration.review.agentTimeoutMinutes'] = 12
    await handlers['review-agent:start'](startPayload({ prNumber: 2, headSHA: 'sha2' }))
    await eventually(() => expect(runReview).toHaveBeenCalledTimes(2))

    expect(runReview.mock.calls.map((c) => c[0].timeoutMs)).toEqual([5 * 60_000, 12 * 60_000])
  })
})

describe('review-agent IPC — review-agent:settings returns the configured default model', () => {
  it('review-agent:settings returns the configured default model', async () => {
    const { handlers, settings } = captureAgentHandlers({})
    expect(await handlers['review-agent:settings']({})).toEqual({ model: 'sonnet' })
    settings['terminator.git-integration.review.agentModel'] = 'opus'
    expect(await handlers['review-agent:settings']({})).toEqual({ model: 'opus' })
  })
})

describe('review-agent IPC — review-agent:cancel cancels a live run', () => {
  it('review-agent:cancel cancels a live run', async () => {
    const cancel = vi.fn()
    const donePromise = new Promise<AgentRun>(() => {})
    const runReview = vi.fn<RunReview>(() => ({ runId: 'x', done: donePromise, cancel }))
    const ensureWorktree = vi.fn(async () => '/wt')
    const { handlers } = captureAgentHandlers({ ensureWorktree, runReview })

    const started = (await handlers['review-agent:start'](startPayload())) as { run: AgentRun }
    await eventually(() => expect(runReview).toHaveBeenCalled())

    const result = await handlers['review-agent:cancel']({ runId: started.run.id })
    expect(result).toEqual({ ok: true })
    expect(cancel).toHaveBeenCalled()
  })

  it('disposing the handlers cancels every live run, so no agent outlives the extension', async () => {
    const cancel = vi.fn()
    const runReview = vi.fn(() => ({ runId: 'x', done: new Promise<AgentRun>(() => {}), cancel }))
    const ensureWorktree = vi.fn(async () => '/wt')
    const { handlers, registration } = captureAgentHandlers({ ensureWorktree, runReview })
    await handlers['review-agent:start'](startPayload())
    await eventually(() => expect(runReview).toHaveBeenCalled())

    registration.dispose()

    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('review-agent:cancel returns ok:false for an unknown run', async () => {
    const { handlers } = captureAgentHandlers({})
    expect(await handlers['review-agent:cancel']({ runId: 'nope' })).toEqual({ ok: false })
  })
})

describe('review-agent IPC — review-agent:list returns persisted runs newest first', () => {
  it('review-agent:list returns persisted runs newest first', async () => {
    const { handlers } = captureAgentHandlers({})
    storeState.data['/repo:::1:::sha1'] = [
      makeDoneRun({ id: 'older' }),
      makeDoneRun({ id: 'newer' }),
    ]
    const result = (await handlers['review-agent:list']({
      repoRoot: '/repo',
      prNumber: 1,
      headSHA: 'sha1',
    })) as { runs: AgentRun[] }
    expect(result.runs.map((r) => r.id)).toEqual(['older', 'newer'])
  })
})

describe('review-agent IPC — review-agent:dismiss marks a finding dismissed and persists it', () => {
  it('review-agent:dismiss marks a finding dismissed and persists it', async () => {
    const { handlers } = captureAgentHandlers({})
    const run = makeDoneRun({
      id: 'run-1',
      findings: [nitFinding('f1')],
    })
    storeState.data['/repo:::1:::sha1'] = [run]

    const result = await handlers['review-agent:dismiss']({
      repoRoot: '/repo',
      prNumber: 1,
      headSHA: 'sha1',
      runId: 'run-1',
      findingId: 'f1',
    })
    expect(result).toEqual({ ok: true })

    const persisted = storeState.data['/repo:::1:::sha1'] as AgentRun[]
    expect(persisted[0].findings[0].dismissed).toBe(true)
  })
})

describe('review-agent IPC — review-agent:dismiss returns NOT_FOUND for an unknown finding', () => {
  it('review-agent:dismiss returns NOT_FOUND for an unknown finding', async () => {
    const { handlers } = captureAgentHandlers({})
    storeState.data['/repo:::1:::sha1'] = [makeDoneRun({ id: 'run-1' })]
    const result = await handlers['review-agent:dismiss']({
      repoRoot: '/repo',
      prNumber: 1,
      headSHA: 'sha1',
      runId: 'run-1',
      findingId: 'missing',
    })
    expect(result).toEqual({ error: 'NOT_FOUND' })
  })
})

describe('review-agent IPC — review-agent:open-terminal opens the run conversation in an agent tab', () => {
  it('resumes the stored session in the run worktree, as a tab of the repo project', async () => {
    const ensureWorktree = vi.fn(async () => '/wt/pr-1-sha1')
    const { handlers, start } = captureAgentHandlers({ ensureWorktree })
    storeState.data['/repo:::1:::sha1'] = [makeDoneRun({ id: 'run-1', sessionId: 'sess-123' })]

    const result = await handlers['review-agent:open-terminal']({ runId: 'run-1' })
    expect(result).toEqual({ ok: true })
    expect(start).toHaveBeenCalledWith({
      cwd: '/wt/pr-1-sha1',
      resume: 'sess-123',
      tab: { projectId: 'project-1', title: 'Review #1' },
    })
  })

  it('returns NOT_FOUND for an unknown run', async () => {
    const { handlers, start } = captureAgentHandlers({})
    const result = await handlers['review-agent:open-terminal']({ runId: 'nope' })
    expect(result).toEqual({ error: 'NOT_FOUND' })
    expect(start).not.toHaveBeenCalled()
  })
})

describe('review-agent IPC — review-agent:open-terminal refuses a run it cannot open', () => {
  it('returns NO_SESSION for a run that has no conversation yet', async () => {
    const { handlers, start } = captureAgentHandlers({})
    storeState.data['/repo:::1:::sha1'] = [makeDoneRun({ id: 'run-1', sessionId: '' })]
    expect(await handlers['review-agent:open-terminal']({ runId: 'run-1' })).toEqual({
      error: 'NO_SESSION',
    })
    expect(start).not.toHaveBeenCalled()
  })

  it('returns NO_PROJECT when no project holds the repo', async () => {
    const { handlers, start } = captureAgentHandlers({ ensureWorktree: async () => '/wt' })
    storeState.data['/other:::1:::sha1'] = [
      makeDoneRun({ id: 'run-2', repoRoot: '/other', sessionId: 'sess-9' }),
    ]
    expect(await handlers['review-agent:open-terminal']({ runId: 'run-2' })).toEqual({
      error: 'NO_PROJECT',
    })
    expect(start).not.toHaveBeenCalled()
  })

  it('returns AGENT_UNAVAILABLE when the agent does not start', async () => {
    const { handlers, start } = captureAgentHandlers({ ensureWorktree: async () => '/wt' })
    start.mockResolvedValueOnce(null)
    storeState.data['/repo:::1:::sha1'] = [makeDoneRun({ id: 'run-1', sessionId: 'sess-123' })]
    expect(await handlers['review-agent:open-terminal']({ runId: 'run-1' })).toEqual({
      error: 'AGENT_UNAVAILABLE',
    })
  })
})

describe('review-agent IPC — runs ask the core agent service', () => {
  it('hands the review run the service runOnce and starts it without a session id', async () => {
    const runReview = vi.fn<RunReview>(() => ({
      runId: 'x',
      done: new Promise(() => {}),
      cancel() {},
    }))
    const { handlers, runOnce } = captureAgentHandlers({
      runReview,
      ensureWorktree: async () => '/wt',
    })
    await handlers['review-agent:start'](startPayload())
    await eventually(() => expect(runReview).toHaveBeenCalled())
    const [input, deps] = runReview.mock.calls[0]
    expect(input).not.toHaveProperty('sessionId')
    expect(deps?.runOnce).toBeTypeOf('function')
    await deps?.runOnce({ cwd: '/wt', prompt: 'p' })
    expect(runOnce).toHaveBeenCalledWith({ cwd: '/wt', prompt: 'p' })
  })
})

/** A summarize request for PR 1's description, overridden by `overrides`. */
function summarizePayload(overrides: Record<string, unknown> = {}) {
  return { repoRoot: '/repo', prNumber: 1, kind: 'description', text: 'Adds X', ...overrides }
}

describe('review-agent IPC — review-agent:summarize', () => {
  it('rejects whitespace-only text without starting claude', async () => {
    const runSummary = vi.fn<RunSummary>()
    const { handlers } = captureAgentHandlers({ runSummary })
    const result = await handlers['review-agent:summarize'](summarizePayload({ text: '  \n ' }))
    expect(result).toEqual({ error: 'VALIDATION_ERROR' })
    expect(runSummary).not.toHaveBeenCalled()
  })

  it('runs the summary in the storage folder with the configured model and timeout', async () => {
    const runSummary = vi.fn<RunSummary>(() => ({
      done: Promise.resolve({ summary: 'Adds X.' }),
      cancel: vi.fn(),
    }))
    const { handlers, settings } = captureAgentHandlers({ runSummary })
    settings['terminator.git-integration.review.agentModel'] = 'opus'
    settings['terminator.git-integration.review.agentTimeoutMinutes'] = 12

    const result = await handlers['review-agent:summarize'](summarizePayload())

    expect(result).toEqual({ summary: 'Adds X.' })
    expect(runSummary.mock.calls[0][0]).toMatchObject({
      prNumber: 1,
      kind: 'description',
      text: 'Adds X',
      cwd: '/storage/git-integration',
      model: 'opus',
      timeoutMs: 12 * 60_000,
    })
  })
})

describe('review-agent IPC — review-agent:summarize ends with the extension', () => {
  it('disposing the handlers kills a summary still running', async () => {
    const cancel = vi.fn()
    let end: (result: { error: string }) => void = () => undefined
    const done = new Promise<{ error: string }>((resolve) => (end = resolve))
    const runSummary = vi.fn<RunSummary>(() => ({ done, cancel }))
    const { handlers, registration } = captureAgentHandlers({ runSummary })
    const summarizing = handlers['review-agent:summarize'](summarizePayload())
    await eventually(() => expect(runSummary).toHaveBeenCalled())

    registration.dispose()

    expect(cancel).toHaveBeenCalledTimes(1)
    end({ error: 'cancelled' })
    await summarizing
  })

  it('forgets a finished summary, so disposing cancels nothing', async () => {
    const cancel = vi.fn()
    const runSummary = vi.fn<RunSummary>(() => ({
      done: Promise.resolve({ error: 'Timed out after 5 min' }),
      cancel,
    }))
    const { handlers, registration } = captureAgentHandlers({ runSummary })
    expect(await handlers['review-agent:summarize'](summarizePayload())).toEqual({
      error: 'Timed out after 5 min',
    })

    registration.dispose()

    expect(cancel).not.toHaveBeenCalled()
  })
})
