import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { createInitialState } from '../../src/state/state-persistence.js'

const mockCardList = vi.fn()
const mockCardCreate = vi.fn()
const mockTicketList = vi.fn()
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
    ticketList: mockTicketList,
    credentialsStatus: vi.fn().mockResolvedValue({ connected: false }),
    credentialsSet: vi.fn().mockResolvedValue({ ok: true }),
    onStateChanged: mockOnStateChanged,
    onPermissionsChanged: vi.fn().mockReturnValue(vi.fn()),
    permissionsList: vi.fn().mockResolvedValue({ pending: [] }),
    permissionResolve: vi.fn().mockResolvedValue({ ok: true }),
    permissionHandBack: vi.fn().mockResolvedValue({ ok: true }),
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
    mockTicketList.mockResolvedValue({ tickets: [] })
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

  it('auto-imports assigned tickets that are not already on the board', async () => {
    mockCardList.mockResolvedValue({ cards: [] })
    mockTicketList.mockResolvedValue({
      tickets: [
        { source: 'linear', key: 'TAV-1', title: 'First', sourceUrl: 'https://l/TAV-1' },
        { source: 'linear', key: 'TAV-2', title: 'Second', sourceUrl: 'https://l/TAV-2' },
      ],
    })
    render(<App />)
    await waitFor(() => expect(mockCardCreate).toHaveBeenCalledTimes(2))
    expect(mockCardCreate).toHaveBeenCalledWith(
      expect.objectContaining({ ticket: expect.objectContaining({ key: 'TAV-1' }) })
    )
  })

  it('does not re-import tickets already on the board', async () => {
    mockCardList.mockResolvedValue({
      cards: [{ ...card(), source: 'linear', sourceKey: 'TAV-1' }],
    })
    mockTicketList.mockResolvedValue({
      tickets: [{ source: 'linear', key: 'TAV-1', title: 'First', sourceUrl: 'https://l/TAV-1' }],
    })
    render(<App />)
    await waitFor(() => expect(mockTicketList).toHaveBeenCalled())
    expect(mockCardCreate).not.toHaveBeenCalled()
  })

  it('re-runs the reconcile when Import ticket is clicked', async () => {
    render(<App />)
    await waitFor(() => expect(mockTicketList).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByText(/import ticket/i))
    await waitFor(() => expect(mockTicketList).toHaveBeenCalledTimes(2))
  })

  it('still renders the board when the ticket fetch fails', async () => {
    mockTicketList.mockResolvedValue({ error: 'no creds' })
    render(<App />)
    await waitFor(() => expect(screen.getByText(/create your first card/i)).toBeTruthy())
    expect(mockCardCreate).not.toHaveBeenCalled()
  })

  it('disables the Import ticket button while a reconcile is in flight', async () => {
    let resolveTickets!: (v: { tickets: unknown[] }) => void
    mockTicketList.mockReturnValue(
      new Promise((resolve) => {
        resolveTickets = resolve
      })
    )
    render(<App />)
    const button = screen.getByRole('button', { name: /importing/i })
    expect(button.hasAttribute('disabled')).toBe(true)
    expect(button.getAttribute('aria-busy')).toBe('true')
    resolveTickets({ tickets: [] })
    await waitFor(() => expect(screen.getByText(/import ticket/i)).toBeTruthy())
  })

  it('skips auto-load when no workspace is open', async () => {
    window.history.replaceState({}, '', '/')
    render(<App />)
    await waitFor(() => screen.getByText('SpecKit Pilot'))
    expect(mockTicketList).not.toHaveBeenCalled()
  })

  it('recovers the Import button when a reconcile call rejects', async () => {
    mockTicketList.mockRejectedValue(new Error('boom'))
    render(<App />)
    // The rejection is swallowed; the button returns to its idle, enabled state.
    await waitFor(() => {
      const button = screen.getByRole('button', { name: /import ticket/i })
      expect(button.hasAttribute('disabled')).toBe(false)
    })
    expect(screen.getByText(/create your first card/i)).toBeTruthy()
  })

  it('re-runs the reconcile for a new workspace after workspace:changed', async () => {
    render(<App />)
    await waitFor(() => expect(mockTicketList).toHaveBeenCalledTimes(1))
    bridgeHandlers['workspace:changed']({ repoRoot: '/other' })
    await waitFor(() => expect(mockTicketList).toHaveBeenCalledTimes(2))
    expect(mockCardList).toHaveBeenCalledWith({ repoRoot: '/other' })
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
