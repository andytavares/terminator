import { titleFrom } from './intake-source.js'

// A ticket for a typed idea, offered before it becomes an order (spec 061).
//
// The order's project and branch take the ticket's recommended branch name, so
// the ticket has to exist first. Offered only when one can actually be made —
// a question whose "yes" would fail is a question nobody should be asked.

export interface TicketTeam {
  readonly id: string
  readonly key: string
  readonly name: string
}

/** The slice of `api.issues` this needs. */
export interface TicketIssues {
  connections(): Promise<readonly { tracker: string }[]>
  supportsCreate(tracker: 'linear'): boolean
  teams(tracker: 'linear'): Promise<readonly TicketTeam[]>
  create(
    tracker: 'linear',
    input: { teamId: string; title: string; description: string }
  ): Promise<{ key: string }>
}

/** The teams a ticket could go to, or null when none can be made. */
export async function ticketOffer(
  issues: TicketIssues | undefined
): Promise<{ teams: TicketTeam[] } | null> {
  if (issues === undefined || !issues.supportsCreate('linear')) return null
  try {
    const connected = await issues.connections()
    if (!connected.some((c) => c.tracker === 'linear')) return null
    const teams = await issues.teams('linear')
    return teams.length === 0 ? null : { teams: [...teams] }
  } catch {
    // An unreachable tracker is not a reason to refuse the order; the
    // operator gets the typed order they asked for.
    return null
  }
}

export async function fileTicket(
  issues: TicketIssues,
  input: { idea: string; teamId: string }
): Promise<{ key: string } | { error: string }> {
  const idea = input.idea.trim()
  if (idea === '')
    return { error: 'A ticket needs an idea. Say what is wrong or what should exist.' }
  try {
    const issue = await issues.create('linear', {
      teamId: input.teamId,
      title: titleFrom(idea),
      description: idea,
    })
    return { key: issue.key }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}
