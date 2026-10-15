import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  OverviewSummary,
  summaryShown,
  useSummary,
  type Summary,
  type SummarySubject,
} from '../../src/components/pr-review/OverviewSummary'
import { partialFake } from '../../../../tests/support/fakes'
import type { IssueComment } from '../../src/schemas/pr-review.schema'
import type { SummaryResult } from '../../src/schemas/review-agent.schema'

const mockSummarize = vi.fn<(input: unknown) => Promise<SummaryResult>>()
vi.mock('../../src/api/review-agent', () => ({
  reviewAgentAPI: { summarize: (input: unknown) => mockSummarize(input) },
}))

vi.mock('../../src/components/pr-review/RichContent', () => ({
  RichContent: ({ children }: { children: string }) => (
    <div data-testid="rich-content">{children}</div>
  ),
}))

/** A summarize call the test settles. */
function pendingSummary() {
  let settle: (result: SummaryResult) => void = () => {}
  mockSummarize.mockImplementationOnce(() => new Promise((resolve) => (settle = resolve)))
  return (result: SummaryResult) => settle(result)
}

function comment(id: number, author: string, body: string): IssueComment {
  const at = new Date().toISOString()
  return { id, author, authorAvatarUrl: '', body, createdAt: at, updatedAt: at }
}

/** OverviewSummary for PR 42 in /repo, owning its summary as the overview's tabs do. */
function SummaryOf({ subject }: { subject: SummarySubject }) {
  const summary = useSummary('/repo', 42)
  return <OverviewSummary subject={subject} summary={summary} />
}

function renderDescription(body: string | null) {
  return render(<SummaryOf subject={{ kind: 'description', body }} />)
}

beforeEach(() => {
  mockSummarize.mockReset()
})

describe('OverviewSummary — summarizing a description', () => {
  it('offers the agent in one quiet row before it has run', () => {
    renderDescription('Adds feature X.')
    expect(screen.getByText('Summarize the description with the review agent')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Summarize' })).toBeTruthy()
    expect(screen.queryByText('Brief')).toBeNull()
  })

  it('sends the body, shows the Brief as busy, then shows the summary with Regenerate', async () => {
    const settle = pendingSummary()
    renderDescription('Adds feature X.')

    fireEvent.click(screen.getByRole('button', { name: 'Summarize' }))

    expect(screen.getByText('Brief')).toBeTruthy()
    expect(screen.getByText('reading the description…')).toBeTruthy()
    expect(screen.getByText('Summarizing').closest('[aria-busy="true"]')).toBeTruthy()
    expect(mockSummarize).toHaveBeenCalledWith({
      repoRoot: '/repo',
      prNumber: 42,
      kind: 'description',
      text: 'Adds feature X.',
    })
    settle({ summary: 'Adds X behind a flag.' })
    expect((await screen.findByTestId('rich-content')).textContent).toBe('Adds X behind a flag.')
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeTruthy()
    expect(screen.getByText(/review agent · from the description ·/)).toBeTruthy()
    expect(screen.queryByText('Summarizing')).toBeNull()
  })
})

describe('OverviewSummary — a description with nothing to summarize', () => {
  it('offers no Summarize for an empty description', () => {
    renderDescription('')
    expect(screen.queryByRole('button', { name: 'Summarize' })).toBeNull()
  })

  it('offers no Summarize for a missing description', () => {
    renderDescription(null)
    expect(screen.queryByRole('button', { name: 'Summarize' })).toBeNull()
  })
})

describe('summaryShown', () => {
  const state = (summary: string | null, error: string | null) =>
    partialFake<Summary>({ summary, error })

  it('is true only with summary text and no error', () => {
    expect(summaryShown(state('Adds X.', null))).toBe(true)
    expect(summaryShown(state(null, null))).toBe(false)
    expect(summaryShown(state('Adds X.', 'Timed out'))).toBe(false)
  })
})

describe('OverviewSummary — summarizing a discussion', () => {
  it('sends each comment as **author**: body', () => {
    mockSummarize.mockResolvedValue({ summary: 's' })
    const comments = [comment(1, 'ana', 'Ship it'), comment(2, 'bo', 'Wait for CI')]
    render(<SummaryOf subject={{ kind: 'discussion', comments }} />)

    fireEvent.click(screen.getByRole('button', { name: 'Summarize' }))

    expect(screen.getByText('reading the discussion…')).toBeTruthy()
    expect(mockSummarize).toHaveBeenCalledWith({
      repoRoot: '/repo',
      prNumber: 42,
      kind: 'discussion',
      text: '**ana**: Ship it\n\n**bo**: Wait for CI',
    })
  })

  it('offers no Summarize for a discussion with no comments', () => {
    render(<SummaryOf subject={{ kind: 'discussion', comments: [] }} />)
    expect(screen.queryByRole('button', { name: 'Summarize' })).toBeNull()
  })
})

describe('OverviewSummary — when the agent cannot summarize', () => {
  it('shows the error in plain words and Retry runs the summary again', async () => {
    mockSummarize.mockResolvedValueOnce({ error: 'Timed out after 5 min' })
    mockSummarize.mockResolvedValueOnce({ summary: 'Adds X.' })
    renderDescription('Adds feature X.')

    fireEvent.click(screen.getByRole('button', { name: 'Summarize' }))
    expect((await screen.findByRole('alert')).textContent).toBe(
      'The review agent could not summarize this: Timed out after 5 min.Try again'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect((await screen.findByTestId('rich-content')).textContent).toBe('Adds X.')
    expect(mockSummarize).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows a failed call as an error with Retry, not a crash', async () => {
    mockSummarize.mockRejectedValueOnce(new Error('No handler for review-agent:summarize'))
    renderDescription('Adds feature X.')

    fireEvent.click(screen.getByRole('button', { name: 'Summarize' }))

    expect((await screen.findByRole('alert')).textContent).toContain(
      'No handler for review-agent:summarize'
    )
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })
})
