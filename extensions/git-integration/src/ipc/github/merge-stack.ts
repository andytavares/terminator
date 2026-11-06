import { defineChannel, type ChannelSpec } from '@terminator/extension-sdk'
import { VALIDATION_ERROR } from '../register.js'
import { catchError, PullRequestNumberPayload, type GithubContext } from './context.js'

/** An open pull request, as the stack walk reads it. @internal */
export interface StackPullRequest {
  number: number
  title: string
  headRefName: string
  baseRefName: string
  headRefOid: string
  /** From a fork: its branch names say nothing about this repository's branches. */
  isCrossRepository?: boolean
}

/** @internal */
export interface StackResult {
  merged: number[]
  failed?: { number: number; reason: string }
}

/** The waits of a stack merge; a spec replaces them so it does not wait. @internal */
export interface StackClock {
  sleep: (ms: number) => Promise<void>
  pollMs: number
  timeoutMs: number
}

const REAL_CLOCK: StackClock = {
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  pollMs: 3_000,
  timeoutMs: 60_000,
}

const STACK_FIELDS = [
  'number',
  'title',
  'headRefName',
  'baseRefName',
  'headRefOid',
  'isCrossRepository',
]
const KNOWN_AGENTS = /\b(claude|codex|gemini|cursor|copilot)\b/i

/** The open pull requests from `number` down to the one whose base is not another open pull
 *  request's branch, bottom first. Empty when `number` is not open. @internal */
export function stackOf(open: StackPullRequest[], number: number): StackPullRequest[] {
  const stack: StackPullRequest[] = []
  let next = open.find((pr) => pr.number === number)
  while (next && !stack.includes(next)) {
    stack.unshift(next)
    const base = next.baseRefName
    next = open.find((pr) => pr.headRefName === base && pr.isCrossRepository !== true)
  }
  return stack
}

/** The message without the Co-Authored-By lines whose name is a known agent. @internal */
export function withoutAgentCredits(message: string): string {
  const credit = /^co-authored-by:(.*)$/i
  return message
    .split('\n')
    .filter((line) => !(credit.test(line.trim()) && KNOWN_AGENTS.test(line)))
    .join('\n')
}

async function openStack(ctx: GithubContext, repoRoot: string, number: number) {
  const open = await ctx.github.pullRequests.list(ctx.target(repoRoot), {
    state: 'open',
    limit: 100,
    fields: STACK_FIELDS,
  })
  return stackOf(open as unknown as StackPullRequest[], number)
}

/** What the confirm popover lists: each pull request that Merge stack would merge, in order. */
async function stackPlan(ctx: GithubContext, repoRoot: string, number: number) {
  const stack = await openStack(ctx, repoRoot, number)
  const { baseRefName: into = '' } = stack[0] ?? {}
  return { into, stack: stack.map(({ headRefOid: _head, ...shown }) => shown) }
}

/** The squash message GitHub would write from the commits, minus agent credits. */
async function squashBody(ctx: GithubContext, repoRoot: string, pullPath: string) {
  const raw = await ctx.api(repoRoot, { path: `${pullPath}/commits`, jq: '[.[].commit.message]' })
  const messages = JSON.parse(raw) as string[]
  const [only] = messages
  const body = messages.length === 1 ? only.split('\n').slice(1).join('\n').trim() : ''
  const bullets = messages.map((message) => `* ${message}`).join('\n\n')
  return withoutAgentCredits(messages.length === 1 ? body : bullets)
}

async function squashMerge(ctx: GithubContext, repoRoot: string, pr: StackPullRequest) {
  const { owner, repo } = await ctx.ownerAndName(repoRoot)
  const pullPath = `repos/${owner}/${repo}/pulls/${pr.number}`
  // `sha` is gh's --match-head-commit: GitHub refuses when the branch moved since the plan.
  const body: Record<string, string> = { merge_method: 'squash', sha: pr.headRefOid }
  if (ctx.options.stripAgentCredits?.())
    body.commit_message = await squashBody(ctx, repoRoot, pullPath)
  await ctx.api(repoRoot, { path: `${pullPath}/merge`, method: 'PUT', body })
}

