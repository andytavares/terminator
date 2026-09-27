import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AgentPanel } from '../../src/components/pr-review/AgentPanel'
import { useReviewUiStore } from '../../src/stores/review-ui.store'
import type { PrReviewDetail } from '../../src/schemas/pr-review.schema'
import type { AgentRun, AgentScope } from '../../src/schemas/review-agent.schema'

vi.mock('../../src/stores/review-ui.store', () => ({ useReviewUiStore: vi.fn() }))

const mockStart = vi.fn()
const mockCancel = vi.fn()
const mockOpenTerminal = vi.fn()
const mockDismiss = vi.fn()
const mockSettings = vi.fn()

vi.mock('../../src/api/review-agent', () => ({
  reviewAgentAPI: {
    start: (...args: unknown[]) => mockStart(...args),
    cancel: (...args: unknown[]) => mockCancel(...args),
    openTerminal: (...args: unknown[]) => mockOpenTerminal(...args),
    dismiss: (...args: unknown[]) => mockDismiss(...args),
    settings: (...args: unknown[]) => mockSettings(...args),
  },
}))

const mockOpenAgentPanel = vi.fn()
const mockUpsertAgentRun = vi.fn()
const mockRequestComposer = vi.fn()

function makePr(overrides: Partial<PrReviewDetail> = {}): PrReviewDetail {
  return {
    number: 42,
    title: 'Test PR',
    body: '',
    author: 'octocat',
    authorAvatarUrl: '',
    openedAt: new Date().toISOString(),
    headRefName: 'feature',
    baseRefName: 'main',
    headSHA: 'abc123',
    isDraft: false,
    mergeStateStatus: 'clean',
    ciStatus: 'passing',
    lintStatus: 'unknown',
    coverageStatus: 'unknown',
    statusChecks: [],
    approvals: [],
    requestedReviewers: [],
    assigneeLogins: [],
    chapters: [],
    issueRefs: [],
    dryViolations: [],
    readingOrder: [],
    movedBlocks: [],
    insights: null,
    ...overrides,
  }
}

const linesScope: AgentScope = {
  kind: 'lines',
  path: 'extensions/git-integration/src/hooks/usePrReview.ts',
  startLine: 309,
  endLine: 317,
  side: 'RIGHT',
  chapter: null,
}

function makeRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'run-1',
    repoRoot: '/repo',
    prNumber: 42,
    headSHA: 'abc123',
    sessionId: 'sess-1',
    scope: linesScope,
    request: 'review',
    question: null,
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    activity: [],
    summary: null,
    findings: [],
    walkthrough: [],
    error: null,
    ...overrides,
  }
}

function setStoreState(overrides: Record<string, unknown>) {
  const state = {
    agentPanelScope: null as AgentScope | null,
    agentPanelRequest: 'review' as const,
    agentPanelAutoStart: false,
    agentRuns: [] as AgentRun[],
    openAgentPanel: mockOpenAgentPanel,
    upsertAgentRun: mockUpsertAgentRun,
    requestComposer: mockRequestComposer,
    ...overrides,
  }
  ;(useReviewUiStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (selector: (s: typeof state) => unknown) => selector(state)
  )
}

const finding1 = {
  id: 'f1',
  severity: 'suggestion' as const,
  path: 'extensions/git-integration/src/hooks/usePrReview.ts',
  startLine: 317,
  endLine: 317,
  side: 'RIGHT' as const,
  title: 'Risk scored twice per file',
  body: 'Line 317 calls computeRiskScore again for every file already scored on line 312.',
  suggestedCode: null,
  dismissed: false,
}

const finding2 = {
  id: 'f2',
  severity: 'question' as const,
  path: 'extensions/git-integration/src/github/pr-review-service.ts',
  startLine: 109,
  endLine: 109,
  side: 'RIGHT' as const,
  title: 'Coverage comes from your checkout',
  body: 'coverage_n uses patchCoverage read from the local checkout, which is not the PR head.',
  suggestedCode: null,
  dismissed: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSettings.mockResolvedValue({ model: 'sonnet' })
  mockStart.mockResolvedValue({ run: makeRun({ status: 'running' }) })
  mockCancel.mockResolvedValue({ ok: true })
  mockDismiss.mockResolvedValue({ ok: true })
})

