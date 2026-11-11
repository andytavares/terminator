import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgentPanel } from '../../src/components/pr-review/AgentPanel'
import { useReviewUiStore } from '../../src/stores/review-ui.store'
import type { PrReviewDetail } from '../../src/schemas/pr-review.schema'
import type { AgentRun, AgentScope } from '../../src/schemas/review-agent.schema'

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
    ownedPaths: [],
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

type ReviewUiState = ReturnType<typeof useReviewUiStore.getState>

function setStoreState(overrides: Partial<ReviewUiState>) {
  useReviewUiStore.setState(useReviewUiStore.getInitialState(), true)
  useReviewUiStore.setState(overrides)
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
    const { container } = render(
      <AgentPanel repoRoot="/repo" pr={makePr()} currentFilePath={null} />
    )
    expect(container.innerHTML).toBe('')
  })

  it('shows the ask state for the scope label', () => {
    setStoreState({ agentPanelScope: linesScope })
    render(<AgentPanel repoRoot="/repo" pr={makePr()} currentFilePath={null} />)
    expect(screen.getByText('Ask about lines 309–317')).toBeTruthy()
  })

  it('auto-starts with the explain request when agentPanelAutoStart is true', async () => {
    setStoreState({
      agentPanelScope: linesScope,
      agentPanelRequest: 'explain',
      agentPanelAutoStart: true,
    })
    render(<AgentPanel repoRoot="/repo" pr={makePr()} currentFilePath={null} />)

    await waitFor(() => {
      expect(mockStart).toHaveBeenCalledWith(expect.objectContaining({ request: 'explain' }))
    })
  })
})

describe('AgentPanel — shows the running state and cancels the run', () => {
  it('shows the running state and cancels the run', async () => {
    const user = userEvent.setup()
    const run = makeRun({ status: 'running', activity: [] })
    setStoreState({ agentPanelScope: linesScope, agentRuns: [run] })
    render(<AgentPanel repoRoot="/repo" pr={makePr()} currentFilePath={null} />)

    expect(screen.getByText(/Reviewing lines 309–317/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(mockCancel).toHaveBeenCalledWith('run-1')
  })

  it('shows the findings state with severity tags and file:line notes', () => {
    const run = makeRun({ status: 'done', findings: [finding1, finding2] })
    setStoreState({ agentPanelScope: linesScope, agentRuns: [run] })
    render(<AgentPanel repoRoot="/repo" pr={makePr()} currentFilePath={null} />)

    expect(screen.getByText('2 findings · lines 309–317')).toBeTruthy()
    expect(screen.getByText('suggestion')).toBeTruthy()
    expect(screen.getByText('Risk scored twice per file')).toBeTruthy()
    expect(screen.getByText('usePrReview.ts:317')).toBeTruthy()
  })
})

describe('AgentPanel — renders a finding body as markdown, so code reads as code', () => {
  it('renders a finding body as markdown, so code reads as code', () => {
    const run = makeRun({
      status: 'done',
      findings: [{ ...finding1, body: '`computeRiskScore` runs twice per file.' }],
    })
    setStoreState({ agentPanelScope: linesScope, agentRuns: [run] })
    render(<AgentPanel repoRoot="/repo" pr={makePr()} currentFilePath={null} />)
    expect(screen.getByRole('code').textContent).toBe('computeRiskScore')
    expect(screen.getByText(/runs twice per file/).textContent).not.toContain('`')
  })
})

describe('AgentPanel — posts a finding as a comment with fromFindingId and the finding line', () => {
  it('posts a finding as a comment with fromFindingId and the finding line', async () => {
    const user = userEvent.setup()
    const run = makeRun({ status: 'done', findings: [finding1, finding2] })
    setStoreState({ agentPanelScope: linesScope, agentRuns: [run] })
    render(<AgentPanel repoRoot="/repo" pr={makePr()} currentFilePath={null} />)

    await user.click(screen.getAllByRole('button', { name: 'Post as comment' })[0])

    expect(useReviewUiStore.getState().composerRequest).toEqual(
      expect.objectContaining({
        fromFindingId: 'f1',
        line: 317,
        path: 'extensions/git-integration/src/hooks/usePrReview.ts',
      })
    )
  })
})

describe('AgentPanel — dismisses a finding and hides its card', () => {
  it('dismisses a finding and hides its card', async () => {
    const user = userEvent.setup()
    const run = makeRun({ status: 'done', findings: [finding1, finding2] })
    setStoreState({ agentPanelScope: linesScope, agentRuns: [run] })
    render(<AgentPanel repoRoot="/repo" pr={makePr()} currentFilePath={null} />)

    expect(screen.getByText('Risk scored twice per file')).toBeTruthy()
    await user.click(screen.getAllByRole('button', { name: 'Dismiss' })[0])

    expect(screen.queryByText('Risk scored twice per file')).toBeNull()
    expect(mockDismiss).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-1', findingId: 'f1' })
    )
  })

  it('closes the panel', async () => {
    const user = userEvent.setup()
    setStoreState({ agentPanelScope: linesScope })
    const { container } = render(
      <AgentPanel repoRoot="/repo" pr={makePr()} currentFilePath={null} />
    )
    await user.click(screen.getByRole('button', { name: 'Close agent panel' }))
    expect(useReviewUiStore.getState().agentPanelScope).toBeNull()
    expect(container.innerHTML).toBe('')
  })
})

const prScope: AgentScope = {
  kind: 'pr',
  path: null,
  startLine: null,
  endLine: null,
  side: null,
  chapter: null,
}

const CURRENT_FILE = 'extensions/git-integration/src/hooks/usePrReview.ts'

describe('AgentPanel — choosing between the current file and the whole PR', () => {
  it('points the panel at the current file, keeping the request', async () => {
    const user = userEvent.setup()
    setStoreState({ agentPanelScope: prScope, agentPanelRequest: 'explain' })
    render(<AgentPanel repoRoot="/repo" pr={makePr()} currentFilePath={CURRENT_FILE} />)

    await user.click(screen.getByRole('radio', { name: 'This file' }))

    expect(useReviewUiStore.getState()).toMatchObject({
      agentPanelScope: { ...prScope, kind: 'file', path: CURRENT_FILE },
      agentPanelRequest: 'explain',
    })
  })

  it('points a file-scoped panel back at the whole PR', async () => {
    const user = userEvent.setup()
    const fileScope = { ...prScope, kind: 'file' as const, path: CURRENT_FILE }
    setStoreState({ agentPanelScope: fileScope })
    render(<AgentPanel repoRoot="/repo" pr={makePr()} currentFilePath={CURRENT_FILE} />)

    await user.click(screen.getByRole('radio', { name: 'Whole PR' }))

    expect(useReviewUiStore.getState()).toMatchObject({
      agentPanelScope: prScope,
      agentPanelRequest: 'review',
    })
  })
})

describe('AgentPanel — no scope choice', () => {
  it('offers no choice for a selection of lines', () => {
    setStoreState({ agentPanelScope: linesScope })
    render(<AgentPanel repoRoot="/repo" pr={makePr()} currentFilePath={CURRENT_FILE} />)

    expect(screen.queryByRole('radio', { name: 'This file' })).toBeNull()
  })

  it('offers no file choice when no file is open', () => {
    setStoreState({ agentPanelScope: prScope })
    render(<AgentPanel repoRoot="/repo" pr={makePr()} currentFilePath={null} />)

    expect(screen.queryByRole('radio', { name: 'This file' })).toBeNull()
  })
})
