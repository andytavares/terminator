import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'

const mockPilotState = vi.fn()
const mockOnStateChanged = vi.fn()
const mockOnRunOutput = vi.fn()
const mockPhaseApprove = vi.fn()
const mockPhaseReject = vi.fn()
const mockPhaseRevoke = vi.fn()
const mockPhaseRequestChanges = vi.fn()
const mockPhaseComment = vi.fn()
const mockFileWrite = vi.fn()
const mockArtifactRead = vi.fn()
const mockRunCancel = vi.fn()
const mockHistoryLoad = vi.fn()

vi.mock('../../src/types/electron.js', () => ({
  getSpeckitAPI: () => ({
    pilotState: mockPilotState,
    onStateChanged: mockOnStateChanged,
    onRunOutput: mockOnRunOutput,
    phaseApprove: mockPhaseApprove,
    phaseReject: mockPhaseReject,
    phaseRevoke: mockPhaseRevoke,
    phaseRequestChanges: mockPhaseRequestChanges,
    phaseComment: mockPhaseComment,
    fileWrite: mockFileWrite,
    artifactRead: mockArtifactRead,
    historyLoad: mockHistoryLoad,
    runCancel: mockRunCancel,
    selfReviewRead: vi.fn().mockResolvedValue({ notFound: true, error: 'no self-review' }),
    openPr: vi.fn().mockResolvedValue({ prUrl: 'https://github.com/owner/repo/pull/1' }),
    onCheckinReady: vi.fn().mockReturnValue(vi.fn()),
    checkinDecision: vi.fn().mockResolvedValue({ ok: true }),
  }),
}))

import { RunDashboard } from '../../src/components/RunDashboard.js'
import type { PhaseId, PhaseState, PilotState } from '../../src/types/speckit.types.js'
import { PHASE_ORDER, DEFAULT_SETTINGS } from '../../src/types/speckit.types.js'

function makePhases(
  overrides: Partial<Record<PhaseId, Partial<PhaseState>>> = {}
): Record<PhaseId, PhaseState> {
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
        ...overrides[id],
      },
    ])
  ) as Record<PhaseId, PhaseState>
}

function makeState(overrides?: Partial<PilotState>): PilotState {
  return {
    version: 2,
    featureDir: '/repo/specs/001',
    ticket: { source: 'linear', key: 'ENG-1', title: 'Test', sourceUrl: 'https://l/1' },
    run: {
      status: 'running',
      startedAt: '2026-01-01T00:00:00Z',
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
  }
}

describe('RunDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOnStateChanged.mockReturnValue(vi.fn())
    mockOnRunOutput.mockReturnValue(vi.fn())
    mockPhaseApprove.mockResolvedValue({ state: makeState() })
    mockPhaseReject.mockResolvedValue({ state: makeState() })
    mockPhaseRevoke.mockResolvedValue({ state: makeState() })
    mockPhaseRequestChanges.mockResolvedValue({ state: makeState() })
    mockPhaseComment.mockResolvedValue({ ok: true, state: makeState() })
    mockFileWrite.mockResolvedValue({ ok: true })
    mockArtifactRead.mockResolvedValue({ current: null, approved: null })
    mockPilotState.mockResolvedValue({ state: makeState() })
    mockRunCancel.mockResolvedValue({ ok: true })
    mockHistoryLoad.mockResolvedValue({ entries: [] })
  })

  it('renders PhaseRail with 10 nodes', async () => {
    render(<RunDashboard featureDir="/repo/specs/001" workspacePath="/repo" />)
    await waitFor(() => {
      const nodes = screen.getAllByRole('listitem')
      expect(nodes.length).toBeGreaterThanOrEqual(10)
    })
  })

  it('renders run console', async () => {
    render(<RunDashboard featureDir="/repo/specs/001" workspacePath="/repo" />)
    await waitFor(() => {
      expect(screen.getByLabelText(/run console/i)).toBeTruthy()
    })
  })

  it('shows GatePanel when active phase is awaiting_review', async () => {
    const state = makeState({ phases: makePhases({ specify: { status: 'awaiting_review' } }) })
    mockPilotState.mockResolvedValue({ state })
    render(<RunDashboard featureDir="/repo/specs/001" workspacePath="/repo" />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /approve/i })).toBeTruthy()
    })
  })

  it('does not show GatePanel when no phase is awaiting review', async () => {
    mockPilotState.mockResolvedValue({ state: makeState() })
    render(<RunDashboard featureDir="/repo/specs/001" workspacePath="/repo" />)
    await waitFor(() => {
      const approveBtn = screen.queryByRole('button', { name: /approve/i })
      expect(approveBtn).toBeNull()
    })
  })

  it('subscribes to onRunOutput on mount', async () => {
    render(<RunDashboard featureDir="/repo/specs/001" workspacePath="/repo" />)
    await waitFor(() => expect(mockOnRunOutput).toHaveBeenCalledOnce())
  })

  it('subscribes to onStateChanged on mount', async () => {
    render(<RunDashboard featureDir="/repo/specs/001" workspacePath="/repo" />)
    await waitFor(() => expect(mockOnStateChanged).toHaveBeenCalledOnce())
  })

  it('shows Stop button when run status is running', async () => {
    mockPilotState.mockResolvedValue({
      state: makeState({
        run: {
          status: 'running',
          startedAt: '2026-01-01T00:00:00Z',
          completedAt: null,
          autonomyLevel: 'standard',
        },
      }),
    })
    render(<RunDashboard featureDir="/repo/specs/001" workspacePath="/repo" />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /stop run/i })).toBeTruthy()
    })
  })

  it('does not show Stop button when run is not active', async () => {
    mockPilotState.mockResolvedValue({ state: makeState({ run: null }) })
    render(<RunDashboard featureDir="/repo/specs/001" workspacePath="/repo" />)
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /stop run/i })).toBeNull()
    })
  })

  it('calls runCancel when Stop button is clicked', async () => {
    const { fireEvent } = await import('@testing-library/react')
    mockPilotState.mockResolvedValue({ state: makeState() })
    render(<RunDashboard featureDir="/repo/specs/001" workspacePath="/repo" />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /stop run/i })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: /stop run/i }))
    await waitFor(() => {
      expect(mockRunCancel).toHaveBeenCalledWith({
        featureDir: '/repo/specs/001',
        workspacePath: '/repo',
        deleteWorktree: false,
      })
    })
  })

  it('renders back button when onBack prop is provided', async () => {
    render(<RunDashboard featureDir="/repo/specs/001" workspacePath="/repo" onBack={() => {}} />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /back to runs list/i })).toBeTruthy()
    })
  })

  it('does not render back button when onBack prop is omitted', async () => {
    render(<RunDashboard featureDir="/repo/specs/001" workspacePath="/repo" />)
    await waitFor(() => expect(mockOnStateChanged).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /back to runs list/i })).toBeNull()
  })

  it('calls onBack when back button is clicked', async () => {
    const { fireEvent } = await import('@testing-library/react')
    const onBack = vi.fn()
    render(<RunDashboard featureDir="/repo/specs/001" workspacePath="/repo" onBack={onBack} />)
    await waitFor(() => screen.getByRole('button', { name: /back to runs list/i }))
    fireEvent.click(screen.getByRole('button', { name: /back to runs list/i }))
    expect(onBack).toHaveBeenCalledOnce()
  })
})
