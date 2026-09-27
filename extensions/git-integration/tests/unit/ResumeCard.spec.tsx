import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ResumeCard } from '../../src/components/pr-review/ResumeCard'
import { useReviewUiStore } from '../../src/stores/review-ui.store'
import type { PrReviewDetail, ReviewNote, DraftComment } from '../../src/schemas/pr-review.schema'
import type { AgentRun } from '../../src/schemas/review-agent.schema'

const mockPr = {
  number: 209,
  chapters: [
    { id: 'ch-1', name: 'Chapter 1' },
    { id: 'ch-2', name: 'Chapter 2' },
  ],
} as unknown as PrReviewDetail

function makeNote(overrides: Partial<ReviewNote> = {}): ReviewNote {
  return {
    id: 'n1',
    path: 'forge/amend.ts',
    line: 118,
    body: 'why does amendOrder skip the ledger here??',
    createdAt: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeDraft(overrides: Partial<DraftComment> = {}): DraftComment {
  return {
    id: 'd1',
    path: 'src/foo.ts',
    line: 1,
    startLine: null,
    side: 'RIGHT',
    body: 'x',
    fromFindingId: null,
    ...overrides,
  }
}

function makeRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'r1',
    repoRoot: '/repo',
    prNumber: 209,
    headSHA: 'sha',
    sessionId: 's1',
    scope: { kind: 'pr', path: null, startLine: null, endLine: null, side: null, chapter: null },
    request: 'review',
    question: null,
    status: 'done',
    startedAt: '2025-01-01T00:00:00Z',
    finishedAt: '2025-01-01T00:01:00Z',
    activity: [],
    summary: null,
    findings: [],
    walkthrough: [],
    error: null,
    ...overrides,
  }
}

beforeEach(() => {
  useReviewUiStore.setState({ agentPanelScope: null })
})

