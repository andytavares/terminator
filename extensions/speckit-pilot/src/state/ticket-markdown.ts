import type { CardBrief, TicketRef } from '../types/speckit.types.js'

/**
 * Render the content the `specify` phase reads from `ticket.md` in the worktree
 * (see PHASE_COMMANDS.specify). Includes the card's title, type, full
 * scope/description, and checklist as acceptance criteria, plus the originating
 * ticket reference when the card was imported from Linear/Jira. Pure — no I/O.
 *
 * Without this the phase prompt points the agent at a file that is missing or
 * metadata-only, so the ticket contents never reach the model.
 */
export function buildTicketMarkdown(card: CardBrief | null, ticket: TicketRef | null): string {
  const title = card?.title ?? ticket?.title ?? 'Untitled'
  const lines: string[] = [`# ${title}`, '']

  if (ticket) {
    lines.push(
      `**Ticket:** ${ticket.key}`,
      `**Source:** ${ticket.source}`,
      `**URL:** ${ticket.sourceUrl}`,
      ''
    )
  }

  if (card) {
    lines.push(`**Type:** ${card.type}`, '', '## Description', '')
    lines.push(card.scope.trim().length > 0 ? card.scope.trim() : '_No description provided._')
    lines.push('')

    if (card.checklist.length > 0) {
      lines.push('## Acceptance Criteria', '')
      for (const item of card.checklist) {
        lines.push(`- [${item.done ? 'x' : ' '}] ${item.text}`)
      }
      lines.push('')
    }
  }

  return lines.join('\n')
}
