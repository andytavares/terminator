import { getSpeckitAPI } from '../types/electron.js'
import type { CardSummary, Ticket } from '../types/speckit.types.js'

export interface ReconcileResult {
  created: number
  error?: string
}

/** Identity used to dedup a ticket against an existing card. */
function identity(source: string, key: string | null): string {
  return `${source}:${key ?? ''}`
}

/**
 * Fetch the user's assigned tickets and create a backlog card for each ticket that
 * is not already on the board. Dedup is keyed on `source` + ticket key (which is
 * mirrored onto each card as `sourceKey`), so re-running never duplicates a card.
 *
 * Unconfigured sources yield no tickets (ticketList returns an empty list), and a
 * fetch failure is toasted by the backend handler — here it is returned as `error`
 * so the caller can render without crashing.
 */
export async function reconcileAssignedTickets(repoRoot: string): Promise<ReconcileResult> {
  if (!repoRoot) return { created: 0 }

  const api = getSpeckitAPI()
  const [cardResult, ticketResult] = await Promise.all([
    api.cardList({ repoRoot }),
    api.ticketList(),
  ])

  if ('error' in ticketResult) return { created: 0, error: ticketResult.error }
  if ('error' in cardResult) return { created: 0, error: cardResult.error }

  const existing = new Set(
    cardResult.cards
      .filter((c: CardSummary) => c.sourceKey != null)
      .map((c: CardSummary) => identity(c.source, c.sourceKey))
  )

  let created = 0
  let error: string | undefined
  for (const ticket of ticketResult.tickets) {
    if (existing.has(identity(ticket.source, ticket.key))) continue
    const result = await createCard(repoRoot, ticket)
    if ('featureDir' in result) {
      created += 1
      // Guard against duplicate tickets within a single fetch payload.
      existing.add(identity(ticket.source, ticket.key))
    } else if (!error) {
      error = result.message ?? result.error
    }
  }

  return { created, error }
}

function createCard(repoRoot: string, ticket: Ticket) {
  return getSpeckitAPI().cardCreate({
    repoRoot,
    brief: { title: ticket.title, scope: ticket.body ?? '', source: ticket.source },
    ticket: {
      source: ticket.source,
      key: ticket.key,
      sourceUrl: ticket.sourceUrl,
      title: ticket.title,
      branchName: ticket.branchName ?? null,
    },
  })
}
