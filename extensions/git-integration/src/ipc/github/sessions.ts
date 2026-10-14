import { z } from 'zod'
import { defineChannel, type ChannelSpec } from '@terminator/extension-sdk'
import type { ReviewSession } from '../../schemas/pr-review.schema.js'
import { ReviewQueuePRSchema, ReviewSessionSchema } from '../../schemas/pr-review.schema.js'
import { namedStore } from '../../storage-directory.js'
import { RepoRoot } from '../repo-root.js'
import { VALIDATION_ERROR, errorEnvelope } from '../register.js'
import { catchError, PullRequestPayload, RepoRootPayload, type GithubContext } from './context.js'

/** A stored session, and whether it is under the current (v2) key. */
interface KeyedSession {
  session: ReviewSession
  isNewKey: boolean
}

const sessionStore = () => namedStore('pr-review-sessions')
const activeReviewStore = () => namedStore('pr-active-reviews')

/** One session per PR. v2 keys are "repo:::pr"; v1 keys are "repo:::pr:::sha". When both exist for
 *  a PR the v2 key wins: it is the one v2 code keeps current. */
export function storedSessionsForRepo(
  stored: Record<string, unknown>,
  repoRoot: string
): ReviewSession[] {
  const prefix = `${repoRoot}:::`
  const byPrNumber = new Map<number, KeyedSession>()
  for (const [key, value] of Object.entries(stored)) {
    const result = key.startsWith(prefix) ? ReviewSessionSchema.safeParse(value) : null
    if (!result?.success) continue
    const isNewKey = !key.slice(prefix.length).includes(':::')
    const existing = byPrNumber.get(result.data.prNumber)
    if (!existing || (isNewKey && !existing.isNewKey)) {
      byPrNumber.set(result.data.prNumber, { session: result.data, isNewKey })
    }
  }
  return Array.from(byPrNumber.values()).map((v) => v.session)
}

/** Every stored review session, keyed as `sessionsForRepo` reads them. */
export async function storedSessions(): Promise<Record<string, unknown>> {
  return (await sessionStore()).store
}

async function activeReviewsFor(repoRoot: string): Promise<unknown[]> {
  return Object.values((await activeReviewStore()).store)
    .filter(
      (entry): entry is { repoRoot: string; pr: unknown } =>
        typeof entry === 'object' &&
        entry !== null &&
        (entry as { repoRoot: string }).repoRoot === repoRoot
    )
    .map((entry) => entry.pr)
}

/** Forgets a PR: its active-review snapshot and its sessions, "repo:::pr" and v1's
 *  "repo:::pr:::sha", so it does not reappear as in progress on the next load. */
async function forgetActiveReview(repoRoot: string, prNumber: number): Promise<void> {
  const [activeReviews, sessions] = await Promise.all([activeReviewStore(), sessionStore()])
  activeReviews.delete(`${repoRoot}:${prNumber}`)
  const sessionKey = `${repoRoot}:::${prNumber}`
  for (const key of Object.keys(sessions.store)) {
    if (key === sessionKey || key.startsWith(`${sessionKey}:::`)) sessions.delete(key)
  }
}

/** The given PRs still open on GitHub; a closed or merged one loses its snapshot. */
async function pruneStoredActiveReviews(ctx: GithubContext, repoRoot: string, prNumbers: number[]) {
  const results = await Promise.allSettled(
    prNumbers.map(async (num) => {
      const data = await ctx.github.pullRequests.view(ctx.target(repoRoot), num, [
        'number',
        'state',
      ])
      return { number: Number(data.number), state: String(data.state) }
    })
  )
  const openNumbers: number[] = []
  const activeReviews = await activeReviewStore()
  for (const r of results) {
    if (r.status !== 'fulfilled') continue
    if (r.value.state === 'OPEN') openNumbers.push(r.value.number)
    else activeReviews.delete(`${repoRoot}:${r.value.number}`)
  }
  return { openNumbers }
}

function sessionsForRepoChannel(): ChannelSpec {
  return defineChannel({
    channel: 'github:sessions-for-repo',
    schema: RepoRootPayload,
    invalid: { sessions: [] },
    run: async ({ repoRoot }) => ({
      sessions: storedSessionsForRepo(await storedSessions(), repoRoot),
    }),
  })
}

function sessionGetChannel(): ChannelSpec {
  return defineChannel({
    channel: 'github:session-get',
    schema: z.object({ key: z.string().min(1) }),
    invalid: { session: null },
    run: async ({ key }) => {
      const result = ReviewSessionSchema.safeParse((await sessionStore()).get(key))
      return { session: result.success ? result.data : null }
    },
  })
}

function sessionSetChannel(): ChannelSpec {
  return defineChannel({
    channel: 'github:session-set',
    schema: z.object({ key: z.string().min(1), session: ReviewSessionSchema }),
    invalid: VALIDATION_ERROR,
    run: async ({ key, session }) => {
      const sessions = await sessionStore()
      sessions.set(key, session)
      return { ok: true as const }
    },
    onError: errorEnvelope,
  })
}

function sessionChannels(): ChannelSpec[] {
  return [sessionsForRepoChannel(), sessionGetChannel(), sessionSetChannel()]
}

/** A ReviewQueuePR snapshot per in-progress review, keyed "<repoRoot>:<prNumber>", so it shows on
 *  every load whichever page it falls on; removed when dismissed or closed. */
function saveActiveReviewChannel(): ChannelSpec {
  return defineChannel({
    channel: 'github:save-active-review',
    schema: z.object({ repoRoot: RepoRoot, pr: ReviewQueuePRSchema }),
    invalid: VALIDATION_ERROR,
    run: async ({ repoRoot, pr }) => {
      const activeReviews = await activeReviewStore()
      activeReviews.set(`${repoRoot}:${pr.number}`, { repoRoot, pr })
      return { ok: true as const }
    },
    onError: errorEnvelope,
  })
}

function activeReviewsChannel(): ChannelSpec {
  return defineChannel({
    channel: 'github:active-reviews-for-repo',
    schema: RepoRootPayload,
    invalid: VALIDATION_ERROR,
    run: async ({ repoRoot }) => ({ prs: await activeReviewsFor(repoRoot) }),
    onError: errorEnvelope,
  })
}

function removeActiveReviewChannel(): ChannelSpec {
  return defineChannel({
    channel: 'github:remove-active-review',
    schema: PullRequestPayload,
    invalid: VALIDATION_ERROR,
    run: async ({ repoRoot, prNumber }) => {
      await forgetActiveReview(repoRoot, prNumber)
      return { ok: true as const }
    },
    onError: errorEnvelope,
  })
}

function pruneActiveReviewsChannel(ctx: GithubContext): ChannelSpec {
  return defineChannel({
    channel: 'github:prune-active-reviews',
    schema: z.object({ repoRoot: RepoRoot, prNumbers: z.array(z.number().int().positive()) }),
    invalid: VALIDATION_ERROR,
    run: ({ repoRoot, prNumbers }) =>
      prNumbers.length === 0
        ? { openNumbers: [] }
        : pruneStoredActiveReviews(ctx, repoRoot, prNumbers),
    onError: catchError,
  })
}

function activeReviewChannels(ctx: GithubContext): ChannelSpec[] {
  return [
    saveActiveReviewChannel(),
    activeReviewsChannel(),
    removeActiveReviewChannel(),
    pruneActiveReviewsChannel(ctx),
  ]
}

export function reviewSessionChannels(ctx: GithubContext): ChannelSpec[] {
  return [...sessionChannels(), ...activeReviewChannels(ctx)]
}
