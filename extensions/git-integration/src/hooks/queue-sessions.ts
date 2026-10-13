import { githubAPI } from '../api/github'
import { ReviewQueuePRSchema, ReviewSessionSchema } from '../schemas/pr-review.schema'
import type { ReviewQueuePR, ReviewSession } from '../schemas/pr-review.schema'

export function parsePrList(raw: unknown[]): ReviewQueuePR[] {
  return raw
    .map((p) => ReviewQueuePRSchema.safeParse(p))
    .filter((r) => r.success)
    .map((r) => r.data!)
}

/** The most recently opened stored session of each PR. */
async function latestSessionsByPr(repoRoot: string): Promise<Map<number, ReviewSession>> {
  const result = await githubAPI.sessionsForRepo(repoRoot)
  const sessions = (result.sessions as unknown[])
    .map((s) => ReviewSessionSchema.safeParse(s))
    .filter((r) => r.success)
    .map((r) => r.data!)
  const latestByPr = new Map<number, ReviewSession>()
  for (const session of sessions) {
    const existing = latestByPr.get(session.prNumber)
    if (!existing || session.lastAccessedAt > existing.lastAccessedAt) {
      latestByPr.set(session.prNumber, session)
    }
  }
  return latestByPr
}

/** The PR as its session left it: paused or in progress, and how many files were viewed. */
function withStoredSession(pr: ReviewQueuePR, session: ReviewSession | undefined): ReviewQueuePR {
  const sessionStatus = session?.pausedAt ? ('paused' as const) : ('in-progress' as const)
  return { ...pr, sessionStatus, viewedFileCount: session?.viewedFiles.length ?? 0 }
}

/** Of `numbers`, those still open on GitHub; all of them when the check cannot run. */
async function stillOpen(repoRoot: string, numbers: number[]): Promise<Set<number>> {
  if (numbers.length === 0) return new Set(numbers)
  try {
    const result = await githubAPI.pruneActiveReviews(repoRoot, numbers)
    if (!('error' in result)) return new Set((result as { openNumbers: number[] }).openNumbers)
  } catch {
    // e.g. no network: keep every orphan visible
  }
  return new Set(numbers)
}

/** In-progress reviews saved as active, not on this page and still open, so an in-progress PR shows
 *  whichever page it falls on; a closed or merged one leaves the store. */
async function openOrphans(
  repoRoot: string,
  prs: ReviewQueuePR[],
  latestByPr: Map<number, ReviewSession>
): Promise<ReviewQueuePR[]> {
  const activeResult = await githubAPI.activeReviewsForRepo(repoRoot)
  if ('error' in activeResult) return []
  const onPage = new Set(prs.map((p) => p.number))
  const candidates = parsePrList((activeResult as { prs: unknown[] }).prs).filter(
    (pr): pr is ReviewQueuePR => pr != null && !onPage.has(pr.number)
  )
  const open = await stillOpen(
    repoRoot,
    candidates.map((p) => p.number)
  )
  return candidates
    .filter((pr) => open.has(pr.number))
    .map((pr) => withStoredSession(pr, latestByPr.get(pr.number)))
}

/** Each PR with its stored session's progress, after any open orphans (an appended page skips them:
 *  the first page added them). Best-effort: on failure, `prs` as they are. */
export async function mergeSessionStatuses(
  repoRoot: string,
  prs: ReviewQueuePR[],
  isAppend: boolean = false
): Promise<ReviewQueuePR[]> {
  try {
    const latestByPr = await latestSessionsByPr(repoRoot)
    const merged = prs.map((pr) => {
      const session = pr ? latestByPr.get(pr.number) : undefined
      return session ? withStoredSession(pr, session) : pr
    })
    if (isAppend) return merged
    return [...(await openOrphans(repoRoot, prs, latestByPr)), ...merged]
  } catch {
    return prs
  }
}
