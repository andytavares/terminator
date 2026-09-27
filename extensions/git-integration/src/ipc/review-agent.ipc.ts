import { z } from 'zod'
import Store from 'electron-store'
import { randomUUID } from 'crypto'
import { AgentScopeSchema, AGENT_REQUESTS, type AgentRun } from '../schemas/review-agent.schema.js'
import { ensureReviewWorktree } from '../review/worktree.js'
import { runAgentReview } from '../review/review-agent.js'

type RegisterFn = (
  channel: string,
  handler: (payload: unknown) => Promise<unknown> | unknown
) => void

export interface OpenTerminalInput {
  repoRoot: string
  cwd: string
  title: string
  command: string
}

export interface ReviewAgentDeps {
  getSetting: <T>(key: string) => T | undefined
  broadcast: (channel: string, data: unknown) => void
  openTerminal: (input: OpenTerminalInput) => void
  /** Injectable for tests; defaults to the real worktree/agent implementations. */
  ensureWorktree?: typeof ensureReviewWorktree
  runReview?: typeof runAgentReview
}

const store = new Store<Record<string, AgentRun[]>>({ name: 'pr-agent-reviews' })

function storeKey(repoRoot: string, prNumber: number, headSHA: string): string {
  return `${repoRoot}:::${prNumber}:::${headSHA}`
}

function loadRuns(repoRoot: string, prNumber: number, headSHA: string): AgentRun[] {
  return (store.get(storeKey(repoRoot, prNumber, headSHA)) as AgentRun[] | undefined) ?? []
}

function saveRuns(repoRoot: string, prNumber: number, headSHA: string, runs: AgentRun[]): void {
  store.set(storeKey(repoRoot, prNumber, headSHA), runs)
}

function upsertRun(repoRoot: string, prNumber: number, headSHA: string, run: AgentRun): void {
  const runs = loadRuns(repoRoot, prNumber, headSHA)
  const idx = runs.findIndex((r) => r.id === run.id)
  if (idx >= 0) runs[idx] = run
  else runs.unshift(run)
  saveRuns(repoRoot, prNumber, headSHA, runs)
}

function findStoredRun(
  runId: string
): { run: AgentRun; repoRoot: string; prNumber: number; headSHA: string } | null {
  const all = store.store as Record<string, AgentRun[]>
  for (const [key, runs] of Object.entries(all)) {
    const found = runs?.find((r) => r.id === runId)
    if (found) {
      const [repoRoot, prNumberStr, headSHA] = key.split(':::')
      return { run: found, repoRoot, prNumber: Number(prNumberStr), headSHA }
    }
  }
  return null
}

function scopeKey(scope: unknown): string {
  return JSON.stringify(scope)
}

