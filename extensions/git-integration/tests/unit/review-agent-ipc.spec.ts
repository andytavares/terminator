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

import { dispatchChannel } from '@terminator/extension-sdk'
import { registerReviewAgentHandlers, type ReviewAgentDeps } from '../../src/ipc/review-agent.ipc'
import { bindWorkspaceRoots } from '../../src/ipc/repo-root'
import type { AgentRun } from '../../src/schemas/review-agent.schema'

type Handler = (payload: unknown) => Promise<unknown>

function captureHandlers(deps: Partial<ReviewAgentDeps>) {
  const handlers: Record<string, Handler> = {}
  const broadcast = vi.fn()
  const openTerminal = vi.fn()
  const settings: Record<string, unknown> = {}
  const fullDeps: ReviewAgentDeps = {
    getSetting: <T>(key: string) => settings[key] as T | undefined,
    broadcast,
    openTerminal,
    ...deps,
  }
  bindWorkspaceRoots(() => ['/repo'])
  registerReviewAgentHandlers((spec) => {
    handlers[spec.channel] = (payload) => dispatchChannel(spec, payload)
  }, fullDeps)
  return { handlers, broadcast, openTerminal, settings }
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
    const runReview = vi.fn(() => ({ runId: 'run-done', done: donePromise, cancel }))
    const ensureWorktree = vi.fn(async () => '/wt')

    const { handlers, broadcast } = captureHandlers({ ensureWorktree, runReview })

    const result = (await handlers['review-agent:start'](
      startPayload({ title: 't', body: 'b' })
    )) as { run: AgentRun }

    expect(result.run.status).toBe('running')
    expect(broadcast).not.toHaveBeenCalled()

    resolveDone(makeDoneRun({ id: result.run.id }))

    // The run finishes in the background and stores itself before it broadcasts.
    await vi.waitFor(() =>
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
    const runReview = vi.fn(() => ({ runId: 'x', done: donePromise, cancel: vi.fn() }))
    const ensureWorktree = vi.fn(async () => '/wt')
    const { handlers } = captureHandlers({ ensureWorktree, runReview })

    const first = (await handlers['review-agent:start'](startPayload())) as { run: AgentRun }

    const second = (await handlers['review-agent:start'](startPayload())) as { run: AgentRun }

    expect(second.run.id).toBe(first.run.id)
    expect(runReview).toHaveBeenCalledTimes(1)
    resolveDone(makeDoneRun({ id: first.run.id }))
  })
})

describe('review-agent IPC — uses the model override when given, else the setting, else sonnet', () => {
  it('uses the model override when given, else the setting, else sonnet', async () => {
    const runReview = vi.fn(() => ({
      runId: 'x',
      done: Promise.resolve(makeDoneRun()),
      cancel: vi.fn(),
    }))
    const ensureWorktree = vi.fn(async () => '/wt')
    const { handlers, settings } = captureHandlers({ ensureWorktree, runReview })

    await handlers['review-agent:start'](startPayload())
    await vi.waitFor(() => expect(runReview).toHaveBeenCalledTimes(1))
    expect(runReview.mock.calls[0][0].model).toBe('sonnet')

    settings['terminator.git-integration.review.agentModel'] = 'opus'
    await handlers['review-agent:start'](startPayload({ prNumber: 2, headSHA: 'sha2' }))
    await vi.waitFor(() => expect(runReview).toHaveBeenCalledTimes(2))
    expect(runReview.mock.calls[1][0].model).toBe('opus')

    await handlers['review-agent:start'](
      startPayload({ prNumber: 3, headSHA: 'sha3', model: 'sonnet' })
    )
    await vi.waitFor(() => expect(runReview).toHaveBeenCalledTimes(3))
    expect(runReview.mock.calls[2][0].model).toBe('sonnet')
  })
})

