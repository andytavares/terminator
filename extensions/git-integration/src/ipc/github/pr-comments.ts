import { z } from 'zod'
import { defineChannel, type ChannelSpec, type GithubApiRequest } from '@terminator/extension-sdk'
import type { InlineComment, IssueComment } from '../../schemas/pr-review.schema.js'
import { mapIssueComment, mapComment } from '../../github/pr-review-service.js'
import { RepoRoot } from '../repo-root.js'
import { VALIDATION_ERROR, errorEnvelope } from '../register.js'
import { catchError, PullRequestPayload, type GithubContext } from './context.js'

/** A pull request of a checkout. */
interface PrAt {
  repoRoot: string
  prNumber: number
}

interface ReviewThreadsResponse {
  data?: {
    repository?: {
      pullRequest?: {
        reviewThreads?: {
          nodes?: Array<{
            isResolved: boolean
            comments: { nodes: Array<{ databaseId: number | null }> }
          }>
        }
      }
    }
  }
}

type DraftComment = z.infer<typeof DraftCommentSchema>

const REVIEW_THREADS_QUERY =
  'query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){reviewThreads(first:100){nodes{isResolved comments(first:1){nodes{databaseId}}}}}}}'

const DraftCommentSchema = z.object({
  path: z.string().min(1),
  line: z.number().int().positive(),
  startLine: z.number().int().positive().nullable().optional(),
  side: z.enum(['LEFT', 'RIGHT']),
  body: z.string().min(1),
})

const ReviewSubmitPayload = z.object({
  repoRoot: RepoRoot,
  prNumber: z.number().int().positive(),
  event: z.enum(['APPROVE', 'REQUEST_CHANGES', 'COMMENT']),
  body: z.string(),
  comments: z.array(DraftCommentSchema).optional(),
})

const PostPayload = z.object({
  repoRoot: RepoRoot,
  prNumber: z.number().int().positive(),
  body: z.string().min(1),
})

/** The first item of GitHub's error list: a message, or an object carrying one. */
function specificError(
  errors: Array<string | { message?: string }> | undefined
): string | undefined {
  const first = errors?.[0]
  if (typeof first === 'string') return first
  if (typeof first === 'object') return first.message
  return undefined
}

/** GitHub's own reason a review was refused, else gh's output, else the error. gh api writes the
 *  JSON error to stdout; stderr only says "gh: Unprocessable Entity (HTTP 422)". */
function reviewSubmitError(e: unknown): { error: string } {
  const err = e as { stderr?: string; stdout?: string }
  const ghOutput = (err.stdout || err.stderr || '').trim()
  const jsonMatch = ghOutput.match(/\{[\s\S]*?\}/)
  try {
    const apiErr = jsonMatch
      ? (JSON.parse(jsonMatch[0]) as {
          message?: string
          errors?: Array<string | { message?: string }>
        })
      : {}
    const msg = specificError(apiErr.errors) ?? apiErr.message
    if (msg) return { error: msg }
  } catch {
    // not JSON: fall back to gh's output
  }
  return { error: ghOutput || String(e) }
}

/** Ids of the first comment of each resolved thread (R2); none when GraphQL fails. */
async function resolvedCommentIds(ctx: GithubContext, at: PrAt): Promise<number[]> {
  try {
    const { owner, repo } = await ctx.ownerAndName(at.repoRoot)
    const threadsRaw = await ctx.api(at.repoRoot, {
      path: 'graphql',
      fields: { query: REVIEW_THREADS_QUERY, o: owner, r: repo },
      typedFields: { n: at.prNumber },
    })
    const response = JSON.parse(threadsRaw) as ReviewThreadsResponse
    const nodes = response.data?.repository?.pullRequest?.reviewThreads?.nodes ?? []
    return nodes
      .filter((n) => n.isResolved)
      .map((n) => n.comments.nodes[0]?.databaseId)
      .filter((id): id is number => id != null)
  } catch {
    return []
  }
}

async function inlineComments(ctx: GithubContext, at: PrAt) {
  const raw = await ctx.api(at.repoRoot, {
    path: `repos/{owner}/{repo}/pulls/${at.prNumber}/comments`,
    paginate: true,
    jq: '[.[] | {id,user,body,created_at,updated_at,path,line,start_line,side,diff_hunk,in_reply_to_id,pull_request_review_id}]',
  })
  const comments: InlineComment[] = (JSON.parse(raw) as unknown[]).map(mapComment)
  // Best-effort: the REST comments above already loaded.
  return { comments, resolvedCommentIds: await resolvedCommentIds(ctx, at) }
}

/** Issue comments and review bodies, oldest first. A body sent with "Submit review" lives at
 *  /pulls/{n}/reviews, not /issues/{n}/comments, so the two are merged. */
