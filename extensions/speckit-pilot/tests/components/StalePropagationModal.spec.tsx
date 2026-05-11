import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { StalePropagationModal } from '../../src/components/StalePropagationModal.js'
import type { PhaseState } from '../../src/types/speckit.types.js'

function makePhaseState(overrides?: Partial<PhaseState>): PhaseState {
  return {
    id: 'tasks',
    status: 'stale',
    approvedHash: 'abc123',
    approvedAt: '2026-01-01T00:00:00Z',
    approvedBy: 'user',
    lastRunId: null,
    lastRunAt: null,
    artifactPaths: [],
    ...overrides,
  }
}

const noop = vi.fn().mockResolvedValue(undefined)

describe('StalePropagationModal', () => {
  it('renders the modal title', () => {
    render(
      <StalePropagationModal
        changedPhase="plan"
        changedPhaseLabel="Plan"
        stalePhases={[]}
        onReapproveAndQueue={noop}
        onReapproveOnly={noop}
        onRevert={noop}
        onDismiss={noop}
      />
    )
    expect(screen.getByText(/what do you want to do/i)).toBeTruthy()
  })

  it('renders stale phases in table', () => {
    const stalePhases = [
      {
        id: 'tasks' as const,
        label: 'Tasks',
        state: makePhaseState({ id: 'tasks' }),
        lastGeneratedAgainst: 'plan@v2',
        canRegenerate: true,
      },
      {
        id: 'analyze' as const,
        label: 'Analyze',
        state: makePhaseState({ id: 'analyze' }),
        lastGeneratedAgainst: 'tasks@v1',
        canRegenerate: false,
      },
    ]
    render(
      <StalePropagationModal
        changedPhase="plan"
        changedPhaseLabel="Plan"
        stalePhases={stalePhases}
        onReapproveAndQueue={noop}
        onReapproveOnly={noop}
        onRevert={noop}
        onDismiss={noop}
      />
    )
    expect(screen.getByText('Tasks')).toBeTruthy()
    expect(screen.getByText('Analyze')).toBeTruthy()
  })

  it('shows regenerate checkboxes for phases that can regenerate', () => {
    const stalePhases = [
      {
        id: 'tasks' as const,
        label: 'Tasks',
        state: makePhaseState({ id: 'tasks' }),
        lastGeneratedAgainst: 'plan@v2',
        canRegenerate: true,
      },
    ]
    render(
      <StalePropagationModal
        changedPhase="plan"
        changedPhaseLabel="Plan"
        stalePhases={stalePhases}
        onReapproveAndQueue={noop}
        onReapproveOnly={noop}
        onRevert={noop}
        onDismiss={noop}
      />
    )
    expect(screen.getByRole('checkbox')).toBeTruthy()
  })

  it('shows locked message for phases that cannot regenerate', () => {
    const stalePhases = [
      {
        id: 'implement' as const,
        label: 'Implement',
        state: makePhaseState({ id: 'implement' }),
        lastGeneratedAgainst: 'tasks@v1',
        canRegenerate: false,
      },
    ]
    render(
      <StalePropagationModal
        changedPhase="plan"
        changedPhaseLabel="Plan"
        stalePhases={stalePhases}
        onReapproveAndQueue={noop}
        onReapproveOnly={noop}
        onRevert={noop}
        onDismiss={noop}
      />
    )
    expect(screen.getByText(/Locked until upstream fresh/)).toBeTruthy()
  })

  it('calls onDismiss when close button is clicked', () => {
    const onDismiss = vi.fn()
    render(
      <StalePropagationModal
        changedPhase="plan"
        changedPhaseLabel="Plan"
        stalePhases={[]}
        onReapproveAndQueue={noop}
        onReapproveOnly={noop}
        onRevert={noop}
        onDismiss={onDismiss}
      />
    )
    fireEvent.click(screen.getByText('✕'))
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('calls onReapproveOnly when Re-approve only is clicked', async () => {
    const onReapproveOnly = vi.fn().mockResolvedValue(undefined)
    render(
      <StalePropagationModal
        changedPhase="plan"
        changedPhaseLabel="Plan"
        stalePhases={[]}
        onReapproveAndQueue={noop}
        onReapproveOnly={onReapproveOnly}
        onRevert={noop}
        onDismiss={noop}
      />
    )
    fireEvent.click(screen.getByText('Re-approve only'))
    await waitFor(() => {
      expect(onReapproveOnly).toHaveBeenCalledOnce()
    })
  })

  it('calls onRevert when revert button is clicked', async () => {
    const onRevert = vi.fn().mockResolvedValue(undefined)
    render(
      <StalePropagationModal
        changedPhase="plan"
        changedPhaseLabel="Plan"
        stalePhases={[]}
        onReapproveAndQueue={noop}
        onReapproveOnly={noop}
        onRevert={onRevert}
        onDismiss={noop}
      />
    )
    fireEvent.click(screen.getByText('Revert to previous version'))
    await waitFor(() => {
      expect(onRevert).toHaveBeenCalledOnce()
    })
  })

  it('shows run queue preview when phases are selected', () => {
    const stalePhases = [
      {
        id: 'tasks' as const,
        label: 'Tasks',
        state: makePhaseState({ id: 'tasks' }),
        lastGeneratedAgainst: 'plan@v2',
        canRegenerate: true,
      },
    ]
    render(
      <StalePropagationModal
        changedPhase="plan"
        changedPhaseLabel="Plan"
        stalePhases={stalePhases}
        onReapproveAndQueue={noop}
        onReapproveOnly={noop}
        onRevert={noop}
        onDismiss={noop}
      />
    )
    // Queue preview shows since tasks is selected by default
    expect(screen.getByText('Run queue (preview)')).toBeTruthy()
  })

  it('deselects a phase when its checkbox is unchecked', async () => {
    const onQueue = vi.fn().mockResolvedValue(undefined)
    const stalePhases = [
      {
        id: 'tasks' as const,
        label: 'Tasks',
        state: makePhaseState({ id: 'tasks' }),
        lastGeneratedAgainst: 'plan@v2',
        canRegenerate: true,
      },
    ]
    render(
      <StalePropagationModal
        changedPhase="plan"
        changedPhaseLabel="Plan"
        stalePhases={stalePhases}
        onReapproveAndQueue={onQueue}
        onReapproveOnly={noop}
        onRevert={noop}
        onDismiss={noop}
      />
    )
    // Tasks is checked by default; uncheck it
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement
    expect(checkbox.checked).toBe(true)
    fireEvent.click(checkbox)
    await waitFor(() => {
      expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false)
    })
  })

  it('calls onReapproveAndQueue with selected phases', async () => {
    const onQueue = vi.fn().mockResolvedValue(undefined)
    const stalePhases = [
      {
        id: 'tasks' as const,
        label: 'Tasks',
        state: makePhaseState({ id: 'tasks' }),
        lastGeneratedAgainst: 'plan@v2',
        canRegenerate: true,
      },
    ]
    render(
      <StalePropagationModal
        changedPhase="plan"
        changedPhaseLabel="Plan"
        stalePhases={stalePhases}
        onReapproveAndQueue={onQueue}
        onReapproveOnly={noop}
        onRevert={noop}
        onDismiss={noop}
      />
    )
    fireEvent.click(screen.getByText(/Re-approve Plan & queue/))
    await waitFor(() => {
      expect(onQueue).toHaveBeenCalledWith(['tasks'])
    })
  })
})
