import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ResumeCard } from '../../src/components/pr-review/ResumeCard'
import { useReviewUiStore } from '../../src/stores/review-ui.store'
import type {
  Chapter,
  PrReviewDetail,
  ReviewNote,
  DraftComment,
} from '../../src/schemas/pr-review.schema'
import type { AgentRun } from '../../src/schemas/review-agent.schema'
import { partialFake } from '../../../../tests/support/fakes'

const chapterNamed = (id: string, name: string) => partialFake<Chapter>({ id, name })

const mockPr = partialFake<PrReviewDetail>({
  number: 209,
  chapters: [chapterNamed('ch-1', 'Chapter 1'), chapterNamed('ch-2', 'Chapter 2')],
})

type CardProps = React.ComponentProps<typeof ResumeCard>

/** Renders the card with a PR left a while ago and nothing noted, overridden by `props`. */
function renderCard(props: Partial<CardProps> = {}) {
  return render(
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
      onReviewDrafts={vi.fn()}
      {...props}
    />
  )
}

type Finding = AgentRun['findings'][number]

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
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
    ...overrides,
  }
}

function makeNote(overrides: Partial<ReviewNote> = {}): ReviewNote {
  return {
    id: 'n1',
    path: 'forge/amend.ts',
    line: 118,
    side: 'RIGHT',
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
    renderCard({
      lastAccessedAt: '2025-01-01T17:42:00Z',
      viewedCount: 9,
      totalFiles: 16,
      currentChapterId: 'ch-2',
      currentFilePath: 'forge/amend.ts',
      lastLine: 118,
    })
    expect(screen.getByText('Where you left off · #209')).toBeTruthy()
    expect(screen.getByText(/9 of 16 files viewed/)).toBeTruthy()
  })
})

describe('ResumeCard — shows the last-position row with chapter and file', () => {
  it('shows the last-position row with chapter and file', () => {
    renderCard({ currentChapterId: 'ch-2', currentFilePath: 'forge/amend.ts', lastLine: 118 })
    expect(screen.getByText(/Chapter 2/)).toBeTruthy()
    expect(screen.getByText('forge/amend.ts')).toBeTruthy()
    expect(screen.getByText('last position')).toBeTruthy()
  })
})

describe('ResumeCard — omits the last-position row when there is no current file', () => {
  it('omits the last-position row when there is no current file', () => {
    renderCard()
    expect(screen.queryByText('last position')).toBeNull()
  })
})

describe('ResumeCard — shows notes with the question quoted and an Ask agent button', () => {
  it('shows notes with the question quoted and an Ask agent button', () => {
    renderCard({ notes: [makeNote(), makeNote({ id: 'n2', body: 'a plain note' })] })
    expect(screen.getByText(/2 notes, 1 is a question/)).toBeTruthy()
    expect(screen.getByText('Ask agent')).toBeTruthy()
  })
})

describe('ResumeCard — opens the agent panel for the question note line when Ask agent is clicked', () => {
  it('opens the agent panel for the question note line when Ask agent is clicked', () => {
    const note = makeNote()
    renderCard({ notes: [note] })
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
})

describe('ResumeCard — shows unopened agent findings with the highest severity', () => {
  it('shows unopened agent findings with the highest severity', () => {
    renderCard({
      agentRuns: [
        makeRun({
          findings: [
            makeFinding(),
            makeFinding({ id: 'f2', severity: 'must-fix', startLine: 2, endLine: 2 }),
          ],
        }),
      ],
    })
    expect(screen.getByText(/2 agent findings you haven't opened/)).toBeTruthy()
    expect(screen.getByText('must-fix')).toBeTruthy()
  })
})

describe('ResumeCard — shows draft comments with a Review drafts button', () => {
  it('shows draft comments with a Review drafts button', () => {
    renderCard({ drafts: [makeDraft(), makeDraft({ id: 'd2' })] })
    expect(screen.getByText('2 draft comments not yet submitted')).toBeTruthy()
    expect(screen.getByText('Review drafts')).toBeTruthy()
  })
})

describe('ResumeCard — opens the drafts for review from Review drafts', () => {
  it('opens the drafts for review from Review drafts', () => {
    const onReviewDrafts = vi.fn()
    renderCard({ drafts: [makeDraft()], onReviewDrafts })
    fireEvent.click(screen.getByRole('button', { name: 'Review drafts' }))
    expect(onReviewDrafts).toHaveBeenCalledOnce()
  })
})

describe('ResumeCard — shows the push-since row only when files changed since viewing', () => {
  it('shows the push-since row only when files changed since viewing', () => {
    renderCard({ changedSinceCount: 2 })
    expect(screen.getByText(/1 push since · 2 viewed files changed/)).toBeTruthy()
  })
})

describe('ResumeCard — omits empty rows entirely', () => {
  it('omits empty rows entirely', () => {
    renderCard()
    expect(screen.queryByText('Review drafts')).toBeNull()
    expect(screen.queryByText('Ask agent')).toBeNull()
    expect(screen.queryByText(/push since/)).toBeNull()
  })
})

describe('ResumeCard — calls onContinue when Continue is clicked', () => {
  it('calls onContinue when Continue is clicked', () => {
    const onContinue = vi.fn()
    renderCard({ onContinue })
    fireEvent.click(screen.getByText('Continue'))
    expect(onContinue).toHaveBeenCalledTimes(1)
  })
})
