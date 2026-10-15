import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  OverviewSummary,
  useSummary,
  type SummarySubject,
} from '../../src/components/pr-review/OverviewSummary'
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
  it('sends the body, shows it is busy, then shows the summary', async () => {
    const settle = pendingSummary()
    renderDescription('Adds feature X.')

    fireEvent.click(screen.getByRole('button', { name: 'Summarize' }))

    const busy = screen.getByRole('button', { name: 'Summarizing…' }) as HTMLButtonElement
    expect(busy.disabled).toBe(true)
    expect(mockSummarize).toHaveBeenCalledWith({
      repoRoot: '/repo',
      prNumber: 42,
      kind: 'description',
      text: 'Adds feature X.',
    })
    settle({ summary: 'Adds X behind a flag.' })
    expect((await screen.findByTestId('rich-content')).textContent).toBe('Adds X behind a flag.')
    expect(screen.queryByRole('button', { name: 'Summarizing…' })).toBeNull()
  })

  it('offers no Summarize for an empty description', () => {
    renderDescription('')
    expect(screen.queryByRole('button', { name: 'Summarize' })).toBeNull()
  })

  it('offers no Summarize for a missing description', () => {
    renderDescription(null)
    expect(screen.queryByRole('button', { name: 'Summarize' })).toBeNull()
  })
})

describe('OverviewSummary — summarizing a discussion', () => {
  it('sends each comment as **author**: body', () => {
    mockSummarize.mockResolvedValue({ summary: 's' })
    const comments = [comment(1, 'ana', 'Ship it'), comment(2, 'bo', 'Wait for CI')]
    render(<SummaryOf subject={{ kind: 'discussion', comments }} />)

    fireEvent.click(screen.getByRole('button', { name: 'Summarize' }))

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
    expect((await screen.findByRole('alert')).textContent).toContain('Timed out after 5 min')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

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
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })
})
