import { describe, it, expect, vi } from 'vitest'
import { fileTicket, ticketOffer } from '../../src/forge/ticket-offer.js'

// Before a typed idea becomes an order, the operator is offered a Linear
// ticket for it (spec 061, FR-4). Offered only when one can actually be made.

function issues(over: Record<string, unknown> = {}) {
  return {
    connections: vi.fn().mockResolvedValue([{ tracker: 'linear' }]),
    supportsCreate: vi.fn(() => true),
    teams: vi.fn().mockResolvedValue([{ id: 't1', key: 'TAV', name: 'Team' }]),
    create: vi.fn().mockResolvedValue({ key: 'TAV-16' }),
    ...over,
  }
}

describe('ticketOffer', () => {
  it("offers the operator's teams when Linear is connected and can create", async () => {
    await expect(ticketOffer(issues())).resolves.toEqual({
      teams: [{ id: 't1', key: 'TAV', name: 'Team' }],
    })
  })

  it('offers nothing when Linear is not connected, so nobody is asked', async () => {
    const port = issues({ connections: vi.fn().mockResolvedValue([{ tracker: 'jira' }]) })
    await expect(ticketOffer(port)).resolves.toBeNull()
    expect(port.teams).not.toHaveBeenCalled()
  })

  it('offers nothing when the host cannot create issues', async () => {
    await expect(ticketOffer(issues({ supportsCreate: () => false }))).resolves.toBeNull()
  })

  it('offers nothing when the operator belongs to no team', async () => {
    await expect(ticketOffer(issues({ teams: vi.fn().mockResolvedValue([]) }))).resolves.toBeNull()
  })

  it('offers nothing, rather than failing the order, when the tracker cannot be reached', async () => {
    await expect(
      ticketOffer(issues({ connections: vi.fn().mockRejectedValue(new Error('offline')) }))
    ).resolves.toBeNull()
  })

  it('offers nothing on a host with no issues API', async () => {
    await expect(ticketOffer(undefined)).resolves.toBeNull()
  })
})

describe('fileTicket', () => {
  it("titles the ticket with the idea's first sentence and keeps the whole idea as its body", async () => {
    const port = issues()
    const idea = 'Forge should only list open tickets. Done ones clutter the picker.'
    await expect(fileTicket(port, { idea, teamId: 't1' })).resolves.toEqual({ key: 'TAV-16' })
    expect(port.create).toHaveBeenCalledWith('linear', {
      teamId: 't1',
      title: 'Forge should only list open tickets.',
      description: idea,
    })
  })

  it('refuses an empty idea without calling the tracker', async () => {
    const port = issues()
    await expect(fileTicket(port, { idea: '  ', teamId: 't1' })).resolves.toHaveProperty('error')
    expect(port.create).not.toHaveBeenCalled()
  })

  it("says why, in the tracker's words, when the create is refused", async () => {
    const port = issues({ create: vi.fn().mockRejectedValue(new Error('Linear refused')) })
    await expect(fileTicket(port, { idea: 'x', teamId: 't1' })).resolves.toEqual({
      error: 'Linear refused',
    })
  })
})
