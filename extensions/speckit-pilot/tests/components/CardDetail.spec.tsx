import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { createInitialState } from '../../src/state/state-persistence.js'

const mockPilotState = vi.fn()
const mockCardUpdate = vi.fn()
const mockCardHandoff = vi.fn()
const mockCardReset = vi.fn()
const mockCommentList = vi.fn().mockResolvedValue({ comments: [] })
const mockHistoryLoad = vi.fn().mockResolvedValue({ entries: [] })
const mockArtifactList = vi.fn().mockResolvedValue({ artifacts: [] })

vi.mock('../../src/types/electron.js', () => ({
  getSpeckitAPI: () => ({
    pilotState: mockPilotState,
    cardUpdate: mockCardUpdate,
    cardHandoff: mockCardHandoff,
    cardReset: mockCardReset,
    commentList: mockCommentList,
    historyLoad: mockHistoryLoad,
    artifactList: mockArtifactList,
  }),
}))

// RunDashboard subscribes to live run events via its own API surface; stub it so
// these tests focus on CardDetail's handoff/reset controls.
vi.mock('../../src/components/RunDashboard.js', () => ({
  RunDashboard: () => null,
}))

import { CardDetail } from '../../src/components/CardDetail.js'

describe('CardDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCommentList.mockResolvedValue({ comments: [] })
    mockHistoryLoad.mockResolvedValue({ entries: [] })
    mockArtifactList.mockResolvedValue({ artifacts: [] })
    mockCardHandoff.mockResolvedValue({ ok: true, dispatched: true, queued: false })
    mockCardReset.mockResolvedValue({ ok: true, state: createInitialState('/repo/specs/x') })
    mockCardUpdate.mockResolvedValue({ ok: true })
    const state = createInitialState('/repo/specs/x')
    state.card.title = 'My Card'
    mockPilotState.mockResolvedValue({ state })
    ;(window as unknown as Record<string, unknown>).electronAPI = {
      git: {
        listBranches: vi.fn().mockResolvedValue({
          branches: [
            { name: 'main', isCurrent: true, isRemote: false },
            { name: 'dev', isCurrent: false, isRemote: false },
          ],
        }),
      },
    }
  })

  it('shows the card title and Brief tab by default', async () => {
    render(<CardDetail featureDir="/repo/specs/x" workspacePath="/repo" onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'My Card' })).toBeTruthy())
    expect((screen.getByLabelText('Card title') as HTMLInputElement).value).toBe('My Card')
  })

  it('shows a handoff CTA on the Phases tab for a backlog card', async () => {
    render(<CardDetail featureDir="/repo/specs/x" workspacePath="/repo" onClose={vi.fn()} />)
    await waitFor(() => screen.getByRole('heading', { name: 'My Card' }))
    fireEvent.click(screen.getByRole('button', { name: 'Phases' }))
    const handoff = await screen.findByText('Hand off to agent')
    // base branch selector defaults to the current branch
    await waitFor(() =>
      expect((screen.getByLabelText('Base branch') as HTMLSelectElement).value).toBe('main')
    )
    fireEvent.click(handoff)
    await waitFor(() =>
      expect(mockCardHandoff).toHaveBeenCalledWith({
        featureDir: '/repo/specs/x',
        workspacePath: '/repo',
        baseBranch: 'main',
        mode: 'speckit',
      })
    )
  })

  it('lets the user choose a different base branch before handoff', async () => {
    render(<CardDetail featureDir="/repo/specs/x" workspacePath="/repo" onClose={vi.fn()} />)
    await waitFor(() => screen.getByRole('heading', { name: 'My Card' }))
    fireEvent.click(screen.getByRole('button', { name: 'Phases' }))
    const select = (await screen.findByLabelText('Base branch')) as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'dev' } })
    fireEvent.click(screen.getByText('Hand off to agent'))
    await waitFor(() =>
      expect(mockCardHandoff).toHaveBeenCalledWith({
        featureDir: '/repo/specs/x',
        workspacePath: '/repo',
        baseBranch: 'dev',
        mode: 'speckit',
      })
    )
  })

  it('hands off in quick mode when the Quick fix toggle is checked', async () => {
    render(<CardDetail featureDir="/repo/specs/x" workspacePath="/repo" onClose={vi.fn()} />)
    await waitFor(() => screen.getByRole('heading', { name: 'My Card' }))
    fireEvent.click(screen.getByRole('button', { name: 'Phases' }))
    const toggle = await screen.findByText(/Quick fix/)
    fireEvent.click(toggle.previousSibling as HTMLInputElement)
    fireEvent.click(screen.getByText('Hand off to agent'))
    await waitFor(() =>
      expect(mockCardHandoff).toHaveBeenCalledWith(expect.objectContaining({ mode: 'quick' }))
    )
  })

  it('confirms then resets a card that has a run', async () => {
    const state = createInitialState('/repo/specs/x')
    state.card.title = 'My Card'
    state.run = {
      status: 'running',
      startedAt: 't',
      completedAt: null,
      autonomyLevel: 'standard',
    }
    mockPilotState.mockResolvedValue({ state })

    render(<CardDetail featureDir="/repo/specs/x" workspacePath="/repo" onClose={vi.fn()} />)
    await waitFor(() => screen.getByRole('heading', { name: 'My Card' }))
    fireEvent.click(screen.getByRole('button', { name: 'Phases' }))
    // First click reveals the confirm; the destructive action is gated behind it.
    fireEvent.click(await screen.findByText('Reset / start over'))
    expect(mockCardReset).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Reset everything'))
    await waitFor(() =>
      expect(mockCardReset).toHaveBeenCalledWith({
        featureDir: '/repo/specs/x',
        workspacePath: '/repo',
      })
    )
  })

  it('switches to the Activity tab', async () => {
    render(<CardDetail featureDir="/repo/specs/x" workspacePath="/repo" onClose={vi.fn()} />)
    await waitFor(() => screen.getByRole('heading', { name: 'My Card' }))
    fireEvent.click(screen.getByRole('button', { name: 'Activity' }))
    await waitFor(() => expect(mockCommentList).toHaveBeenCalled())
  })

  it('calls onClose', async () => {
    const onClose = vi.fn()
    render(<CardDetail featureDir="/repo/specs/x" workspacePath="/repo" onClose={onClose} />)
    await waitFor(() => screen.getByLabelText('Close'))
    fireEvent.click(screen.getByLabelText('Close'))
    expect(onClose).toHaveBeenCalled()
  })
})
