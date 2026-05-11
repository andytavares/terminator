import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { ApprovalPanel } from '../../src/components/ApprovalPanel.js'
import type { HistoryEntry, PhaseState } from '../../src/types/speckit.types.js'

function makePhaseState(overrides?: Partial<PhaseState>): PhaseState {
  return {
    id: 'plan',
    status: 'awaiting_review',
    approvedHash: null,
    approvedAt: null,
    approvedBy: null,
    lastRunId: null,
    lastRunAt: null,
    artifactPaths: [],
    ...overrides,
  }
}

const noop = vi.fn().mockResolvedValue(undefined)

describe('ApprovalPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders review card for awaiting_review status', () => {
    render(
      <ApprovalPanel
        phase="plan"
        phaseState={makePhaseState()}
        phaseLabel="Plan"
        phaseCommand="/speckit-plan"
        recentHistory={[]}
        onApprove={noop}
        onReject={noop}
        onRevoke={noop}
        onOpenDiff={noop}
      />
    )
    expect(screen.getByText(/awaiting review/i)).toBeTruthy()
    expect(screen.getByText('Review required')).toBeTruthy()
  })

  it('shows Approve & continue button for awaiting_review', () => {
    render(
      <ApprovalPanel
        phase="plan"
        phaseState={makePhaseState()}
        phaseLabel="Plan"
        phaseCommand="/speckit-plan"
        recentHistory={[]}
        onApprove={noop}
        onReject={noop}
        onRevoke={noop}
        onOpenDiff={noop}
      />
    )
    expect(screen.getAllByText('Approve & continue').length).toBeGreaterThan(0)
  })

  it('calls onApprove when Approve & continue is clicked', async () => {
    const onApprove = vi.fn().mockResolvedValue(undefined)
    render(
      <ApprovalPanel
        phase="plan"
        phaseState={makePhaseState()}
        phaseLabel="Plan"
        phaseCommand="/speckit-plan"
        recentHistory={[]}
        onApprove={onApprove}
        onReject={noop}
        onRevoke={noop}
        onOpenDiff={noop}
      />
    )
    fireEvent.click(screen.getAllByText('Approve & continue')[0])
    await waitFor(() => {
      expect(onApprove).toHaveBeenCalledWith(undefined)
    })
  })

  it('shows reject form when Reject & rerun is clicked', async () => {
    render(
      <ApprovalPanel
        phase="plan"
        phaseState={makePhaseState()}
        phaseLabel="Plan"
        phaseCommand="/speckit-plan"
        recentHistory={[]}
        onApprove={noop}
        onReject={noop}
        onRevoke={noop}
        onOpenDiff={noop}
      />
    )
    fireEvent.click(screen.getAllByText('Reject & rerun')[0])
    await waitFor(() => {
      expect(screen.getByText('Reason for rejection (required)')).toBeTruthy()
    })
  })

  it('calls onReject with reason when reject form is submitted', async () => {
    const onReject = vi.fn().mockResolvedValue(undefined)
    render(
      <ApprovalPanel
        phase="plan"
        phaseState={makePhaseState()}
        phaseLabel="Plan"
        phaseCommand="/speckit-plan"
        recentHistory={[]}
        onApprove={noop}
        onReject={onReject}
        onRevoke={noop}
        onOpenDiff={noop}
      />
    )
    fireEvent.click(screen.getAllByText('Reject & rerun')[0])
    await waitFor(() => screen.getByPlaceholderText(/describe what needs to change/i))
    fireEvent.change(screen.getByPlaceholderText(/describe what needs to change/i), {
      target: { value: 'The routing approach is wrong' },
    })
    fireEvent.click(
      screen.getAllByText('Reject & rerun')[screen.getAllByText('Reject & rerun').length - 1]
    )
    await waitFor(() => {
      expect(onReject).toHaveBeenCalledWith('The routing approach is wrong')
    })
  })

  it('reject button is disabled when no reason is entered', async () => {
    render(
      <ApprovalPanel
        phase="plan"
        phaseState={makePhaseState()}
        phaseLabel="Plan"
        phaseCommand="/speckit-plan"
        recentHistory={[]}
        onApprove={noop}
        onReject={noop}
        onRevoke={noop}
        onOpenDiff={noop}
      />
    )
    fireEvent.click(screen.getAllByText('Reject & rerun')[0])
    await waitFor(() => screen.getByPlaceholderText(/describe what needs to change/i))
    // The confirm reject button should be disabled
    const rejectButtons = screen.getAllByText('Reject & rerun')
    const lastBtn = rejectButtons[rejectButtons.length - 1] as HTMLButtonElement
    expect(lastBtn.disabled).toBe(true)
  })

  it('shows approved card for approved status', () => {
    render(
      <ApprovalPanel
        phase="plan"
        phaseState={makePhaseState({
          status: 'approved',
          approvedAt: '2026-01-01T00:00:00Z',
          approvedBy: 'Andrew',
        })}
        phaseLabel="Plan"
        phaseCommand="/speckit-plan"
        recentHistory={[]}
        onApprove={noop}
        onReject={noop}
        onRevoke={noop}
        onOpenDiff={noop}
      />
    )
    expect(screen.getByText(/Plan — approved/i)).toBeTruthy()
    expect(screen.getByText('Revoke approval')).toBeTruthy()
  })

  it('shows revoke confirmation form after clicking Revoke approval', async () => {
    render(
      <ApprovalPanel
        phase="plan"
        phaseState={makePhaseState({
          status: 'approved',
          approvedAt: '2026-01-01T00:00:00Z',
          approvedBy: 'Andrew',
        })}
        phaseLabel="Plan"
        phaseCommand="/speckit-plan"
        recentHistory={[]}
        onApprove={noop}
        onReject={noop}
        onRevoke={noop}
        onOpenDiff={noop}
      />
    )
    fireEvent.click(screen.getByText('Revoke approval'))
    await waitFor(() => {
      expect(screen.getByText(/Revoke approval\? Downstream/)).toBeTruthy()
    })
  })

  it('calls onRevoke when revoke is confirmed', async () => {
    const onRevoke = vi.fn().mockResolvedValue(undefined)
    render(
      <ApprovalPanel
        phase="plan"
        phaseState={makePhaseState({
          status: 'approved',
          approvedAt: '2026-01-01T00:00:00Z',
        })}
        phaseLabel="Plan"
        phaseCommand="/speckit-plan"
        recentHistory={[]}
        onApprove={noop}
        onReject={noop}
        onRevoke={onRevoke}
        onOpenDiff={noop}
      />
    )
    fireEvent.click(screen.getByText('Revoke approval'))
    await waitFor(() => screen.getByText(/Revoke approval\? Downstream/))
    const allRevokeButtons = screen.getAllByText('Revoke approval')
    fireEvent.click(allRevokeButtons[allRevokeButtons.length - 1])
    await waitFor(() => {
      expect(onRevoke).toHaveBeenCalledWith(undefined)
    })
  })

  it('shows recent activity when history entries are provided', () => {
    const history: HistoryEntry[] = [
      {
        ts: new Date(Date.now() - 120000).toISOString(),
        actor: 'Andrew',
        action: 'approved',
        phase: 'specify',
        note: 'LGTM',
      },
    ]
    render(
      <ApprovalPanel
        phase="plan"
        phaseState={makePhaseState()}
        phaseLabel="Plan"
        phaseCommand="/speckit-plan"
        recentHistory={history}
        onApprove={noop}
        onReject={noop}
        onRevoke={noop}
        onOpenDiff={noop}
      />
    )
    expect(screen.getByText('Recent activity')).toBeTruthy()
    expect(screen.getByText(/Specify approved by Andrew/)).toBeTruthy()
  })

  it('calls onOpenDiff when Open artifact diff is clicked', async () => {
    const onOpenDiff = vi.fn()
    render(
      <ApprovalPanel
        phase="plan"
        phaseState={makePhaseState()}
        phaseLabel="Plan"
        phaseCommand="/speckit-plan"
        recentHistory={[]}
        onApprove={noop}
        onReject={noop}
        onRevoke={noop}
        onOpenDiff={onOpenDiff}
      />
    )
    fireEvent.click(screen.getByText('Open artifact diff'))
    expect(onOpenDiff).toHaveBeenCalledOnce()
  })

  it('shows gate decision section with note textarea', () => {
    render(
      <ApprovalPanel
        phase="plan"
        phaseState={makePhaseState()}
        phaseLabel="Plan"
        phaseCommand="/speckit-plan"
        recentHistory={[]}
        onApprove={noop}
        onReject={noop}
        onRevoke={noop}
        onOpenDiff={noop}
      />
    )
    expect(screen.getByText('Gate decision')).toBeTruthy()
    expect(screen.getByText('Auto-unlock next phase on approve')).toBeTruthy()
  })

  it('shows run_complete activity with correct description', () => {
    const history: HistoryEntry[] = [
      {
        ts: new Date().toISOString(),
        actor: 'agent',
        action: 'run_complete',
        phase: 'plan',
        note: 'Completed in 18.4s',
      },
    ]
    render(
      <ApprovalPanel
        phase="plan"
        phaseState={makePhaseState()}
        phaseLabel="Plan"
        phaseCommand="/speckit-plan"
        recentHistory={history}
        onApprove={noop}
        onReject={noop}
        onRevoke={noop}
        onOpenDiff={noop}
      />
    )
    expect(screen.getByText(/\/plan completed/)).toBeTruthy()
  })

  it('shows run_start activity', () => {
    const history: HistoryEntry[] = [
      { ts: new Date().toISOString(), actor: 'user', action: 'run_start', phase: 'clarify' },
    ]
    render(
      <ApprovalPanel
        phase="plan"
        phaseState={makePhaseState()}
        phaseLabel="Plan"
        phaseCommand="/speckit-plan"
        recentHistory={history}
        onApprove={noop}
        onReject={noop}
        onRevoke={noop}
        onOpenDiff={noop}
      />
    )
    expect(screen.getByText(/\/clarify started/)).toBeTruthy()
  })

  it('shows file_approved activity', () => {
    const history: HistoryEntry[] = [
      {
        ts: new Date().toISOString(),
        actor: 'user',
        action: 'file_approved',
        phase: 'implement',
        filePath: 'src/app.ts',
      },
    ]
    render(
      <ApprovalPanel
        phase="implement"
        phaseState={makePhaseState({ id: 'implement', status: 'awaiting_review' })}
        phaseLabel="Implement"
        phaseCommand="/speckit-implement"
        recentHistory={history}
        onApprove={noop}
        onReject={noop}
        onRevoke={noop}
        onOpenDiff={noop}
      />
    )
    expect(screen.getByText('File write approved')).toBeTruthy()
  })

  it('shows modified activity', () => {
    const history: HistoryEntry[] = [
      { ts: new Date().toISOString(), actor: 'user', action: 'modified', phase: 'plan' },
    ]
    render(
      <ApprovalPanel
        phase="plan"
        phaseState={makePhaseState({ status: 'modified' })}
        phaseLabel="Plan"
        phaseCommand="/speckit-plan"
        recentHistory={history}
        onApprove={noop}
        onReject={noop}
        onRevoke={noop}
        onOpenDiff={noop}
      />
    )
    expect(screen.getByText(/Plan artifact modified/)).toBeTruthy()
  })

  it('shows provenance section when lastRunAt is set', () => {
    render(
      <ApprovalPanel
        phase="plan"
        phaseState={makePhaseState({
          lastRunAt: '2026-01-01T00:00:00Z',
          lastRunId: 'run_abc123',
        })}
        phaseLabel="Plan"
        phaseCommand="/speckit-plan"
        recentHistory={[]}
        onApprove={noop}
        onReject={noop}
        onRevoke={noop}
        onOpenDiff={noop}
      />
    )
    expect(screen.getByText('Provenance')).toBeTruthy()
    expect(screen.getByText('run_abc123')).toBeTruthy()
  })

  it('cancels revoke flow when Cancel is clicked in revoke confirm', async () => {
    render(
      <ApprovalPanel
        phase="plan"
        phaseState={makePhaseState({
          status: 'approved',
          approvedAt: '2026-01-01T00:00:00Z',
          approvedBy: 'Andrew',
        })}
        phaseLabel="Plan"
        phaseCommand="/speckit-plan"
        recentHistory={[]}
        onApprove={noop}
        onReject={noop}
        onRevoke={noop}
        onOpenDiff={noop}
      />
    )
    fireEvent.click(screen.getByText('Revoke approval'))
    await waitFor(() => screen.getByText(/Revoke approval\? Downstream/))
    // Click the Cancel button inside the revoke confirm form
    const cancelBtns = screen.getAllByText('Cancel')
    fireEvent.click(cancelBtns[cancelBtns.length - 1])
    await waitFor(() => {
      expect(screen.queryByText(/Revoke approval\? Downstream/)).toBeFalsy()
    })
  })

  it('shows approved hash when approvedHash is present', () => {
    render(
      <ApprovalPanel
        phase="plan"
        phaseState={makePhaseState({
          status: 'approved',
          approvedAt: '2026-01-01T00:00:00Z',
          approvedBy: 'Andrew',
          approvedHash: 'abc1234567890',
        })}
        phaseLabel="Plan"
        phaseCommand="/speckit-plan"
        recentHistory={[]}
        onApprove={noop}
        onReject={noop}
        onRevoke={noop}
        onOpenDiff={noop}
      />
    )
    expect(screen.getByText('abc1234')).toBeTruthy()
  })

  it('shows file_skipped activity', () => {
    const history: HistoryEntry[] = [
      {
        ts: new Date().toISOString(),
        actor: 'user',
        action: 'file_skipped',
        phase: 'implement',
        filePath: 'src/utils.ts',
      },
    ]
    render(
      <ApprovalPanel
        phase="implement"
        phaseState={makePhaseState({ id: 'implement', status: 'awaiting_review' })}
        phaseLabel="Implement"
        phaseCommand="/speckit-implement"
        recentHistory={history}
        onApprove={noop}
        onReject={noop}
        onRevoke={noop}
        onOpenDiff={noop}
      />
    )
    expect(screen.getByText('File write skipped')).toBeTruthy()
  })

  it('shows run_failed activity', () => {
    const history: HistoryEntry[] = [
      {
        ts: new Date().toISOString(),
        actor: 'agent',
        action: 'run_failed',
        phase: 'plan',
        note: 'Timeout',
      },
    ]
    render(
      <ApprovalPanel
        phase="plan"
        phaseState={makePhaseState()}
        phaseLabel="Plan"
        phaseCommand="/speckit-plan"
        recentHistory={history}
        onApprove={noop}
        onReject={noop}
        onRevoke={noop}
        onOpenDiff={noop}
      />
    )
    expect(screen.getByText(/\/plan failed/)).toBeTruthy()
  })

  it('shows stale activity', () => {
    const history: HistoryEntry[] = [
      { ts: new Date().toISOString(), actor: 'system', action: 'stale', phase: 'tasks' },
    ]
    render(
      <ApprovalPanel
        phase="tasks"
        phaseState={makePhaseState({ id: 'tasks', status: 'stale' })}
        phaseLabel="Tasks"
        phaseCommand="/speckit-tasks"
        recentHistory={history}
        onApprove={noop}
        onReject={noop}
        onRevoke={noop}
        onOpenDiff={noop}
      />
    )
    expect(screen.getByText(/Tasks marked stale/)).toBeTruthy()
  })

  it('shows rejected activity', () => {
    const history: HistoryEntry[] = [
      {
        ts: new Date().toISOString(),
        actor: 'user',
        action: 'rejected',
        phase: 'plan',
        note: 'Needs rework',
      },
    ]
    render(
      <ApprovalPanel
        phase="plan"
        phaseState={makePhaseState()}
        phaseLabel="Plan"
        phaseCommand="/speckit-plan"
        recentHistory={history}
        onApprove={noop}
        onReject={noop}
        onRevoke={noop}
        onOpenDiff={noop}
      />
    )
    expect(screen.getByText(/Plan rejected/)).toBeTruthy()
  })

  it('shows revoked activity', () => {
    const history: HistoryEntry[] = [
      { ts: new Date().toISOString(), actor: 'user', action: 'revoked', phase: 'specify' },
    ]
    render(
      <ApprovalPanel
        phase="specify"
        phaseState={makePhaseState({ id: 'specify', status: 'stale' })}
        phaseLabel="Specify"
        phaseCommand="/speckit-specify"
        recentHistory={history}
        onApprove={noop}
        onReject={noop}
        onRevoke={noop}
        onOpenDiff={noop}
      />
    )
    expect(screen.getByText(/Specify approval revoked/)).toBeTruthy()
  })

  it('shows default activity for unknown action', () => {
    const history: HistoryEntry[] = [
      // @ts-expect-error testing unknown action
      { ts: new Date().toISOString(), actor: 'system', action: 'unknown_action', phase: 'plan' },
    ]
    render(
      <ApprovalPanel
        phase="plan"
        phaseState={makePhaseState()}
        phaseLabel="Plan"
        phaseCommand="/speckit-plan"
        recentHistory={history}
        onApprove={noop}
        onReject={noop}
        onRevoke={noop}
        onOpenDiff={noop}
      />
    )
    expect(screen.getByText('Plan')).toBeTruthy()
  })
})
