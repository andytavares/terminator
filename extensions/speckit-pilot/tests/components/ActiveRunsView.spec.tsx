import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import type { PhaseId, PhaseState, PilotState } from '../../src/types/speckit.types.js'
import { PHASE_ORDER, DEFAULT_SETTINGS } from '../../src/types/speckit.types.js'

const mockPilotState = vi.fn()
const mockOnStateChanged = vi.fn()

vi.mock('../../src/types/electron.js', () => ({
  getSpeckitAPI: () => ({
    pilotState: mockPilotState,
    onStateChanged: mockOnStateChanged,
  }),
}))

function makePhases(): Record<PhaseId, PhaseState> {
  return Object.fromEntries(
    PHASE_ORDER.map((id) => [
      id,
      {
        id,
        status: 'locked' as const,
        approvedHash: null,
        approvedAt: null,
        approvedBy: null,
        lastRunId: null,
        lastRunAt: null,
        artifactPaths: [],
        feedback: null,
        batchIndex: null,
      },
    ])
  ) as Record<PhaseId, PhaseState>
}

function makeState(featureDir: string, overrides?: Partial<PilotState>): PilotState {
  return {
    version: 2,
    featureDir,
    ticket: { source: 'linear', key: 'ENG-1', title: 'Build auth', sourceUrl: 'https://l/1' },
    run: {
      status: 'running',
      startedAt: new Date().toISOString(),
      completedAt: null,
      autonomyLevel: 'standard',
    },
    queuePosition: 'active',
    worktreePath: '/repo/.wt/eng-1',
    branchName: 'feature/eng-1',
    prUrl: null,
    phases: makePhases(),
    settings: DEFAULT_SETTINGS,
    ...overrides,
  } as PilotState
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPilotState.mockResolvedValue({ notFound: true })
  mockOnStateChanged.mockReturnValue(vi.fn())
})

import { ActiveRunsView } from '../../src/components/ActiveRunsView.js'

describe('ActiveRunsView', () => {
  it('renders empty state when no active runs', async () => {
    render(<ActiveRunsView activeRunDirs={[]} workspacePath="/repo" onSelect={() => {}} />)
    await waitFor(() => {
      expect(screen.getByText(/no active runs/i)).toBeTruthy()
    })
  })

  it('renders one row per active run', async () => {
    const dirs = ['/repo/specs/001-eng-1', '/repo/specs/002-eng-2']
    mockPilotState.mockResolvedValueOnce({ state: makeState(dirs[0]) }).mockResolvedValueOnce({
      state: makeState(dirs[1], {
        ticket: { source: 'linear', key: 'ENG-2', title: 'Add tests', sourceUrl: 'https://l/2' },
      }),
    })

    render(<ActiveRunsView activeRunDirs={dirs} workspacePath="/repo" onSelect={() => {}} />)

    await waitFor(() => {
      expect(screen.getByText('001-eng-1')).toBeTruthy()
      expect(screen.getByText('002-eng-2')).toBeTruthy()
    })
  })

  it('shows ticket key and title in each row', async () => {
    mockPilotState.mockResolvedValue({ state: makeState('/repo/specs/001-eng-1') })
    render(
      <ActiveRunsView
        activeRunDirs={['/repo/specs/001-eng-1']}
        workspacePath="/repo"
        onSelect={() => {}}
      />
    )
    await waitFor(() => {
      expect(screen.getByText(/ENG-1 · Build auth/)).toBeTruthy()
    })
  })

  it('calls onSelect with featureDir when row is clicked', async () => {
    const onSelect = vi.fn()
    mockPilotState.mockResolvedValue({ state: makeState('/repo/specs/001-eng-1') })
    render(
      <ActiveRunsView
        activeRunDirs={['/repo/specs/001-eng-1']}
        workspacePath="/repo"
        onSelect={onSelect}
      />
    )
    await waitFor(() => screen.getByText('001-eng-1'))
    fireEvent.click(screen.getByText('001-eng-1'))
    expect(onSelect).toHaveBeenCalledWith('/repo/specs/001-eng-1')
  })

  it('updates a row when speckit:state-changed fires for that featureDir', async () => {
    let stateChangedHandler: ((data: unknown) => void) | null = null
    mockOnStateChanged.mockImplementation((handler) => {
      stateChangedHandler = handler
      return vi.fn()
    })

    const featureDir = '/repo/specs/001-eng-1'
    const initialState = makeState(featureDir)
    mockPilotState.mockResolvedValue({ state: initialState })

    render(
      <ActiveRunsView activeRunDirs={[featureDir]} workspacePath="/repo" onSelect={() => {}} />
    )
    await waitFor(() => screen.getByText('001-eng-1'))

    // Fire a state change with a different ticket title
    const updatedState = makeState(featureDir, {
      ticket: { source: 'linear', key: 'ENG-1', title: 'Updated title', sourceUrl: 'https://l/1' },
    })
    stateChangedHandler!({ state: updatedState })

    await waitFor(() => {
      expect(screen.getByText(/ENG-1 · Updated title/)).toBeTruthy()
    })
  })

  it('subscribes to onStateChanged on mount', async () => {
    render(
      <ActiveRunsView
        activeRunDirs={['/repo/specs/001']}
        workspacePath="/repo"
        onSelect={() => {}}
      />
    )
    await waitFor(() => expect(mockOnStateChanged).toHaveBeenCalledOnce())
  })
})