describe('review-agent IPC — passes no effort for the Default choice or an unset one, else the chosen level', () => {
  it('passes no effort for the Default choice or an unset one, else the chosen level', async () => {
    const runReview = vi.fn(() => ({
      runId: 'x',
      done: Promise.resolve(makeDoneRun()),
      cancel: vi.fn(),
    }))
    const ensureWorktree = vi.fn(async () => '/wt')
    const { handlers, settings } = captureHandlers({ ensureWorktree, runReview })
    const start = (prNumber: number) =>
      handlers['review-agent:start'](startPayload({ prNumber, headSHA: `sha${prNumber}` }))

    for (const [i, value] of (['default', '', 'high'] as const).entries()) {
      settings['terminator.git-integration.review.agentEffort'] = value
      await start(i + 1)
      await vi.waitFor(() => expect(runReview).toHaveBeenCalledTimes(i + 1))
    }

    expect(runReview.mock.calls.map((c) => c[0].effort)).toEqual([undefined, undefined, 'high'])
  })
})

describe('review-agent IPC — review-agent:settings returns the configured default model', () => {
  it('review-agent:settings returns the configured default model', async () => {
    const { handlers, settings } = captureHandlers({})
    expect(await handlers['review-agent:settings']({})).toEqual({ model: 'sonnet' })
    settings['terminator.git-integration.review.agentModel'] = 'opus'
    expect(await handlers['review-agent:settings']({})).toEqual({ model: 'opus' })
  })
})

describe('review-agent IPC — review-agent:cancel cancels a live run', () => {
  it('review-agent:cancel cancels a live run', async () => {
    const cancel = vi.fn()
    const donePromise = new Promise<AgentRun>(() => {})
    const runReview = vi.fn(() => ({ runId: 'x', done: donePromise, cancel }))
    const ensureWorktree = vi.fn(async () => '/wt')
    const { handlers } = captureHandlers({ ensureWorktree, runReview })

    const started = (await handlers['review-agent:start'](startPayload())) as { run: AgentRun }
    await vi.waitFor(() => expect(runReview).toHaveBeenCalled())

    const result = await handlers['review-agent:cancel']({ runId: started.run.id })
    expect(result).toEqual({ ok: true })
    expect(cancel).toHaveBeenCalled()
  })

  it('review-agent:cancel returns ok:false for an unknown run', async () => {
    const { handlers } = captureHandlers({})
    expect(await handlers['review-agent:cancel']({ runId: 'nope' })).toEqual({ ok: false })
  })
})

describe('review-agent IPC — review-agent:list returns persisted runs newest first', () => {
  it('review-agent:list returns persisted runs newest first', async () => {
    const { handlers } = captureHandlers({})
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
    const { handlers } = captureHandlers({})
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
    const { handlers } = captureHandlers({})
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

describe('review-agent IPC — review-agent:open-terminal opens claude --resume <sessionId> in the run worktree', () => {
  it('review-agent:open-terminal opens `claude --resume <sessionId>` in the run worktree', async () => {
    const ensureWorktree = vi.fn(async () => '/wt/pr-1-sha1')
    const { handlers, openTerminal } = captureHandlers({ ensureWorktree })
    storeState.data['/repo:::1:::sha1'] = [makeDoneRun({ id: 'run-1', sessionId: 'sess-123' })]

    const result = await handlers['review-agent:open-terminal']({ runId: 'run-1' })
    expect(result).toEqual({ ok: true })
    expect(openTerminal).toHaveBeenCalledWith({
      repoRoot: '/repo',
      cwd: '/wt/pr-1-sha1',
      title: 'Review #1',
      command: 'claude --resume sess-123',
    })
  })

  it('review-agent:open-terminal returns NOT_FOUND for an unknown run', async () => {
    const { handlers } = captureHandlers({})
    const result = await handlers['review-agent:open-terminal']({ runId: 'nope' })
    expect(result).toEqual({ error: 'NOT_FOUND' })
  })
})
