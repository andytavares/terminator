import type { TrackerId, WorkKey } from '@terminator/extension-sdk'
import type { DashboardPR } from '../schemas/pr-review.schema.js'

const TICKET_KEY = /\b([A-Z][A-Z0-9]+-\d+)\b/i

/** What a pull request needs for its work key, open or merged. */
export type JoinableToWork = Pick<DashboardPR, 'headRefName' | 'title' | 'localRepoRoot'>

/** The keys of the user's open issues and the tracker each belongs to. */
export type TicketIndex = ReadonlyMap<string, TrackerId>

/** The ticket key in `text` ("tav-20-pr-overview" gives "TAV-20"), or null. */
export function parseTicketKey(text: string): string | null {
  const match = TICKET_KEY.exec(text)
  return match ? match[1].toUpperCase() : null
}

/** The first key in the branch, then the title, that is one of the user's issues ("utf-8" is not). */
function ownTicketKey(pr: JoinableToWork, tickets: TicketIndex): string | null {
  return (
    [pr.headRefName ?? '', pr.title]
      .map(parseTicketKey)
      .find((key) => key !== null && tickets.has(key)) ?? null
  )
}

/** What joins this pull request's Home items to the rest of its work: its ticket, else its branch. */
export function workKeyOf(pr: JoinableToWork, tickets: TicketIndex): WorkKey | null {
  const key = ownTicketKey(pr, tickets)
  if (key) return { tracker: tickets.get(key)!, key }
  if (!pr.localRepoRoot || !pr.headRefName) return null
  return { repoRoot: pr.localRepoRoot, branch: pr.headRefName }
}
