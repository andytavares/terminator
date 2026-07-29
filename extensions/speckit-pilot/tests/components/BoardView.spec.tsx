import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import React from 'react'

const mockCardList = vi.fn()
const mockOnStateChanged = vi.fn().mockReturnValue(vi.fn())
const mockOnPermissionsChanged = vi.fn().mockReturnValue(vi.fn())
const mockPermissionsList = vi.fn().mockResolvedValue({ pending: [] })
const mockPermissionResolve = vi.fn().mockResolvedValue({ ok: true })
const mockPermissionHandBack = vi.fn().mockResolvedValue({ ok: true })
// Captured so a test can fire the jump the palette sends.
let paletteHandler: ((data: unknown) => void) | null = null
const mockOnPaletteGoto = vi.fn((handler: (data: unknown) => void) => {
  paletteHandler = handler
  return vi.fn()
})

vi.mock('../../src/types/electron.js', () => ({
  getSpeckitAPI: () => ({
    cardList: mockCardList,
    cardMove: vi.fn().mockResolvedValue({ ok: true }),
    onStateChanged: mockOnStateChanged,
    onPermissionsChanged: mockOnPermissionsChanged,
    permissionsList: mockPermissionsList,
    permissionResolve: mockPermissionResolve,
    permissionHandBack: mockPermissionHandBack,
    // The supervision panel lives on the board and reads on mount; without
    // these the board's own tests fail on a surface they are not testing.
    supervisionSnapshot: vi.fn().mockResolvedValue({
      runs: [],
      review: [],
      backpressure: { allowed: true, unreviewed: 0, limit: 3 },
    }),
    stallsList: vi.fn().mockResolvedValue({ firings: [], shadowMode: true }),
    feedList: vi.fn().mockResolvedValue({ entries: [] }),
    onPaletteGoto: mockOnPaletteGoto,
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

describe('a supervised run waiting on the operator', () => {
  const ask = {
    featureDir: '/repo/specs/016-a',
    sessionId: 'session-1',
    requestId: 'req-1',
    toolName: 'Bash',
    summary: 'rm -rf build',
    detail: 'command: rm -rf build',
    at: 1_000,
  }

  beforeEach(() => {
    mockPermissionsList.mockResolvedValue({ pending: [ask] })
    mockCardList.mockResolvedValue({ cards: [card()] })
  })

  it('shows what is being held, above the board rather than inside a card', async () => {
    // Finding it inside a card would mean opening them one at a time, and a
    // held tool call is the one state where nothing moves until somebody acts.
    render(<BoardView repoRoot="/repo" onOpenCard={vi.fn()} onNewCard={vi.fn()} />)
    expect(await screen.findByText('rm -rf build')).toBeDefined()
  })

  it('names the card it came from, rather than its directory', async () => {
    // Scoped to the ask: the card's own tile says the same thing further down.
    const { container } = render(
      <BoardView repoRoot="/repo" onOpenCard={vi.fn()} onNewCard={vi.fn()} />
    )
    await screen.findByText('rm -rf build')
    expect(container.querySelector('.sk-ask__card')?.textContent).toBe('Card A')
  })

  it('allows it, and re-reads what is left', async () => {
    render(<BoardView repoRoot="/repo" onOpenCard={vi.fn()} onNewCard={vi.fn()} />)
    fireEvent.click(await screen.findByText('Allow'))
    await waitFor(() =>
      expect(mockPermissionResolve).toHaveBeenCalledWith({
        requestId: 'req-1',
        decision: 'allow',
      })
    )
  })

  it('carries a real answer back as words rather than a bare refusal', async () => {
    render(<BoardView repoRoot="/repo" onOpenCard={vi.fn()} onNewCard={vi.fn()} />)
    fireEvent.change(await screen.findByLabelText('Answer Bash'), {
      target: { value: 'use the staging host' },
    })
    fireEvent.click(screen.getByText('Send'))
    await waitFor(() =>
      expect(mockPermissionResolve).toHaveBeenCalledWith({
        requestId: 'req-1',
        decision: 'deny',
        answer: 'use the staging host',
      })
    )
  })

  it('hands it back to the terminal when asked to', async () => {
    render(<BoardView repoRoot="/repo" onOpenCard={vi.fn()} onNewCard={vi.fn()} />)
    fireEvent.click(await screen.findByText('Answer in terminal'))
    await waitFor(() => expect(mockPermissionHandBack).toHaveBeenCalledWith({ requestId: 'req-1' }))
  })

  it('shows nothing when nothing is held, rather than an empty panel', async () => {
    mockPermissionsList.mockResolvedValue({ pending: [] })
    render(<BoardView repoRoot="/repo" onOpenCard={vi.fn()} onNewCard={vi.fn()} />)
    await screen.findByText('Card A')
    expect(screen.queryByText(/waiting on you/)).toBeNull()
  })
})

describe('jumping here from the palette', () => {
  beforeEach(() => {
    paletteHandler = null
    mockCardList.mockResolvedValue({ cards: [card()] })
  })

  it('subscribes, or the palette entries would go nowhere', async () => {
    render(<BoardView repoRoot="/repo" onOpenCard={vi.fn()} onNewCard={vi.fn()} />)
    await screen.findByText('Card A')
    expect(paletteHandler).not.toBeNull()
  })

  it('opens the supervision panel on a queued diff', async () => {
    render(<BoardView repoRoot="/repo" onOpenCard={vi.fn()} onNewCard={vi.fn()} />)
    await screen.findByText('Card A')
    act(() => {
      paletteHandler?.({ kind: 'review', sessionId: 'session-1', terminalSessionId: null })
    })
    // The review section, rather than whichever tab happened to be open.
    expect(await screen.findByText(/Nothing is waiting to be reviewed/)).toBeDefined()
  })

  it('falls back to the panel when the run no longer has a terminal', async () => {
    // A jump that silently does nothing is worse than one that shows the run.
    render(<BoardView repoRoot="/repo" onOpenCard={vi.fn()} onNewCard={vi.fn()} />)
    await screen.findByText('Card A')
    act(() => {
      paletteHandler?.({ kind: 'run', sessionId: 'session-1', terminalSessionId: 'gone' })
    })
    expect(await screen.findByText('Nothing is running.')).toBeDefined()
  })
})
