import { z } from 'zod'
import { defineChannel, type ChannelSpec } from '@terminator/extension-sdk'
import type { ReviewQueuePR } from '../../schemas/pr-review.schema.js'
import { parseReviewQueuePR, normalizeGraphQLNode } from '../../github/pr-review-service.js'
import { PR_JSON_FIELDS, stateForSearch } from '../../github/gh-cli.js'
import { RepoRoot } from '../repo-root.js'
import { VALIDATION_ERROR } from '../register.js'
import { catchError, type GithubContext } from './context.js'

/** One page of the open-PR list, as the queue view shows it. */
interface QueuePage {
  prs: ReviewQueuePR[]
  totalCount: number
  hasMore: boolean
  nextCursor?: string
}

interface OpenPrsResponse {
  data: {
    repository: {
      pullRequests: {
        totalCount: number
        pageInfo: { endCursor: string; hasNextPage: boolean }
        nodes: unknown[]
      }
    }
  }
}

const OPEN_PRS_QUERY = `query($owner:String!,$repo:String!,$cursor:String){repository(owner:$owner,name:$repo){pullRequests(first:20,states:OPEN,after:$cursor,orderBy:{field:CREATED_AT,direction:DESC}){totalCount pageInfo{endCursor hasNextPage}nodes{number title state isDraft additions deletions createdAt headRefName baseRefName changedFiles mergeStateStatus author{login avatarUrl}assignees(first:10){nodes{login}}latestReviews(first:20){nodes{author{login avatarUrl}state submittedAt}}reviewRequests(first:10){nodes{requestedReviewer{...on User{login avatarUrl}...on Team{name}}}}commits(last:1){nodes{commit{statusCheckRollup{contexts(first:20){nodes{...on CheckRun{name conclusion status}...on StatusContext{context state}}}}}}}}}}}`

const ListOpenPrsPayload = z.object({
  repoRoot: RepoRoot,
  cursor: z.string().optional(),
  search: z.string().optional(),
})

/** A PR number finds that PR whatever its state. */
async function prByNumber(
  ctx: GithubContext,
  repoRoot: string,
  number: string
): Promise<QueuePage> {
  const view = await ctx.github.pullRequests.view(ctx.target(repoRoot), number, PR_JSON_FIELDS)
  return { prs: [parseReviewQueuePR(view)], totalCount: 1, hasMore: false }
}

/** Open PRs matching the text, unless an is:merged / is:closed / is:all qualifier says otherwise. */
async function prsMatching(
  ctx: GithubContext,
  repoRoot: string,
  search: string
): Promise<QueuePage> {
  const { state, text } = stateForSearch(search)
  const found = await ctx.github.pullRequests.list(ctx.target(repoRoot), {
    state,
    ...(text ? { search: text } : {}),
    limit: 50,
    fields: PR_JSON_FIELDS,
  })
  const parsed = found.map(parseReviewQueuePR)
  const excluded = await ctx.excludedIn(parsed, repoRoot)
  const prs = parsed.filter((pr) => !excluded(pr.headRefName, repoRoot))
  return { prs, totalCount: prs.length, hasMore: false }
}

/** One GraphQL page of open PRs, newest first, leaving out excluded branches. */
async function openPrsPage(
  ctx: GithubContext,
  repoRoot: string,
  cursor?: string
): Promise<QueuePage> {
  const { owner, repo } = await ctx.ownerAndName(repoRoot)
  const raw = await ctx.api(repoRoot, {
    path: 'graphql',
    fields: { query: OPEN_PRS_QUERY, owner, repo, ...(cursor ? { cursor } : {}) },
    timeoutMs: 60_000,
  })
  const { nodes, pageInfo, totalCount } = (JSON.parse(raw) as OpenPrsResponse).data.repository
    .pullRequests
  const page = nodes.map((n) => parseReviewQueuePR(normalizeGraphQLNode(n)))
  const excluded = await ctx.excludedIn(page, repoRoot)
  const prs = page.filter((pr) => !excluded(pr.headRefName, repoRoot))
  return {
    prs,
    // The count the summary line reports, rather than the rows held (one page). Excluded
    // branches are only known page by page, so this page's are taken off.
    totalCount: totalCount - (page.length - prs.length),
    hasMore: pageInfo.hasNextPage,
    nextCursor: pageInfo.hasNextPage ? pageInfo.endCursor : undefined,
  }
}

export function prQueueChannels(ctx: GithubContext): ChannelSpec[] {
  return [
    defineChannel({
      channel: 'github:list-open-prs',
      schema: ListOpenPrsPayload,
      invalid: VALIDATION_ERROR,
      run: ({ repoRoot, cursor, search }) => {
        const query = search?.trim()
        if (query && /^\d+$/.test(query)) return prByNumber(ctx, repoRoot, query)
        if (query) return prsMatching(ctx, repoRoot, search!)
        return openPrsPage(ctx, repoRoot, cursor)
      },
      onError: catchError,
    }),
  ]
}
