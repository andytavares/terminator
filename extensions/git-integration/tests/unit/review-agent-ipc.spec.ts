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

import { registerReviewAgentHandlers, type ReviewAgentDeps } from '../../src/ipc/review-agent.ipc'
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
  registerReviewAgentHandlers((channel, handler) => {
    handlers[channel] = handler as Handler
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

beforeEach(() => {
  storeState.data = {}
})

describe('review-agent IPC', () => {
  it('review-agent:start returns a running run immediately, then broadcasts on finish', async () => {
    let resolveDone: (r: AgentRun) => void = () => {}
    const donePromise = new Promise<AgentRun>((r) => {
      resolveDone = r
    })
    const cancel = vi.fn()
    const runReview = vi.fn(() => ({ runId: 'run-done', done: donePromise, cancel }))
    const ensureWorktree = vi.fn(async () => '/wt')

    const { handlers, broadcast } = captureHandlers({ ensureWorktree, runReview })

    const result = (await handlers['review-agent:start']({
      repoRoot: '/repo',
      prNumber: 1,
      headSHA: 'sha1',
      baseRefName: 'main',
      title: 't',
      body: 'b',
      scope,
      request: 'review',
    })) as { run: AgentRun }

    expect(result.run.status).toBe('running')
    expect(broadcast).not.toHaveBeenCalled()

    resolveDone(makeDoneRun({ id: result.run.id }))
    await new Promise((r) => setTimeout(r, 10))

    expect(broadcast).toHaveBeenCalledWith(
      'review-agent:event',
      expect.objectContaining({ run: expect.objectContaining({ status: 'done' }) })
    )
  })

  it('a second start with the same scope while running returns the same running run', async () => {
    let resolveDone: (r: AgentRun) => void = () => {}
    const donePromise = new Promise<AgentRun>((r) => {
      resolveDone = r
    })
    const runReview = vi.fn(() => ({ runId: 'x', done: donePromise, cancel: vi.fn() }))
    const ensureWorktree = vi.fn(async () => '/wt')
    const { handlers } = captureHandlers({ ensureWorktree, runReview })

    const first = (await handlers['review-agent:start']({
      repoRoot: '/repo',
      prNumber: 1,
      headSHA: 'sha1',
      baseRefName: 'main',
      scope,
      request: 'review',
    })) as { run: AgentRun }

    const second = (await handlers['review-agent:start']({
      repoRoot: '/repo',
      prNumber: 1,
      headSHA: 'sha1',
      baseRefName: 'main',
      scope,
      request: 'review',
    })) as { run: AgentRun }

    expect(second.run.id).toBe(first.run.id)
    expect(runReview).toHaveBeenCalledTimes(1)
    resolveDone(makeDoneRun({ id: first.run.id }))
  })

  it('uses the model override when given, else the setting, else sonnet', async () => {
    const runReview = vi.fn(() => ({
      runId: 'x',
      done: Promise.resolve(makeDoneRun()),
      cancel: vi.fn(),
    }))
    const ensureWorktree = vi.fn(async () => '/wt')
    const { handlers, settings } = captureHandlers({ ensureWorktree, runReview })

    await handlers['review-agent:start']({
      repoRoot: '/repo',
      prNumber: 1,
      headSHA: 'sha1',
      baseRefName: 'main',
      scope,
      request: 'review',
    })
    await new Promise((r) => setTimeout(r, 5))
    expect(runReview.mock.calls[0][0].model).toBe('sonnet')

    settings['terminator.git-integration.review.agentModel'] = 'opus'
    await handlers['review-agent:start']({
      repoRoot: '/repo',
      prNumber: 2,
      headSHA: 'sha2',
      baseRefName: 'main',
      scope,
      request: 'review',
    })
    await new Promise((r) => setTimeout(r, 5))
    expect(runReview.mock.calls[1][0].model).toBe('opus')

    await handlers['review-agent:start']({
      repoRoot: '/repo',
      prNumber: 3,
      headSHA: 'sha3',
      baseRefName: 'main',
      scope,
      request: 'review',
      model: 'sonnet',
    })
    await new Promise((r) => setTimeout(r, 5))
    expect(runReview.mock.calls[2][0].model).toBe('sonnet')
  })

  it('passes no effort for the Default choice or an unset one, else the chosen level', async () => {
    const runReview = vi.fn(() => ({
      runId: 'x',
      done: Promise.resolve(makeDoneRun()),
      cancel: vi.fn(),
    }))
    const ensureWorktree = vi.fn(async () => '/wt')
    const { handlers, settings } = captureHandlers({ ensureWorktree, runReview })
    const start = (prNumber: number) =>
      handlers['review-agent:start']({
        repoRoot: '/repo',
        prNumber,
        headSHA: `sha${prNumber}`,
        baseRefName: 'main',
        scope,
        request: 'review',
      })

    for (const [i, value] of (['default', '', 'high'] as const).entries()) {
      settings['terminator.git-integration.review.agentEffort'] = value
      await start(i + 1)
      await new Promise((r) => setTimeout(r, 5))
    }

    expect(runReview.mock.calls.map((c) => c[0].effort)).toEqual([undefined, undefined, 'high'])
  })

  it('review-agent:settings returns the configured default model', async () => {
    const { handlers, settings } = captureHandlers({})
    expect(await handlers['review-agent:settings']({})).toEqual({ model: 'sonnet' })
    settings['terminator.git-integration.review.agentModel'] = 'opus'
    expect(await handlers['review-agent:settings']({})).toEqual({ model: 'opus' })
  })

  it('review-agent:cancel cancels a live run', async () => {
    const cancel = vi.fn()
    const donePromise = new Promise<AgentRun>(() => {})
    const runReview = vi.fn(() => ({ runId: 'x', done: donePromise, cancel }))
    const ensureWorktree = vi.fn(async () => '/wt')
    const { handlers } = captureHandlers({ ensureWorktree, runReview })

    const started = (await handlers['review-agent:start']({
      repoRoot: '/repo',
      prNumber: 1,
      headSHA: 'sha1',
      baseRefName: 'main',
      scope,
      request: 'review',
    })) as { run: AgentRun }
    await new Promise((r) => setTimeout(r, 10))

    const result = await handlers['review-agent:cancel']({ runId: started.run.id })
    expect(result).toEqual({ ok: true })
    expect(cancel).toHaveBeenCalled()
  })

  it('review-agent:cancel returns ok:false for an unknown run', async () => {
    const { handlers } = captureHandlers({})
    expect(await handlers['review-agent:cancel']({ runId: 'nope' })).toEqual({ ok: false })
  })

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

  it('review-agent:dismiss marks a finding dismissed and persists it', async () => {
    const { handlers } = captureHandlers({})
    const run = makeDoneRun({
      id: 'run-1',
      findings: [
        {
          id: 'f1',
          severity: 'nit',
          path: 'a.ts',
          startLine: 1,
          endLine: 1,
          side: 'RIGHT',
          title: 't',
          body: 'b',
          suggestedCode: null,
          dismissed: false,
        },
      ],
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