describe('AgentPanel', () => {
  it('renders null when there is no scope', () => {
    setStoreState({ agentPanelScope: null })
    const { container } = render(<AgentPanel repoRoot="/repo" pr={makePr()} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows the ask state for the scope label', () => {
    setStoreState({ agentPanelScope: linesScope })
    render(<AgentPanel repoRoot="/repo" pr={makePr()} />)
    expect(screen.getByText('Ask about lines 309–317')).toBeTruthy()
  })

  it('auto-starts with the explain request when agentPanelAutoStart is true', async () => {
    setStoreState({
      agentPanelScope: linesScope,
      agentPanelRequest: 'explain',
      agentPanelAutoStart: true,
    })
    render(<AgentPanel repoRoot="/repo" pr={makePr()} />)

    await waitFor(() => {
      expect(mockStart).toHaveBeenCalledWith(expect.objectContaining({ request: 'explain' }))
    })
  })

  it('shows the running state and cancels the run', () => {
    const run = makeRun({ status: 'running', activity: [] })
    setStoreState({ agentPanelScope: linesScope, agentRuns: [run] })
    render(<AgentPanel repoRoot="/repo" pr={makePr()} />)

    expect(screen.getByText(/Reviewing lines 309–317/)).toBeTruthy()
    fireEvent.click(screen.getByText('Cancel'))
    expect(mockCancel).toHaveBeenCalledWith('run-1')
  })

  it('shows the findings state with severity tags and file:line notes', () => {
    const run = makeRun({ status: 'done', findings: [finding1, finding2] })
    setStoreState({ agentPanelScope: linesScope, agentRuns: [run] })
    render(<AgentPanel repoRoot="/repo" pr={makePr()} />)

    expect(screen.getByText('2 findings · lines 309–317')).toBeTruthy()
    expect(screen.getByText('suggestion')).toBeTruthy()
    expect(screen.getByText('Risk scored twice per file')).toBeTruthy()
    expect(screen.getByText('usePrReview.ts:317')).toBeTruthy()
  })

  it('posts a finding as a comment with fromFindingId and the finding line', () => {
    const run = makeRun({ status: 'done', findings: [finding1, finding2] })
    setStoreState({ agentPanelScope: linesScope, agentRuns: [run] })
    render(<AgentPanel repoRoot="/repo" pr={makePr()} />)

    const postButtons = screen.getAllByText('Post as comment')
    fireEvent.click(postButtons[0])

    expect(mockRequestComposer).toHaveBeenCalledWith(
      expect.objectContaining({
        fromFindingId: 'f1',
        line: 317,
        path: 'extensions/git-integration/src/hooks/usePrReview.ts',
      })
    )
  })

  it('dismisses a finding and hides its card', () => {
    const run = makeRun({ status: 'done', findings: [finding1, finding2] })
    setStoreState({ agentPanelScope: linesScope, agentRuns: [run] })
    render(<AgentPanel repoRoot="/repo" pr={makePr()} />)

    expect(screen.getByText('Risk scored twice per file')).toBeTruthy()
    const dismissButtons = screen.getAllByText('Dismiss')
    fireEvent.click(dismissButtons[0])

    expect(screen.queryByText('Risk scored twice per file')).toBeNull()
    expect(mockDismiss).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-1', findingId: 'f1' })
    )
  })

  it('closes the panel', () => {
    setStoreState({ agentPanelScope: linesScope })
    render(<AgentPanel repoRoot="/repo" pr={makePr()} />)
    fireEvent.click(screen.getByLabelText('Close agent panel'))
    expect(mockOpenAgentPanel).toHaveBeenCalledWith(null)
  })
})