export function registerReviewAgentHandlers(register: RegisterFn, deps: ReviewAgentDeps): void {
  const ensureWorktree = deps.ensureWorktree ?? ensureReviewWorktree
  const runReview = deps.runReview ?? runAgentReview

  // repoRoot:::prNumber:::scopeJson -> the currently running run for that (pr, scope)
  const runningByScope = new Map<string, AgentRun>()
  // runId -> live cancel + location, for cancel/open-terminal on a run this process started
  const liveRuns = new Map<
    string,
    { cancel: () => void; repoRoot: string; prNumber: number; headSHA: string }
  >()

  const startSchema = z.object({
    repoRoot: z.string().min(1),
    prNumber: z.number(),
    headSHA: z.string().min(1),
    baseRefName: z.string().min(1),
    title: z.string().optional().default(''),
    body: z.string().optional().default(''),
    scope: AgentScopeSchema,
    request: z.enum(AGENT_REQUESTS),
    question: z.string().nullable().optional(),
    /** Overrides the `agentModel` setting for this one run. */
    model: z.enum(['opus', 'sonnet']).optional(),
  })

  register('review-agent:start', async (payload) => {
    const parsed = startSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const input = parsed.data
    const runningKey = `${input.repoRoot}:::${input.prNumber}:::${scopeKey(input.scope)}`

    const existing = runningByScope.get(runningKey)
    if (existing && existing.status === 'running') {
      return { run: existing }
    }

    const sessionId = randomUUID()
    const model =
      input.model ||
      deps.getSetting<string>('terminator.git-integration.review.agentModel') ||
      'sonnet'
    const effort = deps.getSetting<string>('terminator.git-integration.review.agentEffort') || ''
    const timeoutMinutes =
      deps.getSetting<number>('terminator.git-integration.review.agentTimeoutMinutes') ?? 5

    const startedAt = new Date().toISOString()
    const run: AgentRun = {
      id: randomUUID(),
      repoRoot: input.repoRoot,
      prNumber: input.prNumber,
      headSHA: input.headSHA,
      sessionId,
      scope: input.scope,
      request: input.request,
      question: input.question ?? null,
      status: 'running',
      startedAt,
      finishedAt: null,
      activity: [],
      summary: null,
      findings: [],
      walkthrough: [],
      error: null,
    }

    runningByScope.set(runningKey, run)
    upsertRun(input.repoRoot, input.prNumber, input.headSHA, run)

    void (async () => {
      try {
        const worktreePath = await ensureWorktree(input.repoRoot, input.prNumber, input.headSHA)
        const { cancel, done } = runReview({
          repoRoot: input.repoRoot,
          worktreePath,
          prNumber: input.prNumber,
          headSHA: input.headSHA,
          baseRefName: input.baseRefName,
          title: input.title,
          body: input.body,
          scope: input.scope,
          request: input.request,
          question: input.question ?? null,
          sessionId,
          model,
          effort: effort || undefined,
          timeoutMs: timeoutMinutes * 60_000,
        })
        liveRuns.set(run.id, {
          cancel,
          repoRoot: input.repoRoot,
          prNumber: input.prNumber,
          headSHA: input.headSHA,
        })
        const finished = await done
        runningByScope.delete(runningKey)
        liveRuns.delete(run.id)
        upsertRun(input.repoRoot, input.prNumber, input.headSHA, finished)
        deps.broadcast('review-agent:event', { run: finished })
      } catch (e) {
        const failed: AgentRun = {
          ...run,
          status: 'failed',
          finishedAt: new Date().toISOString(),
          error: String(e),
        }
        runningByScope.delete(runningKey)
        liveRuns.delete(run.id)
        upsertRun(input.repoRoot, input.prNumber, input.headSHA, failed)
        deps.broadcast('review-agent:event', { run: failed })
      }
    })()

    return { run }
  })

  register('review-agent:settings', async () => {
    const model =
      deps.getSetting<string>('terminator.git-integration.review.agentModel') || 'sonnet'
    return { model }
  })

  register('review-agent:cancel', async (payload) => {
    const schema = z.object({ runId: z.string().min(1) })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const live = liveRuns.get(parsed.data.runId)
    if (!live) return { ok: false }
    live.cancel()
    return { ok: true }
  })

  register('review-agent:list', async (payload) => {
    const schema = z.object({
      repoRoot: z.string().min(1),
      prNumber: z.number(),
      headSHA: z.string().min(1),
    })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { repoRoot, prNumber, headSHA } = parsed.data
    return { runs: loadRuns(repoRoot, prNumber, headSHA) }
  })

  register('review-agent:dismiss', async (payload) => {
    const schema = z.object({
      repoRoot: z.string().min(1),
      prNumber: z.number(),
      headSHA: z.string().min(1),
      runId: z.string().min(1),
      findingId: z.string().min(1),
    })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { repoRoot, prNumber, headSHA, runId, findingId } = parsed.data
    const runs = loadRuns(repoRoot, prNumber, headSHA)
    const run = runs.find((r) => r.id === runId)
    const finding = run?.findings.find((f) => f.id === findingId)
    if (!run || !finding) return { error: 'NOT_FOUND' }
    finding.dismissed = true
    saveRuns(repoRoot, prNumber, headSHA, runs)
    return { ok: true }
  })

  register('review-agent:open-terminal', async (payload) => {
    const schema = z.object({ runId: z.string().min(1) })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const found = findStoredRun(parsed.data.runId)
    if (!found) return { error: 'NOT_FOUND' }
    try {
      const cwd = await ensureWorktree(found.repoRoot, found.prNumber, found.headSHA)
      deps.openTerminal({
        repoRoot: found.repoRoot,
        cwd,
        title: `Review #${found.prNumber}`,
        command: `claude --resume ${found.run.sessionId}`,
      })
      return { ok: true }
    } catch (e) {
      return { error: String(e) }
    }
  })
}
