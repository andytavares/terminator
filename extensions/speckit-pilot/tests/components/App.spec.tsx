import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { createInitialState } from '../../src/state/state-persistence.js'

const mockCardList = vi.fn()
const mockCardCreate = vi.fn()
const mockPilotState = vi.fn()
const mockOnStateChanged = vi.fn().mockReturnValue(vi.fn())

vi.mock('../../src/types/electron.js', () => ({
  getSpeckitAPI: () => ({
    cardList: mockCardList,
    cardCreate: mockCardCreate,
    cardMove: vi.fn().mockResolvedValue({ ok: true }),
    cardUpdate: vi.fn().mockResolvedValue({ ok: true }),
    pilotState: mockPilotState,
    commentList: vi.fn().mockResolvedValue({ comments: [] }),
    historyLoad: vi.fn().mockResolvedValue({ entries: [] }),
    artifactList: vi.fn().mockResolvedValue({ artifacts: [] }),
    knowledgeSearch: vi.fn().mockResolvedValue({ results: [] }),
    ticketList: vi.fn().mockResolvedValue({ tickets: [] }),
    credentialsStatus: vi.fn().mockResolvedValue({ connected: false }),
    credentialsSet: vi.fn().mockResolvedValue({ ok: true }),
    onStateChanged: mockOnStateChanged,
  }),
}))

import { App } from '../../src/renderer/App.js'

// Capture extensionBridge handlers so tests can fire push events
let bridgeHandlers: Record<string, (data: unknown) => void>
const projectCreate = vi.fn()
const workspaceList = vi.fn()

function card() {
  return {
    featureDir: '/repo/specs/016-a',
    title: 'Card A',
    type: 'feature' as const,
    scopeLine: '',
    source: 'native' as const,
    sourceUrl: null,
    sourceKey: null,
    stage: 'backlog' as const,
    runStatus: 'none' as const,
    phaseSummary: { done: 0, total: 10, awaitingReview: false },
    prUrl: null,
  }
}

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    bridgeHandlers = {}
    mockOnStateChanged.mockReturnValue(vi.fn())
    mockCardList.mockResolvedValue({ cards: [] })
    mockCardCreate.mockResolvedValue({ featureDir: '/repo/specs/001-x' })
    mockPilotState.mockResolvedValue({ state: createInitialState('/repo/specs/016-a') })
    workspaceList.mockResolvedValue({ workspaces: [{ id: 'w1', folderPath: '/repo' }] })
    ;(window as unknown as Record<string, unknown>).electronAPI = {
      extensionBridge: {
        on: vi.fn((event: string, handler: (data: unknown) => void) => {
          bridgeHandlers[event] = handler
          return vi.fn()
        }),
        invoke: vi.fn(),
      },
      workspace: { list: workspaceList },
      project: { create: projectCreate },
    }
    window.history.replaceState({}, '', '/?repoRoot=/repo')
  })

  it('renders the board as the home surface', async () => {
    render(<App />)
    expect(screen.getByText('SpecKit Pilot')).toBeTruthy()
    await waitFor(() => expect(screen.getByText(/create your first card/i)).toBeTruthy())
  })

  it('opens the New card modal, creates a card, and cancels', async () => {
    render(<App />)
    await waitFor(() => screen.getByText(/new card/i))
    fireEvent.click(screen.getByText(/new card/i))
    expect(screen.getByRole('dialog', { name: 'New card' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Card title'), { target: { value: 'Fresh card' } })
    fireEvent.click(screen.getByText('Create card'))
    await waitFor(() =>
      expect(mockCardCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          repoRoot: '/repo',
          brief: expect.objectContaining({ title: 'Fresh card' }),
        })
      )
    )
    // reopen and cancel
    fireEvent.click(screen.getByText(/new card/i))
    fireEvent.click(screen.getByText('Cancel'))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New card' })).toBeNull())
  })

  it('opens and closes the Import modal', async () => {
    render(<App />)
    await waitFor(() => screen.getByText(/import ticket/i))
    fireEvent.click(screen.getByText(/import ticket/i))
    await waitFor(() => screen.getByRole('dialog', { name: 'Import ticket' }))
    fireEvent.click(screen.getByLabelText('Close'))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Import ticket' })).toBeNull())
  })

  it('shows settings and returns to the board', async () => {
    render(<App />)
    await waitFor(() => screen.getByLabelText('Settings'))
    fireEvent.click(screen.getByLabelText('Settings'))
    const back = await screen.findByText(/back to board/i)
    fireEvent.click(back)
    await waitFor(() => expect(screen.getByText(/create your first card/i)).toBeTruthy())
  })

  it('opens a card detail drawer and closes it', async () => {
    mockCardList.mockResolvedValue({ cards: [card()] })
    render(<App />)
    await waitFor(() => screen.getByText('Card A'))
    fireEvent.click(screen.getByText('Card A'))
    await waitFor(() => screen.getByRole('dialog', { name: 'Card detail' }))
    fireEvent.click(screen.getByLabelText('Close'))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Card detail' })).toBeNull())
  })

  it('mirrors a dispatched worktree into the workspace project list', async () => {
    render(<App />)
    await waitFor(() => screen.getByText('SpecKit Pilot'))
    bridgeHandlers['speckit:dispatch-started']({
      featureDir: '/repo/specs/016-a',
      branchName: 'feature/a',
      worktreePath: '/repo/.wt/a',
    })
    await waitFor(() =>
      expect(projectCreate).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: 'w1', gitBranch: 'feature/a', isWorktree: true })
      )
    )
  })

  it('closes the open card drawer on workspace change', async () => {
    mockCardList.mockResolvedValue({ cards: [card()] })
    render(<App />)
    await waitFor(() => screen.getByText('Card A'))
    fireEvent.click(screen.getByText('Card A'))
    await waitFor(() => screen.getByRole('dialog', { name: 'Card detail' }))
    bridgeHandlers['workspace:changed']({ repoRoot: '/other' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Card detail' })).toBeNull())
  })
})
