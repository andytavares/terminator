import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

const mockCardList = vi.fn()
const mockOnStateChanged = vi.fn().mockReturnValue(vi.fn())

vi.mock('../../src/types/electron.js', () => ({
  getSpeckitAPI: () => ({
    cardList: mockCardList,
    cardMove: vi.fn().mockResolvedValue({ ok: true }),
    onStateChanged: mockOnStateChanged,
  }),
}))

import { BoardView } from '../../src/components/BoardView.js'
import type { CardSummary } from '../../src/types/speckit.types.js'

function card(over: Partial<CardSummary> = {}): CardSummary {
  return {
    featureDir: '/repo/specs/016-a',
    title: 'Card A',
    type: 'feature',
    scopeLine: '',
    source: 'native',
    sourceUrl: null,
    sourceKey: null,
    stage: 'backlog',
    runStatus: 'none',
    phaseSummary: { done: 0, total: 10, awaitingReview: false },
    prUrl: null,
    ...over,
  }
}

describe('BoardView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOnStateChanged.mockReturnValue(vi.fn())
    mockCardList.mockResolvedValue({ cards: [] })
  })

  it('renders the empty state when there are no cards', async () => {
    render(<BoardView repoRoot="/repo" onOpenCard={vi.fn()} onNewCard={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText(/create your first card/i)).toBeTruthy()
    })
  })

  it('renders six columns and buckets cards by stage', async () => {
    mockCardList.mockResolvedValue({
      cards: [
        card(),
        card({ featureDir: '/repo/specs/016-b', title: 'Card B', stage: 'in-progress' }),
      ],
    })
    render(<BoardView repoRoot="/repo" onOpenCard={vi.fn()} onNewCard={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Card A')).toBeTruthy())
    expect(screen.getByTestId('board-column-backlog')).toBeTruthy()
    expect(screen.getByTestId('board-column-done')).toBeTruthy()
    // Card B lives in the in-progress column
    const inProgress = screen.getByTestId('board-column-in-progress')
    expect(inProgress.textContent).toContain('Card B')
  })

  it('invokes onNewCard when the New card button is clicked', async () => {
    const onNewCard = vi.fn()
    render(<BoardView repoRoot="/repo" onOpenCard={vi.fn()} onNewCard={onNewCard} />)
    await waitFor(() => screen.getByText(/new card/i))
    fireEvent.click(screen.getByText(/new card/i))
    expect(onNewCard).toHaveBeenCalled()
  })

  it('opens a card when its tile is clicked', async () => {
    const onOpenCard = vi.fn()
    mockCardList.mockResolvedValue({ cards: [card()] })
    render(<BoardView repoRoot="/repo" onOpenCard={onOpenCard} onNewCard={vi.fn()} />)
    await waitFor(() => screen.getByText('Card A'))
    fireEvent.click(screen.getByText('Card A'))
    expect(onOpenCard).toHaveBeenCalledWith('/repo/specs/016-a')
  })

  it('surfaces a load error', async () => {
    mockCardList.mockResolvedValue({ error: 'boom' })
    render(<BoardView repoRoot="/repo" onOpenCard={vi.fn()} onNewCard={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('boom'))
  })
})
