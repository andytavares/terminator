import type { DashboardCheck, DashboardPR } from '../../schemas/pr-review.schema.js'
import type { PrWatchReads, WatchComment } from '../../home/pr-watch.js'
import { reviewTarget } from '../../home/feed.js'
import type { GithubContext } from './context.js'
import { fetchIssueComments, inlineComments } from './pr-comments.js'

const JOB_ID = /\/job\/(\d+)/

/** What the pull request watch reads, over the same gh calls the review view makes. */
export function prWatchReads(ctx: GithubContext): PrWatchReads {
  return {
    viewer: () => ctx.viewer(ctx.noCheckoutCwd),
    comments: (pr) => commentsOf(ctx, pr),
    failedLog: (pr, check) => failedLogOf(ctx, { pr, check }),
  }
}

/** Reviews, conversation comments and inline comments of one pull request. */
async function commentsOf(ctx: GithubContext, pr: DashboardPR): Promise<WatchComment[]> {
  const at = { repoRoot: reviewTarget(pr).repoRoot, prNumber: pr.number }
  const [issue, inline] = await Promise.all([fetchIssueComments(ctx, at), inlineComments(ctx, at)])
  return [...issue.comments, ...inline.comments].map(({ author, body, createdAt }) => ({
    author,
    body,
    createdAt,
  }))
}

/** The log of the job behind a failed check (`gh run view --log-failed` has no api.github verb). */
async function failedLogOf(
  ctx: GithubContext,
  { pr, check }: { pr: DashboardPR; check: DashboardCheck }
): Promise<string> {
  const jobId = JOB_ID.exec(check.detailsUrl ?? '')?.[1]
  if (!jobId) return ''
  const path = `repos/{owner}/{repo}/actions/jobs/${jobId}/logs`
  return ctx.api(reviewTarget(pr).repoRoot, { path }).catch(() => '')
}
