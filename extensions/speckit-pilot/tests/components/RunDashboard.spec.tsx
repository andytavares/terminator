import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import React from 'react'

const mockPilotState = vi.fn()
const mockOnStateChanged = vi.fn()
const mockOnRunOutput = vi.fn()
const mockPhaseApprove = vi.fn()
const mockPhaseReject = vi.fn()
const mockPhaseRevoke = vi.fn()
const mockPhaseSkip = vi.fn()
const mockPhaseUnskip = vi.fn()
const mockSupervisionSnapshot = vi.fn()
const mockRunTranscript = vi.fn()
const mockRunTerminal = vi.fn()
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
    phaseSkip: mockPhaseSkip,
    phaseUnskip: mockPhaseUnskip,
    // Selecting a phase other than the running one loads its persisted output.
    runOutputRead: vi.fn().mockResolvedValue({ lines: [] }),
    supervisionSnapshot: mockSupervisionSnapshot,
    runTranscript: mockRunTranscript,
    runTerminal: mockRunTerminal,
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
    mockSupervisionSnapshot.mockResolvedValue({
      runs: [],
      review: [],
      backpressure: { allowed: true, unreviewed: 0, limit: 3 },
    })
    mockRunTranscript.mockResolvedValue({ lines: [] })
    mockRunTerminal.mockResolvedValue({ ok: true })
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

describe('a phase that is not simply running', () => {
  // Not every card needs every phase, and the alternative to offering a skip is
  // approving something you did not read.

  beforeEach(() => {
    mockPhaseSkip.mockResolvedValue({ state: makeState() })
    mockPhaseUnskip.mockResolvedValue({ state: makeState() })
  })

  it('skips the phase at the gate', async () => {
    mockPilotState.mockResolvedValue({
      state: makeState({ phases: makePhases({ specify: { status: 'awaiting_review' } }) }),
    })
    render(<RunDashboard featureDir="/repo/specs/001" workspacePath="/repo" />)
    fireEvent.click(await screen.findByRole('button', { name: /skip phase/i }))
    await waitFor(() =>
      expect(mockPhaseSkip).toHaveBeenCalledWith({
        featureDir: '/repo/specs/001',
        phase: 'specify',
      })
    )
  })

  it('offers a way back from a skipped phase', async () => {
    // A decision you cannot undo is one you make less often than you should.
    mockPilotState.mockResolvedValue({
      state: makeState({
        phases: makePhases({ constitution: { status: 'skipped' } }),
      }),
    })
    render(<RunDashboard featureDir="/repo/specs/001" workspacePath="/repo" />)
    // Selected in the rail, which is how you look at a phase that is not the
    // one currently running.
    fireEvent.click(await screen.findByRole('button', { name: 'Constitution' }))
    fireEvent.click(await screen.findByRole('button', { name: /unskip/i }))
    await waitFor(() =>
      expect(mockPhaseUnskip).toHaveBeenCalledWith({
        featureDir: '/repo/specs/001',
        phase: 'constitution',
      })
    )
  })

  it('says when what is on disk is not what was approved', async () => {
    mockPilotState.mockResolvedValue({
      state: makeState({ phases: makePhases({ constitution: { status: 'modified' } }) }),
    })
    render(<RunDashboard featureDir="/repo/specs/001" workspacePath="/repo" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Constitution' }))
    expect(await screen.findByText(/not what was approved/i)).toBeTruthy()
  })

  it('lets you approve it as it now stands', async () => {
    mockPhaseApprove.mockResolvedValue({ state: makeState() })
    mockPilotState.mockResolvedValue({
      state: makeState({ phases: makePhases({ constitution: { status: 'modified' } }) }),
    })
    render(<RunDashboard featureDir="/repo/specs/001" workspacePath="/repo" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Constitution' }))
    fireEvent.click(await screen.findByRole('button', { name: /approve as it stands/i }))
    await waitFor(() =>
      expect(mockPhaseApprove).toHaveBeenCalledWith(
        expect.objectContaining({ phase: 'constitution' })
      )
    )
  })
})

describe('a phase running in a terminal', () => {
  // A supervised phase writes nothing to `speckit:run-output` — it runs in a
  // terminal and its output goes there. The console used to sit on "Waiting for
  // output…" for the whole run.

  const run = {
    sessionId: 'session-1',
    featureDir: '/repo/specs/001',
    phase: 'specify',
    branch: 'feat/red-text',
    worktreePath: '/wt/a',
    terminalSessionId: 'terminal-1',
    state: 'working' as const,
    stateSince: 1,
    turns: 1,
    asked: 0,
    diff: { files: 0, added: 0, removed: 0 },
  }

  beforeEach(() => {
    mockPilotState.mockResolvedValue({ state: makeState() })
    mockSupervisionSnapshot.mockResolvedValue({
      runs: [run],
      review: [],
      backpressure: { allowed: true, unreviewed: 0, limit: 3 },
    })
  })

  it('shows what the agent said, read from its transcript', async () => {
    mockRunTranscript.mockResolvedValue({
      lines: [{ role: 'assistant', text: 'Reading the spec…', at: 1 }],
    })
    render(<RunDashboard featureDir="/repo/specs/001" workspacePath="/repo" />)
    expect(await screen.findByText(/Reading the spec…/)).toBeTruthy()
  })

  it('offers a way into the session rather than only describing it', async () => {
    render(<RunDashboard featureDir="/repo/specs/001" workspacePath="/repo" />)
    fireEvent.click(await screen.findByRole('button', { name: /open the terminal/i }))
    await waitFor(() => expect(mockRunTerminal).toHaveBeenCalledWith({ sessionId: 'session-1' }))
  })

  it('says the output is in the terminal when it has said nothing yet', async () => {
    // Not "Waiting for output…", which never resolves for a supervised run.
    render(<RunDashboard featureDir="/repo/specs/001" workspacePath="/repo" />)
    expect(await screen.findByText(/open it above to watch or take over/i)).toBeTruthy()
  })

  it('names the branch, so you know which terminal you are being sent to', async () => {
    render(<RunDashboard featureDir="/repo/specs/001" workspacePath="/repo" />)
    expect(await screen.findByText(/feat\/red-text/)).toBeTruthy()
  })
})
