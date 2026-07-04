import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCardList = vi.fn()
const mockTicketList = vi.fn()
const mockCardCreate = vi.fn()
const mockCardMove = vi.fn()

vi.mock('../../src/types/electron.js', () => ({
  getSpeckitAPI: () => ({
    cardList: mockCardList,
    ticketList: mockTicketList,
    cardCreate: mockCardCreate,
    cardMove: mockCardMove,
  }),
}))

import { reconcileAssignedTickets } from '../../src/state/reconcile-tickets.js'

function ticket(key: string, extra: Record<string, unknown> = {}) {
  return {
    source: 'linear' as const,
    key,
    title: `Ticket ${key}`,
    sourceUrl: `https://l/${key}`,
    body: 'body',
    branchName: `andrew/${key.toLowerCase()}`,
    ...extra,
  }
}

function card(sourceKey: string | null, source = 'linear', extra: Record<string, unknown> = {}) {
  return {
    featureDir: `/repo/specs/001-${sourceKey ?? 'x'}`,
    title: 't',
    type: 'feature' as const,
    scopeLine: '',
    source,
    sourceUrl: null,
    sourceKey,
    stage: 'backlog' as const,
    runStatus: 'none' as const,
    phaseSummary: { done: 0, total: 10, awaitingReview: false },
    prUrl: null,
    ...extra,
  }
}

describe('reconcileAssignedTickets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCardCreate.mockResolvedValue({ featureDir: '/repo/specs/002-new' })
    mockCardMove.mockResolvedValue({ ok: true })
  })

  it('creates cards only for tickets not already on the board', async () => {
    mockCardList.mockResolvedValue({ cards: [card('TAV-1')] })
    mockTicketList.mockResolvedValue({ tickets: [ticket('TAV-1'), ticket('TAV-2')] })

    const result = await reconcileAssignedTickets('/repo')

    expect(result).toEqual({ created: 1, completed: 0, error: undefined })
    expect(mockCardCreate).toHaveBeenCalledTimes(1)
    expect(mockCardCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        repoRoot: '/repo',
        brief: expect.objectContaining({ title: 'Ticket TAV-2', source: 'linear' }),
        ticket: expect.objectContaining({ key: 'TAV-2', branchName: 'andrew/tav-2' }),
      })
    )
  })

  it('dedups within a single fetch payload', async () => {
    mockCardList.mockResolvedValue({ cards: [] })
    mockTicketList.mockResolvedValue({ tickets: [ticket('TAV-9'), ticket('TAV-9')] })

    const result = await reconcileAssignedTickets('/repo')

    expect(result.created).toBe(1)
    expect(mockCardCreate).toHaveBeenCalledTimes(1)
  })

  it('does not treat a jira key as matching a linear card with the same key', async () => {
    mockCardList.mockResolvedValue({ cards: [card('X-1', 'linear')] })
    mockTicketList.mockResolvedValue({ tickets: [ticket('X-1', { source: 'jira' })] })

    const result = await reconcileAssignedTickets('/repo')

    expect(result.created).toBe(1)
  })

  it('returns the error and creates nothing when ticket fetch fails', async () => {
    mockCardList.mockResolvedValue({ cards: [] })
    mockTicketList.mockResolvedValue({ error: 'no creds' })

    const result = await reconcileAssignedTickets('/repo')

    expect(result).toEqual({ created: 0, completed: 0, error: 'no creds' })
    expect(mockCardCreate).not.toHaveBeenCalled()
  })

  it('returns the error when the card list fails', async () => {
    mockCardList.mockResolvedValue({ error: 'read failed' })
    mockTicketList.mockResolvedValue({ tickets: [ticket('TAV-1')] })

    const result = await reconcileAssignedTickets('/repo')

    expect(result).toEqual({ created: 0, completed: 0, error: 'read failed' })
    expect(mockCardCreate).not.toHaveBeenCalled()
  })

  it('no-ops without a repoRoot', async () => {
    const result = await reconcileAssignedTickets('')

    expect(result).toEqual({ created: 0, completed: 0 })
    expect(mockCardList).not.toHaveBeenCalled()
    expect(mockTicketList).not.toHaveBeenCalled()
  })

  it('captures the first create error but keeps creating the rest', async () => {
    mockCardList.mockResolvedValue({ cards: [] })
    mockTicketList.mockResolvedValue({ tickets: [ticket('TAV-1'), ticket('TAV-2')] })
    mockCardCreate
      .mockResolvedValueOnce({ error: 'VALIDATION_ERROR', message: 'bad' })
      .mockResolvedValueOnce({ featureDir: '/repo/specs/003-two' })

    const result = await reconcileAssignedTickets('/repo')

    expect(result).toEqual({ created: 1, completed: 0, error: 'bad' })
    expect(mockCardCreate).toHaveBeenCalledTimes(2)
  })

  it('moves a card to done when its linked ticket is completed in Linear', async () => {
    mockCardList.mockResolvedValue({ cards: [card('TAV-1', 'linear', { stage: 'in-progress' })] })
    mockTicketList.mockResolvedValue({ tickets: [ticket('TAV-1', { completed: true })] })

    const result = await reconcileAssignedTickets('/repo')

    expect(result.completed).toBe(1)
    expect(mockCardMove).toHaveBeenCalledWith({
      featureDir: '/repo/specs/001-TAV-1',
      workspacePath: '/repo',
      toStage: 'done',
    })
  })

  it('does not move a card already in done', async () => {
    mockCardList.mockResolvedValue({ cards: [card('TAV-1', 'linear', { stage: 'done' })] })
    mockTicketList.mockResolvedValue({ tickets: [ticket('TAV-1', { completed: true })] })

    const result = await reconcileAssignedTickets('/repo')

    expect(result.completed).toBe(0)
    expect(mockCardMove).not.toHaveBeenCalled()
  })

  it('does not move a card whose ticket is not completed', async () => {
    mockCardList.mockResolvedValue({ cards: [card('TAV-1', 'linear', { stage: 'in-progress' })] })
    mockTicketList.mockResolvedValue({ tickets: [ticket('TAV-1', { completed: false })] })

    const result = await reconcileAssignedTickets('/repo')

    expect(result.completed).toBe(0)
    expect(mockCardMove).not.toHaveBeenCalled()
  })

  it('does not match a completed jira ticket to a linear card with the same key', async () => {
    mockCardList.mockResolvedValue({
      cards: [card('X-1', 'linear', { stage: 'in-progress' })],
    })
    mockTicketList.mockResolvedValue({
      tickets: [ticket('X-1', { source: 'jira', completed: true })],
    })

    const result = await reconcileAssignedTickets('/repo')

    expect(result.completed).toBe(0)
    expect(mockCardMove).not.toHaveBeenCalled()
  })
})