describe('ResumeCard', () => {
  it('shows the PR number and viewed count', () => {
    render(
      <ResumeCard
        pr={mockPr}
        lastAccessedAt="2025-01-01T17:42:00Z"
        viewedCount={9}
        totalFiles={16}
        currentChapterId="ch-2"
        currentFilePath="forge/amend.ts"
        lastLine={118}
        notes={[]}
        drafts={[]}
        agentRuns={[]}
        changedSinceCount={0}
        onContinue={vi.fn()}
      />
    )
    expect(screen.getByText('Where you left off · #209')).toBeTruthy()
    expect(screen.getByText(/9 of 16 files viewed/)).toBeTruthy()
  })

  it('shows the last-position row with chapter and file', () => {
    render(
      <ResumeCard
        pr={mockPr}
        lastAccessedAt="2025-01-01T00:00:00Z"
        viewedCount={0}
        totalFiles={1}
        currentChapterId="ch-2"
        currentFilePath="forge/amend.ts"
        lastLine={118}
        notes={[]}
        drafts={[]}
        agentRuns={[]}
        changedSinceCount={0}
        onContinue={vi.fn()}
      />
    )
    expect(screen.getByText(/Chapter 2/)).toBeTruthy()
    expect(screen.getByText('forge/amend.ts')).toBeTruthy()
    expect(screen.getByText('last position')).toBeTruthy()
  })

  it('omits the last-position row when there is no current file', () => {
    render(
      <ResumeCard
        pr={mockPr}
        lastAccessedAt="2025-01-01T00:00:00Z"
        viewedCount={0}
        totalFiles={1}
        currentChapterId={null}
        currentFilePath={null}
        lastLine={null}
        notes={[]}
        drafts={[]}
        agentRuns={[]}
        changedSinceCount={0}
        onContinue={vi.fn()}
      />
    )
    expect(screen.queryByText('last position')).toBeNull()
  })

  it('shows notes with the question quoted and an Ask agent button', () => {
    render(
      <ResumeCard
        pr={mockPr}
        lastAccessedAt="2025-01-01T00:00:00Z"
        viewedCount={0}
        totalFiles={1}
        currentChapterId={null}
        currentFilePath={null}
        lastLine={null}
        notes={[makeNote(), makeNote({ id: 'n2', body: 'a plain note' })]}
        drafts={[]}
        agentRuns={[]}
        changedSinceCount={0}
        onContinue={vi.fn()}
      />
    )
    expect(screen.getByText(/2 notes, 1 is a question/)).toBeTruthy()
    expect(screen.getByText('Ask agent')).toBeTruthy()
  })

  it('opens the agent panel for the question note line when Ask agent is clicked', () => {
    const note = makeNote()
    render(
      <ResumeCard
        pr={mockPr}
        lastAccessedAt="2025-01-01T00:00:00Z"
        viewedCount={0}
        totalFiles={1}
        currentChapterId={null}
        currentFilePath={null}
        lastLine={null}
        notes={[note]}
        drafts={[]}
        agentRuns={[]}
        changedSinceCount={0}
        onContinue={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText('Ask agent'))
    expect(useReviewUiStore.getState().agentPanelScope).toEqual({
      kind: 'lines',
      path: note.path,
      startLine: note.line,
      endLine: note.line,
      side: 'RIGHT',
      chapter: null,
    })
  })

  it('shows unopened agent findings with the highest severity', () => {
    render(
      <ResumeCard
        pr={mockPr}
        lastAccessedAt="2025-01-01T00:00:00Z"
        viewedCount={0}
        totalFiles={1}
        currentChapterId={null}
        currentFilePath={null}
        lastLine={null}
        notes={[]}
        drafts={[]}
        agentRuns={[
          makeRun({
            findings: [
              {
                id: 'f1',
                severity: 'nit',
                path: 'a.ts',
                startLine: 1,
                endLine: 1,
                side: 'RIGHT',
                title: 't',
                body: 'b',
                suggestedCode: null,
                dismissed: false,
              },
              {
                id: 'f2',
                severity: 'must-fix',
                path: 'a.ts',
                startLine: 2,
                endLine: 2,
                side: 'RIGHT',
                title: 't',
                body: 'b',
                suggestedCode: null,
                dismissed: false,
              },
            ],
          }),
        ]}
        changedSinceCount={0}
        onContinue={vi.fn()}
      />
    )
    expect(screen.getByText(/2 agent findings you haven't opened/)).toBeTruthy()
    expect(screen.getByText('must-fix')).toBeTruthy()
  })

  it('shows draft comments with a Review drafts button', () => {
    render(
      <ResumeCard
        pr={mockPr}
        lastAccessedAt="2025-01-01T00:00:00Z"
        viewedCount={0}
        totalFiles={1}
        currentChapterId={null}
        currentFilePath={null}
        lastLine={null}
        notes={[]}
        drafts={[makeDraft(), makeDraft({ id: 'd2' })]}
        agentRuns={[]}
        changedSinceCount={0}
        onContinue={vi.fn()}
      />
    )
    expect(screen.getByText('2 draft comments not yet submitted')).toBeTruthy()
    expect(screen.getByText('Review drafts')).toBeTruthy()
  })

  it('shows the push-since row only when files changed since viewing', () => {
    render(
      <ResumeCard
        pr={mockPr}
        lastAccessedAt="2025-01-01T00:00:00Z"
        viewedCount={0}
        totalFiles={1}
        currentChapterId={null}
        currentFilePath={null}
        lastLine={null}
        notes={[]}
        drafts={[]}
        agentRuns={[]}
        changedSinceCount={2}
        onContinue={vi.fn()}
      />
    )
    expect(screen.getByText(/1 push since · 2 viewed files changed/)).toBeTruthy()
  })

  it('omits empty rows entirely', () => {
    render(
      <ResumeCard
        pr={mockPr}
        lastAccessedAt="2025-01-01T00:00:00Z"
        viewedCount={0}
        totalFiles={1}
        currentChapterId={null}
        currentFilePath={null}
        lastLine={null}
        notes={[]}
        drafts={[]}
        agentRuns={[]}
        changedSinceCount={0}
        onContinue={vi.fn()}
      />
    )
    expect(screen.queryByText('Review drafts')).toBeNull()
    expect(screen.queryByText('Ask agent')).toBeNull()
    expect(screen.queryByText(/push since/)).toBeNull()
  })

  it('calls onContinue when Continue is clicked', () => {
    const onContinue = vi.fn()
    render(
      <ResumeCard
        pr={mockPr}
        lastAccessedAt="2025-01-01T00:00:00Z"
        viewedCount={0}
        totalFiles={1}
        currentChapterId={null}
        currentFilePath={null}
        lastLine={null}
        notes={[]}
        drafts={[]}
        agentRuns={[]}
        changedSinceCount={0}
        onContinue={onContinue}
      />
    )
    fireEvent.click(screen.getByText('Continue'))
    expect(onContinue).toHaveBeenCalledTimes(1)
  })
})
