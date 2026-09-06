import { describe, it, expect } from 'vitest'
import { buildTicketMarkdown } from '../../src/state/ticket-markdown.js'
import { createDefaultBrief } from '../../src/types/speckit.types.js'
import type { CardBrief, TicketRef } from '../../src/types/speckit.types.js'

const ticket: TicketRef = {
  source: 'linear',
  key: 'TAV-11',
  sourceUrl: 'https://linear.app/x/issue/TAV-11',
  title: 'Auto-load tickets on open',
}

function brief(over: Partial<CardBrief> = {}): CardBrief {
  return { ...createDefaultBrief('Auto-load tickets on open', 'linear'), ...over }
}

describe('buildTicketMarkdown', () => {
  it('includes the card title as the heading', () => {
    const md = buildTicketMarkdown(brief(), ticket)
    expect(md.startsWith('# Auto-load tickets on open')).toBe(true)
  })

  it('renders the ticket reference (key, source, url) when a ticket is present', () => {
    const md = buildTicketMarkdown(brief(), ticket)
    expect(md).toContain('TAV-11')
    expect(md).toContain('linear')
    expect(md).toContain('https://linear.app/x/issue/TAV-11')
  })

  it('renders the full scope/description body so it reaches the model', () => {
    const md = buildTicketMarkdown(brief({ scope: 'The board should pull data on open.' }), ticket)
    expect(md).toContain('The board should pull data on open.')
  })

  it('renders the checklist as acceptance criteria', () => {
    const md = buildTicketMarkdown(
      brief({
        checklist: [
          { id: '1', text: 'Fetches on open', done: false },
          { id: '2', text: 'Dedups cards', done: true },
        ],
      }),
      ticket
    )
    expect(md).toContain('- [ ] Fetches on open')
    expect(md).toContain('- [x] Dedups cards')
  })

  it('shows a placeholder when the scope is empty', () => {
    const md = buildTicketMarkdown(brief({ scope: '   ' }), ticket)
    expect(md).toContain('_No description provided._')
  })

  it('omits the ticket reference for a native card with no ticket', () => {
    const md = buildTicketMarkdown(brief({ source: 'native', scope: 'native scope' }), null)
    expect(md).not.toContain('**Ticket:**')
    expect(md).toContain('native scope')
  })

  it('falls back to the ticket title when there is no card', () => {
    const md = buildTicketMarkdown(null, ticket)
    expect(md).toContain('# Auto-load tickets on open')
    expect(md).toContain('TAV-11')
  })

  it('returns a usable heading when neither card nor ticket is given', () => {
    const md = buildTicketMarkdown(null, null)
    expect(md).toContain('# Untitled')
  })
})