async function fetchIssueComments(ctx: GithubContext, at: PrAt) {
  const [issueRaw, reviewsRaw] = await Promise.all([
    ctx.api(at.repoRoot, {
      path: `repos/{owner}/{repo}/issues/${at.prNumber}/comments`,
      paginate: true,
      jq: '[.[] | {id,user,body,created_at,updated_at}]',
    }),
    ctx
      .api(at.repoRoot, {
        path: `repos/{owner}/{repo}/pulls/${at.prNumber}/reviews`,
        jq: '[.[] | select(.body != null and .body != "") | {id,user,body,submitted_at}]',
      })
      .catch(() => '[]'),
  ])
  // A review's one timestamp, submitted_at, stands for both of a comment's.
  const reviewItems = (JSON.parse(reviewsRaw) as Array<Record<string, unknown>>).map((r) => ({
    ...r,
    created_at: r.submitted_at,
    updated_at: r.submitted_at,
  }))
  const comments: IssueComment[] = [...(JSON.parse(issueRaw) as unknown[]), ...reviewItems]
    .map(mapIssueComment)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  return { comments }
}

/** A draft as GitHub's review API takes it; a range names where it starts. */
function reviewComment(c: DraftComment): Record<string, unknown> {
  const entry: Record<string, unknown> = { path: c.path, line: c.line, side: c.side, body: c.body }
  if (c.startLine != null && c.startLine !== c.line) {
    entry.start_line = c.startLine
    entry.start_side = c.side
  }
  return entry
}

/** Submits a review. Drafts (S5) go in the same POST, so they land as one review; an empty body is
 *  left out, since GitHub rejects it for some events. */
async function submitPrReview(ctx: GithubContext, payload: z.infer<typeof ReviewSubmitPayload>) {
  const { repoRoot, prNumber, event, body, comments } = payload
  const { owner, repo } = await ctx.ownerAndName(repoRoot)
  const path = `repos/${owner}/${repo}/pulls/${prNumber}/reviews`
  const withBody: Record<string, string> = body.trim() ? { event, body } : { event }
  const drafts = comments ?? []
  const request: GithubApiRequest =
    drafts.length > 0
      ? { path, method: 'POST', body: { ...withBody, comments: drafts.map(reviewComment) } }
      : { path, method: 'POST', fields: withBody }
  const data = JSON.parse(await ctx.api(repoRoot, request)) as Record<string, unknown>
  return { reviewId: Number(data.id) }
}

/** POSTs a comment body to `path` of the checkout's repository; GitHub answers the comment. */
async function createIssueComment(
  ctx: GithubContext,
  at: { repoRoot: string; path: string },
  body: string
) {
  const raw = await ctx.api(at.repoRoot, { path: at.path, method: 'POST', fields: { body } })
  return JSON.parse(raw) as unknown
}

function inlineCommentsChannel(ctx: GithubContext): ChannelSpec {
  return defineChannel({
    channel: 'github:pr-inline-comments',
    schema: PullRequestPayload,
    invalid: VALIDATION_ERROR,
    run: (at) => inlineComments(ctx, at),
    onError: catchError,
  })
}

function issueCommentsChannel(ctx: GithubContext): ChannelSpec {
  return defineChannel({
    channel: 'github:pr-issue-comments',
    schema: PullRequestPayload,
    invalid: VALIDATION_ERROR,
    run: (at) => fetchIssueComments(ctx, at),
    onError: catchError,
  })
}

function issueCommentAddChannel(ctx: GithubContext): ChannelSpec {
  return defineChannel({
    channel: 'github:pr-issue-comment-add',
    schema: PostPayload,
    invalid: VALIDATION_ERROR,
    run: async ({ repoRoot, prNumber, body }) => {
      const path = `repos/{owner}/{repo}/issues/${prNumber}/comments`
      return { comment: mapIssueComment(await createIssueComment(ctx, { repoRoot, path }, body)) }
    },
    onError: errorEnvelope,
  })
}

function commentReplyChannel(ctx: GithubContext): ChannelSpec {
  return defineChannel({
    channel: 'github:pr-comment-reply',
    schema: PostPayload.extend({ inReplyToId: z.number().int().positive() }),
    invalid: VALIDATION_ERROR,
    run: async (reply) => {
      const path = `repos/{owner}/{repo}/pulls/${reply.prNumber}/comments/${reply.inReplyToId}/replies`
      const raw = await createIssueComment(ctx, { repoRoot: reply.repoRoot, path }, reply.body)
      return { comment: mapComment(raw) }
    },
    onError: errorEnvelope,
  })
}

function reviewSubmitChannel(ctx: GithubContext): ChannelSpec {
  return defineChannel({
    channel: 'github:pr-review-submit',
    schema: ReviewSubmitPayload,
    invalid: VALIDATION_ERROR,
    run: (payload) => submitPrReview(ctx, payload),
    onError: reviewSubmitError,
  })
}

export function prCommentChannels(ctx: GithubContext): ChannelSpec[] {
  return [
    inlineCommentsChannel(ctx),
    issueCommentsChannel(ctx),
    issueCommentAddChannel(ctx),
    commentReplyChannel(ctx),
    reviewSubmitChannel(ctx),
  ]
}