/** What one stack merge runs against: the checkout and the waits. */
interface StackRun {
  ctx: GithubContext
  repoRoot: string
  clock: StackClock
}

/** GitHub computes mergeability after a retarget; it says UNKNOWN until it has. */
async function waitForMergeable(run: StackRun, number: number): Promise<string> {
  const { ctx, repoRoot, clock } = run
  for (let waited = 0; waited <= clock.timeoutMs; waited += clock.pollMs) {
    const view = await ctx.github.pullRequests.view(ctx.target(repoRoot), number, ['mergeable'])
    if (view.mergeable !== 'UNKNOWN') return String(view.mergeable)
    await clock.sleep(clock.pollMs)
  }
  return 'UNKNOWN'
}

/** The first line of what GitHub or gh said, which is the reason in words. */
function failureReason(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).split('\n')[0]
}

/** Moves a pull request above the bottom onto `base` and waits until GitHub can merge it. */
async function retargetAndWait(run: StackRun, pr: StackPullRequest, base: string) {
  const { ctx, repoRoot } = run
  const { owner, repo } = await ctx.ownerAndName(repoRoot)
  const path = `repos/${owner}/${repo}/pulls/${pr.number}`
  await ctx.api(repoRoot, { path, method: 'PATCH', body: { base } })
  const mergeable = await waitForMergeable(run, pr.number)
  if (mergeable === 'UNKNOWN') {
    throw new Error(`GitHub did not finish checking #${pr.number} within a minute`)
  }
  if (mergeable === 'CONFLICTING') throw new Error(`#${pr.number} has conflicts with ${base}`)
}

/** Squash-merges the stack's pull requests bottom first; stops at the first that cannot merge. @internal */
export async function mergeStack(
  ctx: GithubContext,
  at: { repoRoot: string; number: number },
  clock: StackClock = REAL_CLOCK
): Promise<StackResult> {
  const { repoRoot, number } = at
  const stack = await openStack(ctx, repoRoot, number)
  const base = stack[0]?.baseRefName ?? ''
  const merged: number[] = []
  for (const [index, pr] of stack.entries()) {
    try {
      if (index > 0) await retargetAndWait({ ctx, repoRoot, clock }, pr, base)
      await squashMerge(ctx, repoRoot, pr)
      merged.push(pr.number)
    } catch (e) {
      return { merged, failed: { number: pr.number, reason: failureReason(e) } }
    }
  }
  return { merged }
}

/** Opens GitHub's revert of a merged pull request; the new pull request's number and URL. @internal */
export async function revertPullRequest(ctx: GithubContext, repoRoot: string, number: number) {
  const view = await ctx.github.pullRequests.view(ctx.target(repoRoot), number, ['id'])
  const query =
    'mutation($id:ID!){revertPullRequest(input:{pullRequestId:$id}){revertPullRequest{number url}}}'
  const raw = await ctx.api(repoRoot, {
    path: 'graphql',
    fields: { query, id: String(view.id) },
    jq: '.data.revertPullRequest.revertPullRequest',
  })
  return JSON.parse(raw) as { number: number; url: string }
}

export function mergeStackChannels(ctx: GithubContext): ChannelSpec[] {
  const spec = (channel: string, run: (repoRoot: string, number: number) => Promise<unknown>) =>
    defineChannel({
      channel,
      schema: PullRequestNumberPayload,
      invalid: VALIDATION_ERROR,
      run: ({ repoRoot, number }) => run(repoRoot, number),
      onError: catchError,
    })
  return [
    spec('github:merge-stack-plan', (repoRoot, number) => stackPlan(ctx, repoRoot, number)),
    spec('github:merge-stack', (repoRoot, number) => mergeStack(ctx, { repoRoot, number })),
    spec('github:revert', (repoRoot, number) => revertPullRequest(ctx, repoRoot, number)),
  ]
}
