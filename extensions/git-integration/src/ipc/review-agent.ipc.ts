import { z } from 'zod'
import { namedStore } from '../storage-directory.js'
import { randomUUID } from 'crypto'
import {
  AgentScopeSchema,
  AGENT_REQUESTS,
  SUMMARY_KINDS,
  type AgentRun,
  type SummaryResult,
} from '../schemas/review-agent.schema.js'
import type { PrHead } from '../schemas/pr-review.schema.js'
import { ensureReviewWorktree } from '../review/worktree.js'
import { runAgentReview, runSummary, type RunAgentReviewDeps } from '../review/review-agent.js'
import {
  defineChannel,
  noPayload,
  type ChannelSpec,
  type AgentsAPI,
  type Disposable,
} from '@terminator/extension-sdk'
import { RepoRoot } from './repo-root.js'
import { VALIDATION_ERROR, errorEnvelope, type RegisterFn } from './register.js'

export interface ReviewAgentDeps {
  getSetting: <T>(key: string) => T | undefined
  broadcast: (channel: string, data: unknown) => void
  /** The core's `api.agents`: reviews and summaries ask through `runOnce`, a run's conversation
   *  opens through `start`. */
  agents: Pick<AgentsAPI, 'runOnce' | 'start' | 'cancel'>
  /** The workspace project that holds the repo's checkout, or undefined. */
  projectIdFor: (repoRoot: string) => string | undefined
  /** The extension's own globalStorage folder, where a summary's agent runs: `repoRoot` can be a
   *  `gh:owner/name` with no folder, and a summary reads no checkout. */
  storagePath: string
  /** Injectable for tests; defaults to the real worktree/agent implementations. */
  ensureWorktree?: typeof ensureReviewWorktree
  runReview?: typeof runAgentReview
  runSummary?: typeof runSummary
}

/** The agent settings one run uses: model, optional effort, and how long it may take. */
interface RunSettings {
  model: string
  effort?: string
  timeoutMs: number
}

/** What the agent channels of one registration share. */
interface AgentContext {
  deps: ReviewAgentDeps
  ensureWorktree: typeof ensureReviewWorktree
  runReview: typeof runAgentReview
  runSummary: typeof runSummary
  /** repoRoot:::prNumber:::scopeJson -> the run currently going for that (pr, scope) */
  runningByScope: Map<string, AgentRun>
  /** runId -> its cancel, for a run or summary this process started */
  liveRuns: Map<string, () => void>
}

type StartInput = z.infer<typeof StartPayload>

/** A started run: its record, its (pr, scope) key, and the PR head it is stored under. */
interface RunSlot {
  run: AgentRun
  runningKey: string
  head: PrHead
}

const RunIdPayload = z.object({ runId: z.string().min(1) })

const RunsPayload = z.object({
  repoRoot: RepoRoot,
  prNumber: z.number(),
  headSHA: z.string().min(1),
})

