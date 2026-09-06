import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import { PhaseRail } from '../../src/components/PhaseRail.js'
import type { PhaseId, PhaseState } from '../../src/types/speckit.types.js'
import { PHASE_ORDER } from '../../src/types/speckit.types.js'

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

describe('PhaseRail', () => {
  it('renders 10 nodes for 10 phases', () => {
    const phases = makePhases()
    render(<PhaseRail phases={phases} />)
    const nodes = screen.getAllByRole('listitem')
    expect(nodes).toHaveLength(10)
  })

  it('applies done class to approved phases', () => {
    const phases = makePhases({ constitution: { status: 'approved' } })
    render(<PhaseRail phases={phases} />)
    const constitutionNode = screen.getByTestId('phase-node-constitution')
    expect(constitutionNode.className).toContain('done')
  })

  it('applies active class to running phase', () => {
    const phases = makePhases({ specify: { status: 'running' } })
    render(<PhaseRail phases={phases} />)
    const node = screen.getByTestId('phase-node-specify')
    expect(node.className).toContain('active')
  })

  it('applies review class to awaiting_review phase', () => {
    const phases = makePhases({ plan: { status: 'awaiting_review' } })
    render(<PhaseRail phases={phases} />)
    const node = screen.getByTestId('phase-node-plan')
    expect(node.className).toContain('review')
  })

  it('applies locked class to locked phases', () => {
    const phases = makePhases()
    render(<PhaseRail phases={phases} />)
    const node = screen.getByTestId('phase-node-implement')
    expect(node.className).toContain('locked')
  })

  it('applies pending class to ready phases', () => {
    const phases = makePhases({ constitution: { status: 'ready' } })
    render(<PhaseRail phases={phases} />)
    const node = screen.getByTestId('phase-node-constitution')
    expect(node.className).toContain('pending')
  })

  it('highlights active phase node when activePhase prop is provided', () => {
    const phases = makePhases({ tasks: { status: 'running' } })
    render(<PhaseRail phases={phases} activePhase="tasks" />)
    const node = screen.getByTestId('phase-node-tasks')
    expect(node.className).toContain('active')
  })
})
