import React from 'react'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest'
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

const TOKENS = path.resolve(__dirname, '../../../../packages/extension-ui/src/tokens.css')

/** Adds the design tokens and one of the overview's stylesheets to the document, so the icons'
 *  colours can be computed. */
function addStylesheet(file: string): () => void {
  const style = document.createElement('style')
  const sheet = path.resolve(__dirname, '../../src/components/pr-review', file)
  style.textContent = [TOKENS, sheet].map((css) => fs.readFileSync(css, 'utf8')).join('\n')
  document.head.append(style)
  return () => style.remove()
}

/** Whether an icon draws in its parent's text colour, the flat-icons rule. */
function inheritsTextColour(icon: Element): boolean {
  return getComputedStyle(icon).color === getComputedStyle(icon.parentElement as Element).color
}

describe('OverviewSummary — flat icons', () => {
  let removeStylesheet = () => {}
  beforeEach(() => {
    removeStylesheet = addStylesheet('brief-card.css')
  })
  afterEach(() => removeStylesheet())

  it('draws the Brief icon in its text colour', () => {
    renderDescription('Adds X.')
    const icon = document.querySelector('.brief-card__icon') as Element
    expect(inheritsTextColour(icon)).toBe(true)
  })

  it('draws the error icon in its text colour', async () => {
    mockSummarize.mockResolvedValue({ error: 'Timed out' })
    renderDescription('Adds X.')
    fireEvent.click(screen.getByRole('button', { name: 'Summarize' }))
    await screen.findByRole('alert')
    expect(inheritsTextColour(document.querySelector('.brief-error__icon') as Element)).toBe(true)
  })
})