const StartPayload = z.object({
  repoRoot: RepoRoot,
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

const SummarizePayload = z.object({
  repoRoot: RepoRoot,
  prNumber: z.number(),
  kind: z.enum(SUMMARY_KINDS),
  text: z.string().trim().min(1),
})

const SETTING = 'terminator.git-integration.review'

const agentRunStore = () => namedStore<AgentRun[]>('pr-agent-reviews')

function storeKey(head: PrHead): string {
  return `${head.repoRoot}:::${head.prNumber}:::${head.headSHA}`
}

type RunStore = Awaited<ReturnType<typeof agentRunStore>>

function runsIn(runStore: RunStore, head: PrHead): AgentRun[] {
  return (runStore.get(storeKey(head)) as AgentRun[] | undefined) ?? []
}

async function loadRuns(head: PrHead): Promise<AgentRun[]> {
  return runsIn(await agentRunStore(), head)
}

// Reads and writes in one turn once the store is open, so two upserts never lose one.
async function upsertRun(head: PrHead, run: AgentRun): Promise<void> {
  const runStore = await agentRunStore()
  const runs = runsIn(runStore, head)
  const idx = runs.findIndex((r) => r.id === run.id)
  if (idx >= 0) runs[idx] = run
  else runs.unshift(run)
  runStore.set(storeKey(head), runs)
}

async function findStoredRun(runId: string): Promise<(PrHead & { run: AgentRun }) | null> {
  const all = (await agentRunStore()).store as Record<string, AgentRun[]>
  for (const [key, runs] of Object.entries(all)) {
    const found = runs?.find((r) => r.id === runId)
    if (!found) continue
    const [repoRoot, prNumberStr, headSHA] = key.split(':::')
    return { run: found, repoRoot, prNumber: Number(prNumberStr), headSHA }
  }
  return null
}

function headOf(input: PrHead): PrHead {
  return { repoRoot: input.repoRoot, prNumber: input.prNumber, headSHA: input.headSHA }
}

function configuredModel(deps: ReviewAgentDeps): string {
  return deps.getSetting<string>(`${SETTING}.agentModel`) || 'sonnet'
}

/** The run's model (its own, else the setting), effort and timeout. */
function runSettings(deps: ReviewAgentDeps, model?: string): RunSettings {
  const effortSetting = deps.getSetting<string>(`${SETTING}.agentEffort`)
  // 'default' (or a value saved before it existed, '') leaves effort off so the agent's own config wins.
  const effort = effortSetting === 'default' ? undefined : effortSetting || undefined
  const timeoutMinutes = deps.getSetting<number>(`${SETTING}.agentTimeoutMinutes`) ?? 5
  return { model: model || configuredModel(deps), effort, timeoutMs: timeoutMinutes * 60_000 }
}

function newRun(input: StartInput): AgentRun {
  return {
    id: randomUUID(),
    ...headOf(input),
    sessionId: '',
    scope: input.scope,
    request: input.request,
    question: input.question ?? null,
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    activity: [],
    summary: null,
    findings: [],
    walkthrough: [],
    error: null,
  }
}

/** Stores the run's outcome under its PR head, forgets it as running, and tells the views. */
async function finishAgentRun(ctx: AgentContext, slot: RunSlot, finished: AgentRun): Promise<void> {
  ctx.runningByScope.delete(slot.runningKey)
  ctx.liveRuns.delete(slot.run.id)
  await upsertRun(slot.head, finished)
  ctx.deps.broadcast('review-agent:event', { run: finished })
}

/** `runOnce` bound to the service, which keeps state a bare method reference would lose. */
function agentDepsOf(ctx: AgentContext, slot?: RunSlot): RunAgentReviewDeps {
  return {
    runOnce: (input) => ctx.deps.agents.runOnce(input),
    cancelSession: (sessionId) => ctx.deps.agents.cancel(sessionId),
    // A running review's conversation opens in an agent tab before it replies.
    onSession: slot && ((sessionId) => void upsertRun(slot.head, { ...slot.run, sessionId })),
  }
}

/** Runs the agent in the PR head's worktree; any failure ends the run as failed. */
async function runAgentToEnd(ctx: AgentContext, input: StartInput, slot: RunSlot) {
  const { run } = slot
  try {
    const worktreePath = await ctx.ensureWorktree(input)
    const { model, effort, timeoutMs } = runSettings(ctx.deps, input.model)
    const { model: _requested, ...review } = input
    const { cancel, done } = ctx.runReview(
      { ...review, question: input.question ?? null, worktreePath, model, effort, timeoutMs },
      agentDepsOf(ctx, slot)
    )
    ctx.liveRuns.set(run.id, cancel)
    await finishAgentRun(ctx, slot, await done)
  } catch (e) {
    const finishedAt = new Date().toISOString()
    await finishAgentRun(ctx, slot, { ...run, status: 'failed', finishedAt, error: String(e) })
  }
}

/** Starts a run for the PR and scope, or answers the one already running for them. */
async function startAgentRun(ctx: AgentContext, input: StartInput): Promise<{ run: AgentRun }> {
  const runningKey = `${input.repoRoot}:::${input.prNumber}:::${JSON.stringify(input.scope)}`
  const existing = ctx.runningByScope.get(runningKey)
  if (existing && existing.status === 'running') return { run: existing }
  const run = newRun(input)
  ctx.runningByScope.set(runningKey, run)
  await upsertRun(input, run)
  void runAgentToEnd(ctx, input, { run, runningKey, head: headOf(input) })
  return { run }
}

async function dismissFinding(input: PrHead & { runId: string; findingId: string }) {
  const runStore = await agentRunStore()
  const runs = runsIn(runStore, input)
  const run = runs.find((r) => r.id === input.runId)
  const finding = run?.findings.find((f) => f.id === input.findingId)
  if (!run || !finding) return { error: 'NOT_FOUND' }
  finding.dismissed = true
  runStore.set(storeKey(input), runs)
  return { ok: true }
}

/** Opens the run's agent conversation in a tab of its repo's project, in its PR head's worktree. */
async function openRunConversation(ctx: AgentContext, runId: string) {
  const found = await findStoredRun(runId)
  if (!found) return { error: 'NOT_FOUND' }
  if (!found.run.sessionId) return { error: 'NO_SESSION' }
  const projectId = ctx.deps.projectIdFor(found.repoRoot)
  if (!projectId) return { error: 'NO_PROJECT' }
  const cwd = await ctx.ensureWorktree(found)
  const started = await ctx.deps.agents.start({
    cwd,
    resume: found.run.sessionId,
    tab: { projectId, title: `Review #${found.prNumber}` },
  })
  return started ? { ok: true } : { error: 'AGENT_UNAVAILABLE' }
}

/** Summarizes the text with the agent's settings; the summary is answered, never stored. */
async function summarize(
  ctx: AgentContext,
  input: z.infer<typeof SummarizePayload>
): Promise<SummaryResult> {
  const { model, effort, timeoutMs } = runSettings(ctx.deps)
  const { prNumber, kind, text } = input
  const cwd = ctx.deps.storagePath
  const { done, cancel } = ctx.runSummary(
    { prNumber, kind, text, cwd, model, effort, timeoutMs },
    agentDepsOf(ctx)
  )
  const id = randomUUID()
  ctx.liveRuns.set(id, cancel)
  try {
    return await done
  } finally {
    ctx.liveRuns.delete(id)
  }
}

function cancelRun(ctx: AgentContext, runId: string) {
  const cancel = ctx.liveRuns.get(runId)
  if (!cancel) return { ok: false }
  cancel()
  return { ok: true }
}

function runChannels(ctx: AgentContext): ChannelSpec[] {
  return [
    defineChannel({
      channel: 'review-agent:start',
      schema: StartPayload,
      invalid: VALIDATION_ERROR,
      run: (input) => startAgentRun(ctx, input),
    }),
    defineChannel({
      channel: 'review-agent:cancel',
      schema: RunIdPayload,
      invalid: VALIDATION_ERROR,
      run: ({ runId }) => cancelRun(ctx, runId),
    }),
    defineChannel({
      channel: 'review-agent:open-terminal',
      schema: RunIdPayload,
      invalid: VALIDATION_ERROR,
      run: ({ runId }) => openRunConversation(ctx, runId),
      onError: errorEnvelope,
    }),
    defineChannel({
      channel: 'review-agent:summarize',
      schema: SummarizePayload,
      invalid: VALIDATION_ERROR,
      run: (input) => summarize(ctx, input),
      onError: errorEnvelope,
    }),
  ]
}

function storedRunChannels(deps: ReviewAgentDeps): ChannelSpec[] {
  return [
    defineChannel({
      channel: 'review-agent:settings',
      schema: noPayload,
      invalid: VALIDATION_ERROR,
      run: () => ({ model: configuredModel(deps) }),
    }),
    defineChannel({
      channel: 'review-agent:list',
      schema: RunsPayload,
      invalid: VALIDATION_ERROR,
      run: async (head) => ({ runs: await loadRuns(head) }),
    }),
    defineChannel({
      channel: 'review-agent:dismiss',
      schema: RunsPayload.extend({ runId: z.string().min(1), findingId: z.string().min(1) }),
      invalid: VALIDATION_ERROR,
      run: dismissFinding,
    }),
  ]
}

/** Disposing the result cancels every run and summary still going, so none answers after the extension is gone. */
export function registerReviewAgentHandlers(
  register: RegisterFn,
  deps: ReviewAgentDeps
): Disposable {
  const ctx: AgentContext = {
    deps,
    ensureWorktree: deps.ensureWorktree ?? ensureReviewWorktree,
    runReview: deps.runReview ?? runAgentReview,
    runSummary: deps.runSummary ?? runSummary,
    runningByScope: new Map(),
    liveRuns: new Map(),
  }
  for (const spec of [...runChannels(ctx), ...storedRunChannels(deps)]) register(spec)
  return { dispose: () => ctx.liveRuns.forEach((cancel) => cancel()) }
}
