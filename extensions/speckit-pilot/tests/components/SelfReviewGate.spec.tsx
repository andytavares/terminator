import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import type { SelfReviewResult } from '../../src/types/speckit.types.js'

const mockSelfReviewRead = vi.fn()
const mockPhaseRequestChanges = vi.fn()
const mockPhaseApprove = vi.fn()

vi.mock('../../src/types/electron.js', () => ({
  getSpeckitAPI: () => ({
    selfReviewRead: mockSelfReviewRead,
    phaseRequestChanges: mockPhaseRequestChanges,
    phaseApprove: mockPhaseApprove,
  }),
}))

import { SelfReviewGate } from '../../src/components/SelfReviewGate.js'

function makeResult(overrides?: Partial<SelfReviewResult>): SelfReviewResult {
  return {
    format: { passed: true, output: '' },
    lint: { passed: true, errorCount: 0, warningCount: 0, output: '' },
    coverage: { passed: true, percentage: 85, output: '' },
    googleReview: { passed: true, blockerCount: 0, output: '' },
    summary: 'All checks passed',
    ...overrides,
  }
}

describe('SelfReviewGate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSelfReviewRead.mockResolvedValue({ result: makeResult() })
    mockPhaseRequestChanges.mockResolvedValue({ state: {} })
    mockPhaseApprove.mockResolvedValue({ state: {} })
  })

  it('renders Format quality row', async () => {
    render(<SelfReviewGate featureDir="/repo/specs/001" />)
    await waitFor(() => {
      expect(screen.getByText(/format/i)).toBeTruthy()
    })
  })

  it('renders Lint quality row', async () => {
    render(<SelfReviewGate featureDir="/repo/specs/001" />)
    await waitFor(() => {
      expect(screen.getByText(/lint/i)).toBeTruthy()
    })
  })

  it('renders Coverage quality row with percentage', async () => {
    mockSelfReviewRead.mockResolvedValue({
      result: makeResult({ coverage: { passed: true, percentage: 92, output: '' } }),
    })
    render(<SelfReviewGate featureDir="/repo/specs/001" />)
    await waitFor(() => {
      expect(screen.getByText(/92/)).toBeTruthy()
    })
  })

  it('renders Google Review quality row', async () => {
    render(<SelfReviewGate featureDir="/repo/specs/001" />)
    await waitFor(() => {
      expect(screen.getByText(/google.review/i)).toBeTruthy()
    })
  })

  it('shows warning when lint has errors', async () => {
    mockSelfReviewRead.mockResolvedValue({
      result: makeResult({
        lint: { passed: false, errorCount: 3, warningCount: 1, output: '3 errors' },
      }),
    })
    render(<SelfReviewGate featureDir="/repo/specs/001" />)
    await waitFor(() => {
      expect(screen.getByText(/3/)).toBeTruthy()
    })
  })

  it('shows "Back to Implement" button', async () => {
    render(<SelfReviewGate featureDir="/repo/specs/001" />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /back to implement/i })).toBeTruthy()
    })
  })

  it('calls phaseRequestChanges when Back to Implement is clicked', async () => {
    render(<SelfReviewGate featureDir="/repo/specs/001" />)
    await waitFor(() => screen.getByRole('button', { name: /back to implement/i }))
    fireEvent.click(screen.getByRole('button', { name: /back to implement/i }))
    await waitFor(() =>
      expect(mockPhaseRequestChanges).toHaveBeenCalledWith(
        expect.objectContaining({ featureDir: '/repo/specs/001', phase: 'implement' })
      )
    )
  })

  it('shows "Approve → Open PR" button', async () => {
    render(<SelfReviewGate featureDir="/repo/specs/001" />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /approve.*open pr/i })).toBeTruthy()
    })
  })

  it('calls phaseApprove when Approve → Open PR is clicked', async () => {
    render(<SelfReviewGate featureDir="/repo/specs/001" />)
    await waitFor(() => screen.getByRole('button', { name: /approve.*open pr/i }))
    fireEvent.click(screen.getByRole('button', { name: /approve.*open pr/i }))
    await waitFor(() =>
      expect(mockPhaseApprove).toHaveBeenCalledWith(
        expect.objectContaining({ featureDir: '/repo/specs/001', phase: 'self-review' })
      )
    )
  })
})

describe('when no summary was parsed', () => {
  // Nothing writes `.pilot/self-review.json` yet. Returning early on that left
  // the phase with no approve button anywhere and the card could not move.

  beforeEach(() => {
    mockSelfReviewRead.mockResolvedValue({ notFound: true, error: 'self-review.json not found' })
  })

  it('still lets the phase be approved', async () => {
    render(<SelfReviewGate featureDir="/repo/specs/001" />)
    fireEvent.click(await screen.findByRole('button', { name: /approve/i }))
    await waitFor(() =>
      expect(mockPhaseApprove).toHaveBeenCalledWith(
        expect.objectContaining({ phase: 'self-review' })
      )
    )
  })

  it('still lets it be sent back', async () => {
    render(<SelfReviewGate featureDir="/repo/specs/001" />)
    fireEvent.click(await screen.findByRole('button', { name: /implement/i }))
    await waitFor(() => expect(mockPhaseRequestChanges).toHaveBeenCalled())
  })

  it('says where to read the result instead of pretending there is none', async () => {
    render(<SelfReviewGate featureDir="/repo/specs/001" />)
    expect(await screen.findByText(/output is in the console above/i)).toBeDefined()
  })
})

describe('a check nothing measured', () => {
  // A zero would read as "no errors". A review that says that when it does not
  // know is worse than one that says nothing.

  beforeEach(() => {
    mockSelfReviewRead.mockResolvedValue({
      result: makeResult({
        format: { passed: null, output: null },
        lint: { passed: null, errorCount: null, warningCount: null, output: null },
        coverage: { passed: true, percentage: null, output: null },
        googleReview: { passed: true, blockerCount: null, output: null },
        summary: 'Did not run: format, lint.',
      }),
    })
  })

  it('says a step did not run rather than showing it as passing', async () => {
    render(<SelfReviewGate featureDir="/repo/specs/001" />)
    expect(await screen.findByText('Not checked')).toBeDefined()
    expect(screen.getByText('Not run')).toBeDefined()
  })

  it('never turns an unreported count into a zero', async () => {
    render(<SelfReviewGate featureDir="/repo/specs/001" />)
    await screen.findByText('Not checked')
    expect(screen.queryByText(/0 errors/)).toBeNull()
    expect(screen.queryByText(/0 blockers/)).toBeNull()
  })

  it('says coverage was not reported rather than showing a percentage', async () => {
    render(<SelfReviewGate featureDir="/repo/specs/001" />)
    expect(await screen.findByText('Not reported')).toBeDefined()
  })

  it('does not warn about checks that merely did not run', async () => {
    // The warning is for checks that failed. "Did not run" is not a failure.
    render(<SelfReviewGate featureDir="/repo/specs/001" />)
    await screen.findByText('Not checked')
    expect(screen.queryByText(/did not pass/i)).toBeNull()
  })

  it('still lets the phase be approved', async () => {
    render(<SelfReviewGate featureDir="/repo/specs/001" />)
    fireEvent.click(await screen.findByRole('button', { name: /approve/i }))
    await waitFor(() => expect(mockPhaseApprove).toHaveBeenCalled())
  })
})
