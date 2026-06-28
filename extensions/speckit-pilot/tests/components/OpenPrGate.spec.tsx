import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import type { PilotState } from '../../src/types/speckit.types.js'

const mockPilotState = vi.fn()
const mockOpenPr = vi.fn()

vi.mock('../../src/types/electron.js', () => ({
  getSpeckitAPI: () => ({
    pilotState: mockPilotState,
    openPr: mockOpenPr,
  }),
}))

import { OpenPrGate } from '../../src/components/OpenPrGate.js'
import { DEFAULT_SETTINGS, PHASE_ORDER } from '../../src/types/speckit.types.js'
import type { PhaseId, PhaseState } from '../../src/types/speckit.types.js'

function makePhases(): Record<PhaseId, PhaseState> {
  return Object.fromEntries(
    PHASE_ORDER.map((id) => [
      id,
      {
        id,
        status: 'approved' as const,
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

function makeState(): PilotState {
  return {
    version: 2,
    featureDir: '/repo/specs/001-eng-42',
    ticket: {
      source: 'linear',
      key: 'ENG-42',
      title: 'Build the thing',
      sourceUrl: 'https://l/ENG-42',
    },
    run: {
      status: 'running',
      startedAt: '2026-01-01T00:00:00Z',
      completedAt: null,
      autonomyLevel: 'standard',
    },
    queuePosition: 'active',
    worktreePath: '/repo/.wt/eng-42',
    branchName: 'feature/eng-42',
    prUrl: null,
    phases: makePhases(),
    settings: DEFAULT_SETTINGS,
  } as PilotState
}

describe('OpenPrGate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPilotState.mockResolvedValue({ state: makeState() })
    mockOpenPr.mockResolvedValue({ prUrl: 'https://github.com/owner/repo/pull/99' })
  })

  it('shows ticket key badge', async () => {
    render(<OpenPrGate featureDir="/repo/specs/001-eng-42" workspacePath="/repo" />)
    await waitFor(() => {
      expect(screen.getByText(/ENG-42/)).toBeTruthy()
    })
  })

  it('shows branch name', async () => {
    render(<OpenPrGate featureDir="/repo/specs/001-eng-42" workspacePath="/repo" />)
    await waitFor(() => {
      expect(screen.getByText(/feature\/eng-42/)).toBeTruthy()
    })
  })

  it('shows Open PR button', async () => {
    render(<OpenPrGate featureDir="/repo/specs/001-eng-42" workspacePath="/repo" />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /open pr/i })).toBeTruthy()
    })
  })

  it('shows spec link traceability', async () => {
    render(<OpenPrGate featureDir="/repo/specs/001-eng-42" workspacePath="/repo" />)
    await waitFor(() => {
      expect(screen.getByText(/spec/i)).toBeTruthy()
    })
  })
})
