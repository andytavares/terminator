import { z } from 'zod'
import { namedStore } from '../storage-directory.js'
import { randomUUID } from 'crypto'
import { AgentScopeSchema, AGENT_REQUESTS, type AgentRun } from '../schemas/review-agent.schema.js'
import type { PrHead } from '../schemas/pr-review.schema.js'
import { ensureReviewWorktree } from '../review/worktree.js'
import { runAgentReview } from '../review/review-agent.js'
import {
  defineChannel,
  noPayload,
  type ChannelSpec,
  type Disposable,
} from '@terminator/extension-sdk'
import { RepoRoot } from './repo-root.js'
import { VALIDATION_ERROR, errorEnvelope, type RegisterFn } from './register.js'

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
  /** repoRoot:::prNumber:::scopeJson -> the run currently going for that (pr, scope) */
  runningByScope: Map<string, AgentRun>
  /** runId -> its cancel, for a run this process started */
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

const SETTING = 'terminator.git-integration.review'

const store = () => namedStore<AgentRun[]>('pr-agent-reviews')

function storeKey(head: PrHead): string {
  return `${head.repoRoot}:::${head.prNumber}:::${head.headSHA}`
}

type RunStore = Awaited<ReturnType<typeof store>>

function runsIn(runStore: RunStore, head: PrHead): AgentRun[] {
  return (runStore.get(storeKey(head)) as AgentRun[] | undefined) ?? []
}

async function loadRuns(head: PrHead): Promise<AgentRun[]> {
  return runsIn(await store(), head)
}

// Reads and writes in one turn once the store is open, so two upserts never lose one.
async function upsertRun(head: PrHead, run: AgentRun): Promise<void> {
  const runStore = await store()
  const runs = runsIn(runStore, head)
  const idx = runs.findIndex((r) => r.id === run.id)
  if (idx >= 0) runs[idx] = run
  else runs.unshift(run)
  runStore.set(storeKey(head), runs)
}

async function findStoredRun(runId: string): Promise<(PrHead & { run: AgentRun }) | null> {
  const all = (await store()).store as Record<string, AgentRun[]>
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
  // 'default' (or a value saved before it existed, '') leaves --effort off so claude's own config wins.
  const effort = effortSetting === 'default' ? undefined : effortSetting || undefined
  const timeoutMinutes = deps.getSetting<number>(`${SETTING}.agentTimeoutMinutes`) ?? 5
  return { model: model || configuredModel(deps), effort, timeoutMs: timeoutMinutes * 60_000 }
}

function newRun(input: StartInput, sessionId: string): AgentRun {
  return {
    id: randomUUID(),
    ...headOf(input),
    sessionId,
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
async function finishRun(ctx: AgentContext, slot: RunSlot, finished: AgentRun): Promise<void> {
  ctx.runningByScope.delete(slot.runningKey)
  ctx.liveRuns.delete(slot.run.id)
  await upsertRun(slot.head, finished)
  ctx.deps.broadcast('review-agent:event', { run: finished })
}

/** Runs the agent in the PR head's worktree; any failure ends the run as failed. */
async function executeRun(ctx: AgentContext, input: StartInput, slot: RunSlot) {
  const { run } = slot
  try {
    const worktreePath = await ctx.ensureWorktree(input)
    const { model, effort, timeoutMs } = runSettings(ctx.deps, input.model)
    const { model: _requested, ...review } = input
    const { cancel, done } = ctx.runReview({
      ...review,
      question: input.question ?? null,
      worktreePath,
      sessionId: run.sessionId,
      model,
      effort,
      timeoutMs,
    })
    ctx.liveRuns.set(run.id, cancel)
    await finishRun(ctx, slot, await done)
  } catch (e) {
    const finishedAt = new Date().toISOString()
    await finishRun(ctx, slot, { ...run, status: 'failed', finishedAt, error: String(e) })
  }
}

/** Starts a run for the PR and scope, or answers the one already running for them. */
async function startRun(ctx: AgentContext, input: StartInput): Promise<{ run: AgentRun }> {
  const runningKey = `${input.repoRoot}:::${input.prNumber}:::${JSON.stringify(input.scope)}`
  const existing = ctx.runningByScope.get(runningKey)
  if (existing && existing.status === 'running') return { run: existing }
  const run = newRun(input, randomUUID())
  ctx.runningByScope.set(runningKey, run)
  await upsertRun(input, run)
  void executeRun(ctx, input, { run, runningKey, head: headOf(input) })
  return { run }
}

async function dismissFinding(input: PrHead & { runId: string; findingId: string }) {
  const runStore = await store()
  const runs = runsIn(runStore, input)
  const run = runs.find((r) => r.id === input.runId)
  const finding = run?.findings.find((f) => f.id === input.findingId)
  if (!run || !finding) return { error: 'NOT_FOUND' }
  finding.dismissed = true
  runStore.set(storeKey(input), runs)
  return { ok: true }
}

/** Opens a terminal resuming the run's claude session, in its PR head's worktree. */
async function openRunTerminal(ctx: AgentContext, runId: string) {
  const found = await findStoredRun(runId)
  if (!found) return { error: 'NOT_FOUND' }
  const cwd = await ctx.ensureWorktree(found)
  ctx.deps.openTerminal({
    repoRoot: found.repoRoot,
    cwd,
    title: `Review #${found.prNumber}`,
    command: `claude --resume ${found.run.sessionId}`,
  })
  return { ok: true }
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
      run: (input) => startRun(ctx, input),
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
      run: ({ runId }) => openRunTerminal(ctx, runId),
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

/** Disposing the result cancels every run still going: its `claude` is this process's child, and
 *  a quitting extension host leaves its children running, so a run left alone outlives the app. */
export function registerReviewAgentHandlers(
  register: RegisterFn,
  deps: ReviewAgentDeps
): Disposable {
  const ctx: AgentContext = {
    deps,
    ensureWorktree: deps.ensureWorktree ?? ensureReviewWorktree,
    runReview: deps.runReview ?? runAgentReview,
    runningByScope: new Map(),
    liveRuns: new Map(),
  }
  for (const spec of [...runChannels(ctx), ...storedRunChannels(deps)]) register(spec)
  return { dispose: () => ctx.liveRuns.forEach((cancel) => cancel()) }
}
