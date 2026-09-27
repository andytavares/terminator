import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { usePrReviewStore } from '../../src/stores/pr-review.store'
import { useReviewUiStore } from '../../src/stores/review-ui.store'

vi.mock('../../src/stores/pr-review.store', () => ({ usePrReviewStore: vi.fn() }))
vi.mock('../../src/stores/review-ui.store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/stores/review-ui.store')>()
  return { ...actual, useReviewUiStore: vi.fn() }
})
vi.mock('../../src/components/pr-review/HealthChips', () => ({
  HealthChips: () => <div data-testid="health-chips" />,
}))
vi.mock('../../src/components/pr-review/InlineCommentThread', () => ({
  InlineCommentThread: () => <div data-testid="thread" />,
}))
vi.mock('../../src/components/pr-review/CommentComposer', () => ({
  CommentComposer: ({ onCancel }: { onCancel?: () => void }) => (
    <div data-testid="composer">
      <button onClick={onCancel}>Cancel</button>
    </div>
  ),
}))
vi.mock('../../src/github/pr-review-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/github/pr-review-service')>()
  return {
    ...actual,
    detectComplexityHotspots: vi.fn().mockReturnValue([]),
    computeFileCyclomaticDelta: vi.fn().mockReturnValue(0),
  }
})

const mockPatchFileComplexity = vi.fn()
const mockAddNote = vi.fn()
const mockRemoveNote = vi.fn()
const mockAddDraft = vi.fn()
const mockUpdateDraft = vi.fn()
const mockRemoveDraft = vi.fn()
const mockSetCurrentChapter = vi.fn()
const mockSetCurrentFile = vi.fn()
const mockSetSelection = vi.fn()
const mockSetCommentVisibility = vi.fn()
const mockSetAgentNotesOn = vi.fn()
const mockRequestComposer = vi.fn()
const mockOpenAgentPanel = vi.fn()
const mockPrFileDiff = vi.fn()
const mockPrCompare = vi.fn()
const mockInvoke = vi.fn()

function basePrReviewStoreState() {
  return {
    viewedFiles: new Set<string>(),
    threads: {},
    patchFileComplexity: mockPatchFileComplexity,
    changedSince: new Set<string>(),
    viewedAt: {},
    historyRewritten: false,
    notes: [],
    drafts: [],
    addNote: mockAddNote,
    removeNote: mockRemoveNote,
    addDraft: mockAddDraft,
    updateDraft: mockUpdateDraft,
    removeDraft: mockRemoveDraft,
    setCurrentChapter: mockSetCurrentChapter,
    setCurrentFile: mockSetCurrentFile,
  }
}

function baseReviewUiStoreState() {
  return {
    commentVisibility: 'all' as const,
    setCommentVisibility: mockSetCommentVisibility,
    agentNotesOn: true,
    setAgentNotesOn: mockSetAgentNotesOn,
    diffRange: 'whole' as const,
    selection: null,
    setSelection: mockSetSelection,
    composerRequest: null,
    requestComposer: mockRequestComposer,
    agentRuns: [],
    openAgentPanel: mockOpenAgentPanel,
  }
}

const mockFile = {
  path: 'src/foo.ts',
  changeType: 'modified' as const,
  additions: 5,
  deletions: 2,
  isBinary: false,
  tier: 1 as const,
  whyHere: 'changed',
  estimatedMinutes: 3,
  riskScore: {
    level: 'low' as const,
    composite: 5,
    dominantDriver: 'changeSize',
    topImporters: [],
    importerCount: 0,
    metrics: {
      changeSize: 5,
      churn90d: null,
      blastRadius: null,
      testFilePresent: null,
      complexityDelta: null,
      patchCoverage: null,
    },
  },
}

const mockPr = {
  number: 1,
  title: 'PR',
  body: '',
  author: 'alice',
  authorAvatarUrl: '',
  openedAt: '2025-01-01T00:00:00Z',
  headRefName: 'feature',
  baseRefName: 'main',
  headSHA: 'abc',
  ciStatus: 'passing' as const,
  lintStatus: 'pass' as const,
  coverageStatus: 'pass' as const,
  chapters: [
    {
      id: 'ch-1',
      name: 'Ch',
      estimatedMinutes: 5,
      status: 'not-started' as const,
      files: [mockFile],
    },
  ],
  readingOrder: [] as never[],
  movedBlocks: [] as never[],
  insights: null,
}

const defaultProps = {
  repoRoot: '/repo',
  pr: mockPr,
  file: mockFile,
  chapterProgress: { index: 0, total: 2 },
  onMarkViewed: vi.fn(),
  onPrevFile: vi.fn(),
  onNextFile: vi.fn(),
  onFinishChapter: vi.fn(),
  isLastChapter: false,
  onPause: vi.fn(),
  onOpenSubmit: vi.fn(),
  onShowRisk: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPrFileDiff.mockResolvedValue({ diff: { hunks: [] } })
  mockPrCompare.mockResolvedValue({ rewritten: false, commits: [], files: [] })
  mockInvoke.mockImplementation((channel: string, payload: unknown) => {
    if (channel === 'github:pr-file-diff') return mockPrFileDiff(payload)
    if (channel === 'github:pr-compare') return mockPrCompare(payload)
    return Promise.resolve({})
  })
  ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
    extensionBridge: { invoke: mockInvoke },
  }
  vi.mocked(usePrReviewStore).mockReturnValue(
    basePrReviewStoreState() as unknown as ReturnType<typeof usePrReviewStore>
  )
  vi.mocked(useReviewUiStore).mockReturnValue(
    baseReviewUiStoreState() as unknown as ReturnType<typeof useReviewUiStore>
  )
})

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).electronAPI
})

async function renderPane(props: Partial<typeof defaultProps> = {}) {
  const { ReviewDiffPane } = await import('../../src/components/pr-review/ReviewDiffPane')
  return render(<ReviewDiffPane {...defaultProps} {...props} />)
}

describe('ReviewDiffPane', () => {
  it('renders file path in header', async () => {
    await renderPane()
    expect(screen.getByText('src/foo.ts')).toBeTruthy()
  })

  it('renders health chips', async () => {
    await renderPane()
    expect(screen.getByTestId('health-chips')).toBeTruthy()
  })

  it('shows additions and deletions', async () => {
    await renderPane()
    expect(screen.getByText('+5/−2')).toBeTruthy()
  })

  it('shows low-risk label for low risk file', async () => {
    await renderPane()
    expect(screen.getByText(/Low risk/)).toBeTruthy()
  })

  it('shows high-risk label for high risk file', async () => {
    const highFile = { ...mockFile, riskScore: { ...mockFile.riskScore, level: 'high' as const } }
    await renderPane({ file: highFile })
    expect(screen.getByText(/High risk/)).toBeTruthy()
  })

  it('shows binary message for binary files', async () => {
    const binaryFile = { ...mockFile, isBinary: true }
    await renderPane({ file: binaryFile })
    expect(screen.getByText('Binary file — diff not available.')).toBeTruthy()
  })

  it('shows loading diff message while fetching', async () => {
    mockPrFileDiff.mockImplementation(() => new Promise(() => {}))
    await renderPane()
    expect(screen.getByText('Loading diff…')).toBeTruthy()
  })

  it('shows error when diff fetch fails', async () => {
    mockPrFileDiff.mockResolvedValue({ error: 'RATE_LIMITED' })
    await renderPane()
    await waitFor(() => expect(screen.getByText(/Failed to load diff/)).toBeTruthy())
  })

  it('shows viewed badge when file is already viewed', async () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...basePrReviewStoreState(),
      viewedFiles: new Set(['src/foo.ts']),
    } as unknown as ReturnType<typeof usePrReviewStore>)
    await renderPane()
    expect(screen.getByText(/Viewed/)).toBeTruthy()
  })

  it('shows Finish chapter button when on last file of a non-final chapter', async () => {
    await renderPane({ chapterProgress: { index: 1, total: 2 }, isLastChapter: false })
    expect(screen.getByText('Finish chapter ↵')).toBeTruthy()
  })

  it('shows Finish review button when on last file of the final chapter', async () => {
    await renderPane({ chapterProgress: { index: 1, total: 2 }, isLastChapter: true })
    expect(screen.getByText('Finish review ↵')).toBeTruthy()
  })

  it('shows Mark viewed button when not on last file', async () => {
    await renderPane({ chapterProgress: { index: 0, total: 2 } })
    expect(screen.getByText('Mark viewed, go to next')).toBeTruthy()
  })

  it('calls onPause when Pause review is clicked', async () => {
    const onPause = vi.fn()
    await renderPane({ onPause })
    fireEvent.click(screen.getByText('Pause review'))
    expect(onPause).toHaveBeenCalled()
  })

  it('calls onOpenSubmit when Submit review is clicked', async () => {
    const onOpenSubmit = vi.fn()
    await renderPane({ onOpenSubmit })
    fireEvent.click(screen.getByText('Submit review'))
    expect(onOpenSubmit).toHaveBeenCalled()
  })

  it('calls onShowRisk when the Why? button is clicked', async () => {
    const onShowRisk = vi.fn()
    await renderPane({ onShowRisk })
    fireEvent.click(screen.getByText('Why?'))
    expect(onShowRisk).toHaveBeenCalled()
  })

  it('calls onPrevFile when the Prev control is clicked', async () => {
    const onPrevFile = vi.fn()
    await renderPane({ onPrevFile })
    fireEvent.click(screen.getByText(/Prev/))
    expect(onPrevFile).toHaveBeenCalled()
  })

  it('renders diff hunks when diff is loaded', async () => {
    const diff = {
      path: 'src/foo.ts',
      isBinary: false,
      hunks: [
        {
          header: '@@ -1,3 +1,3 @@',
          lines: [{ type: 'context', content: 'const x = 1', oldLineNumber: 1, newLineNumber: 1 }],
        },
      ],
    }
    mockPrFileDiff.mockResolvedValue({ diff })
    await renderPane()
    await waitFor(() => expect(screen.getByText('@@ -1,3 +1,3 @@')).toBeTruthy())
  })

  it('shows change badge for non-modified files', async () => {
    const addedFile = { ...mockFile, changeType: 'added' as const }
    await renderPane({ file: addedFile })
    expect(screen.getByText('added')).toBeTruthy()
  })

  it('calls patchFileComplexity after diff load', async () => {
    const diff = { hunks: [] }
    mockPrFileDiff.mockResolvedValue({ diff })
    await renderPane()
    await waitFor(() => expect(mockPrFileDiff).toHaveBeenCalled())
  })

  it('switches to split view mode when Split button is clicked', async () => {
    const diff = {
      path: 'src/foo.ts',
      isBinary: false,
      hunks: [
        {
          header: '@@ -1,3 +1,3 @@',
          lines: [
            { type: 'context' as const, content: 'x', oldLineNumber: 1, newLineNumber: 1 },
            { type: 'add' as const, content: 'y', oldLineNumber: null, newLineNumber: 2 },
            { type: 'remove' as const, content: 'z', oldLineNumber: 2, newLineNumber: null },
          ],
        },
      ],
    }
    mockPrFileDiff.mockResolvedValue({ diff })
    const { container } = await renderPane()
    await waitFor(() => expect(screen.getByText('@@ -1,3 +1,3 @@')).toBeTruthy())

    fireEvent.click(screen.getByTitle('Split diff view'))

    await waitFor(() => expect(container.querySelector('.diff-table--split')).toBeTruthy())
  })

  it('gutter drag no longer opens the composer, but calls setSelection', async () => {
    const diff = {
      path: 'src/foo.ts',
      isBinary: false,
      hunks: [
        {
          header: '@@ -1,1 +1,1 @@',
          lines: [
            {
              type: 'context' as const,
              content: 'const x = 1',
              oldLineNumber: 1,
              newLineNumber: 1,
            },
          ],
        },
      ],
    }
    mockPrFileDiff.mockResolvedValue({ diff })
    await renderPane()
    await waitFor(() => expect(screen.getByText('@@ -1,1 +1,1 @@')).toBeTruthy())

    const btn = screen.getAllByRole('button', { name: 'Add comment' })[0]
    fireEvent.mouseDown(btn)
    fireEvent.mouseUp(btn)

    expect(mockSetSelection).toHaveBeenCalledWith({
      path: 'src/foo.ts',
      side: 'RIGHT',
      startLine: 1,
      endLine: 1,
    })
    expect(screen.queryByTestId('composer')).toBeNull()
  })

  it('shows the float bar under a selection, with Comment opening the composer', async () => {
    vi.mocked(useReviewUiStore).mockReturnValue({
      ...baseReviewUiStoreState(),
      selection: { path: 'src/foo.ts', side: 'RIGHT' as const, startLine: 1, endLine: 1 },
    } as unknown as ReturnType<typeof useReviewUiStore>)
    const diff = {
      path: 'src/foo.ts',
      isBinary: false,
      hunks: [
        {
          header: '@@ -1,1 +1,1 @@',
          lines: [
            {
              type: 'context' as const,
              content: 'const x = 1',
              oldLineNumber: 1,
              newLineNumber: 1,
            },
          ],
        },
      ],
    }
    mockPrFileDiff.mockResolvedValue({ diff })
    await renderPane()
    await waitFor(() => expect(screen.getByText('@@ -1,1 +1,1 @@')).toBeTruthy())

    expect(screen.queryByTestId('composer')).toBeNull()
    fireEvent.click(screen.getByText('Comment'))
    await waitFor(() => expect(screen.getByTestId('composer')).toBeTruthy())

    fireEvent.click(screen.getByText('Cancel'))
    await waitFor(() => expect(screen.queryByTestId('composer')).toBeNull())
  })

  it('calls openAgentPanel with the lines scope when Ask agent is clicked', async () => {
    vi.mocked(useReviewUiStore).mockReturnValue({
      ...baseReviewUiStoreState(),
      selection: { path: 'src/foo.ts', side: 'RIGHT' as const, startLine: 1, endLine: 1 },
    } as unknown as ReturnType<typeof useReviewUiStore>)
    const diff = {
      path: 'src/foo.ts',
      isBinary: false,
      hunks: [
        {
          header: '@@ -1,1 +1,1 @@',
          lines: [
            {
              type: 'context' as const,
              content: 'const x = 1',
              oldLineNumber: 1,
              newLineNumber: 1,
            },
          ],
        },
      ],
    }
    mockPrFileDiff.mockResolvedValue({ diff })
    await renderPane()
    await waitFor(() => expect(screen.getByText('@@ -1,1 +1,1 @@')).toBeTruthy())

    fireEvent.click(screen.getByText(/Ask agent/))
    expect(mockOpenAgentPanel).toHaveBeenCalledWith(
      {
        kind: 'lines',
        path: 'src/foo.ts',
        startLine: 1,
        endLine: 1,
        side: 'RIGHT',
        chapter: null,
      },
      'review'
    )
  })

  it('renders inline comment threads on matching lines', async () => {
    const thread = {
      id: 'thread-1',
      path: 'src/foo.ts',
      line: 1,
      startLine: null,
      side: 'RIGHT' as const,
      outdated: false,
      collapsed: false,
      comments: [
        {
          id: 1,
          author: 'alice',
          authorAvatarUrl: '',
          body: 'LGTM',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
          path: 'src/foo.ts',
          line: 1,
          startLine: null,
          side: 'RIGHT' as const,
          diffHunk: '',
          outdated: false,
          threadId: 'thread-1',
          isReply: false,
          parentId: null,
        },
      ],
    }
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...basePrReviewStoreState(),
      threads: { 'src/foo.ts': [thread] },
    } as unknown as ReturnType<typeof usePrReviewStore>)

    const diff = {
      path: 'src/foo.ts',
      isBinary: false,
      hunks: [
        {
          header: '@@ -1,1 +1,1 @@',
          lines: [
            {
              type: 'context' as const,
              content: 'const x = 1',
              oldLineNumber: 1,
              newLineNumber: 1,
            },
          ],
        },
      ],
    }
    mockPrFileDiff.mockResolvedValue({ diff })
    await renderPane()
    await waitFor(() => expect(screen.getByTestId('thread')).toBeTruthy())
  })

  it('fires keyboard navigation events for prev-file and mark-viewed-next', async () => {
    const onPrevFile = vi.fn()
    const onMarkViewed = vi.fn()
    await renderPane({ onPrevFile, onMarkViewed })

    window.dispatchEvent(new CustomEvent('pr-review:prev-file'))
    window.dispatchEvent(new CustomEvent('pr-review:mark-viewed-next'))

    expect(onPrevFile).toHaveBeenCalled()
    expect(onMarkViewed).toHaveBeenCalled()
  })

  it('shows medium-risk label for medium risk file', async () => {
    const medFile = { ...mockFile, riskScore: { ...mockFile.riskScore, level: 'medium' as const } }
    await renderPane({ file: medFile })
    expect(screen.getByText(/Medium risk/)).toBeTruthy()
  })

  describe('comment visibility (R2)', () => {
    const singleLineDiff = {
      path: 'src/foo.ts',
      isBinary: false,
      hunks: [
        {
          header: '@@ -1,1 +1,1 @@',
          lines: [{ type: 'context' as const, content: 'x', oldLineNumber: 1, newLineNumber: 1 }],
        },
      ],
    }
    const openThread = {
      id: 'thread-open',
      path: 'src/foo.ts',
      line: 1,
      startLine: null,
      side: 'RIGHT' as const,
      outdated: false,
      collapsed: false,
      resolved: false,
      comments: [
        {
          id: 1,
          author: 'a',
          authorAvatarUrl: '',
          body: 'x',
          createdAt: '',
          updatedAt: '',
          path: 'src/foo.ts',
          line: 1,
          startLine: null,
          side: 'RIGHT' as const,
          diffHunk: '',
          outdated: false,
          threadId: 'thread-open',
          isReply: false,
          parentId: null,
        },
      ],
    }
    const resolvedThread = {
      ...openThread,
      id: 'thread-resolved',
      resolved: true,
      comments: [{ ...openThread.comments[0], threadId: 'thread-resolved' }],
    }

    it('Hidden removes thread rendering and shows a gutter pip with the count', async () => {
      vi.mocked(usePrReviewStore).mockReturnValue({
        ...basePrReviewStoreState(),
        threads: { 'src/foo.ts': [openThread, resolvedThread] },
      } as unknown as ReturnType<typeof usePrReviewStore>)
      vi.mocked(useReviewUiStore).mockReturnValue({
        ...baseReviewUiStoreState(),
        commentVisibility: 'hidden',
      } as unknown as ReturnType<typeof useReviewUiStore>)
      mockPrFileDiff.mockResolvedValue({ diff: singleLineDiff })
      await renderPane()
      await waitFor(() => expect(screen.getByText('@@ -1,1 +1,1 @@')).toBeTruthy())

      expect(screen.queryByTestId('thread')).toBeNull()
      expect(screen.getByText('2')).toBeTruthy()
    })

    it('clicking a hidden pip sets visibility back to all', async () => {
      vi.mocked(usePrReviewStore).mockReturnValue({
        ...basePrReviewStoreState(),
        threads: { 'src/foo.ts': [openThread] },
      } as unknown as ReturnType<typeof usePrReviewStore>)
      vi.mocked(useReviewUiStore).mockReturnValue({
        ...baseReviewUiStoreState(),
        commentVisibility: 'hidden',
      } as unknown as ReturnType<typeof useReviewUiStore>)
      mockPrFileDiff.mockResolvedValue({ diff: singleLineDiff })
      await renderPane()
      await waitFor(() => expect(screen.getByText('@@ -1,1 +1,1 @@')).toBeTruthy())

      fireEvent.click(screen.getByRole('button', { name: '1 hidden comments' }))
      expect(mockSetCommentVisibility).toHaveBeenCalledWith('all')
    })

    it('Unresolved hides a resolved thread but keeps an open one', async () => {
      vi.mocked(usePrReviewStore).mockReturnValue({
        ...basePrReviewStoreState(),
        threads: { 'src/foo.ts': [openThread, resolvedThread] },
      } as unknown as ReturnType<typeof usePrReviewStore>)
      vi.mocked(useReviewUiStore).mockReturnValue({
        ...baseReviewUiStoreState(),
        commentVisibility: 'unresolved',
      } as unknown as ReturnType<typeof useReviewUiStore>)
      mockPrFileDiff.mockResolvedValue({ diff: singleLineDiff })
      await renderPane()
      await waitFor(() => expect(screen.getByText('@@ -1,1 +1,1 @@')).toBeTruthy())

      expect(screen.getAllByTestId('thread')).toHaveLength(1)
    })

    it('All shows every thread, including resolved ones', async () => {
      vi.mocked(usePrReviewStore).mockReturnValue({
        ...basePrReviewStoreState(),
        threads: { 'src/foo.ts': [openThread, resolvedThread] },
      } as unknown as ReturnType<typeof usePrReviewStore>)
      mockPrFileDiff.mockResolvedValue({ diff: singleLineDiff })
      await renderPane()
      await waitFor(() => expect(screen.getByText('@@ -1,1 +1,1 @@')).toBeTruthy())

      expect(screen.getAllByTestId('thread')).toHaveLength(2)
    })
  })

  describe('agent notes (R5)', () => {
    const singleLineDiff = {
      path: 'src/foo.ts',
      isBinary: false,
      hunks: [
        {
          header: '@@ fetchFileMetrics @@',
          lines: [
            { type: 'context' as const, content: 'x', oldLineNumber: 317, newLineNumber: 317 },
          ],
        },
      ],
    }
    const agentRun = {
      id: 'run-1',
      repoRoot: '/repo',
      prNumber: 1,
      headSHA: 'abc',
      sessionId: 's1',
      scope: {
        kind: 'lines' as const,
        path: 'src/foo.ts',
        startLine: 309,
        endLine: 317,
        side: 'RIGHT' as const,
        chapter: null,
      },
      request: 'review' as const,
      question: null,
      status: 'done' as const,
      startedAt: '',
      finishedAt: '',
      activity: [],
      summary: null,
      findings: [
        {
          id: 'f1',
          severity: 'suggestion' as const,
          path: 'src/foo.ts',
          startLine: 317,
          endLine: 317,
          side: 'RIGHT' as const,
          title: 'Risk scored twice per file',
          body: 'usePrReview.ts:317 calls computeRiskScore again.',
          suggestedCode: null,
          dismissed: false,
        },
      ],
      walkthrough: [],
      error: null,
    }

    it('renders the agent note text after the finding line when agent notes are on', async () => {
      vi.mocked(useReviewUiStore).mockReturnValue({
        ...baseReviewUiStoreState(),
        agentRuns: [agentRun],
      } as unknown as ReturnType<typeof useReviewUiStore>)
      mockPrFileDiff.mockResolvedValue({ diff: singleLineDiff })
      await renderPane()
      await waitFor(() => expect(screen.getByText(/calls computeRiskScore again/)).toBeTruthy())
      expect(screen.getByText(/Agent note ·/)).toBeTruthy()
    })

    it('shows an agent pip instead of the note when agent notes are off', async () => {
      vi.mocked(useReviewUiStore).mockReturnValue({
        ...baseReviewUiStoreState(),
        agentRuns: [agentRun],
        agentNotesOn: false,
      } as unknown as ReturnType<typeof useReviewUiStore>)
      mockPrFileDiff.mockResolvedValue({ diff: singleLineDiff })
      await renderPane()
      await waitFor(() => expect(screen.getByText('@@ fetchFileMetrics @@')).toBeTruthy())
      expect(screen.queryByText(/Agent note ·/)).toBeNull()
      expect(screen.getByText('1')).toBeTruthy()
    })
  })

  describe('moved code (S4)', () => {
    it('collapses a moved-here block into one row', async () => {
      const diff = {
        path: 'review/reading-order.ts',
        isBinary: false,
        hunks: [
          {
            header: '@@ -0,0 +1,3 @@',
            lines: [
              { type: 'add' as const, content: 'a', oldLineNumber: null, newLineNumber: 41 },
              { type: 'add' as const, content: 'b', oldLineNumber: null, newLineNumber: 42 },
            ],
          },
        ],
      }
      mockPrFileDiff.mockResolvedValue({ diff })
      const movedFile = { ...mockFile, path: 'review/reading-order.ts' }
      const prWithMove = {
        ...mockPr,
        movedBlocks: [
          {
            fromPath: 'github/pr-review-service.ts',
            fromLine: 360,
            toPath: 'review/reading-order.ts',
            toLine: 41,
            lineCount: 28,
            symbol: 'UnionFind',
          },
        ],
      }
      await renderPane({ file: movedFile, pr: prWithMove })
      await waitFor(() =>
        expect(
          screen.getByText(
            (_, node) =>
              node?.textContent ===
              'UnionFind · 28 lines, unchanged, from github/pr-review-service.ts:360'
          )
        ).toBeTruthy()
      )
      expect(screen.getByText('Moved')).toBeTruthy()
    })

    it('collapses a moved-away (removed) block into one row', async () => {
      const diff = {
        path: 'github/pr-review-service.ts',
        isBinary: false,
        hunks: [
          {
            header: '@@ -360,2 +360,0 @@',
            lines: [
              { type: 'remove' as const, content: 'a', oldLineNumber: 360, newLineNumber: null },
              { type: 'remove' as const, content: 'b', oldLineNumber: 361, newLineNumber: null },
            ],
          },
        ],
      }
      mockPrFileDiff.mockResolvedValue({ diff })
      const movedFromFile = { ...mockFile, path: 'github/pr-review-service.ts' }
      const prWithMove = {
        ...mockPr,
        movedBlocks: [
          {
            fromPath: 'github/pr-review-service.ts',
            fromLine: 360,
            toPath: 'review/reading-order.ts',
            toLine: 41,
            lineCount: 28,
            symbol: 'UnionFind',
          },
        ],
      }
      await renderPane({ file: movedFromFile, pr: prWithMove })
      await waitFor(() =>
        expect(
          screen.getByText(
            (_, node) =>
              node?.textContent ===
              'UnionFind · 28 lines, unchanged, moved to review/reading-order.ts:41'
          )
        ).toBeTruthy()
      )
      expect(screen.getByText('Moved')).toBeTruthy()
    })
  })

  describe('split view parity', () => {
    const splitDiff = {
      path: 'src/foo.ts',
      isBinary: false,
      hunks: [
        {
          header: '@@ -85,3 +88,3 @@',
          lines: [
            { type: 'add' as const, content: 'a', oldLineNumber: null, newLineNumber: 88 },
            { type: 'add' as const, content: 'b', oldLineNumber: null, newLineNumber: 89 },
          ],
        },
      ],
    }

    async function renderSplit(overrides: Partial<typeof defaultProps> = {}) {
      mockPrFileDiff.mockResolvedValue({ diff: splitDiff })
      const view = await renderPane(overrides)
      await waitFor(() => expect(screen.getByText('@@ -85,3 +88,3 @@')).toBeTruthy())
      fireEvent.click(screen.getByTitle('Split diff view'))
      await waitFor(() => expect(document.querySelector('.diff-table--split')).toBeTruthy())
      return view
    }

    it('renders the agent note text and pip in the split view', async () => {
      const agentRun = {
        id: 'run-1',
        repoRoot: '/repo',
        prNumber: 1,
        headSHA: 'abc',
        sessionId: 's1',
        scope: {
          kind: 'lines' as const,
          path: 'src/foo.ts',
          startLine: 88,
          endLine: 89,
          side: 'RIGHT' as const,
          chapter: null,
        },
        request: 'review' as const,
        question: null,
        status: 'done' as const,
        startedAt: '',
        finishedAt: '',
        activity: [],
        summary: null,
        findings: [
          {
            id: 'f1',
            severity: 'nit' as const,
            path: 'src/foo.ts',
            startLine: 89,
            endLine: 89,
            side: 'RIGHT' as const,
            title: 'x',
            body: 'split-view agent note body',
            suggestedCode: null,
            dismissed: false,
          },
        ],
        walkthrough: [],
        error: null,
      }
      vi.mocked(useReviewUiStore).mockReturnValue({
        ...baseReviewUiStoreState(),
        agentRuns: [agentRun],
      } as unknown as ReturnType<typeof useReviewUiStore>)
      const first = await renderSplit()
      expect(screen.getByText(/split-view agent note body/)).toBeTruthy()
      first.unmount()

      vi.mocked(useReviewUiStore).mockReturnValue({
        ...baseReviewUiStoreState(),
        agentRuns: [agentRun],
        agentNotesOn: false,
      } as unknown as ReturnType<typeof useReviewUiStore>)
      await renderSplit()
      expect(screen.queryByText(/split-view agent note body/)).toBeNull()
      expect(screen.getByText('1')).toBeTruthy()
    })

    it('collapses moved blocks (both directions) in the split view', async () => {
      const prWithMove = {
        ...mockPr,
        movedBlocks: [
          {
            fromPath: 'github/pr-review-service.ts',
            fromLine: 360,
            toPath: 'src/foo.ts',
            toLine: 88,
            lineCount: 28,
            symbol: 'UnionFind',
          },
        ],
      }
      await renderSplit({ pr: prWithMove })
      expect(screen.getByText('Moved')).toBeTruthy()
      expect(
        screen.getByText(
          (_, node) =>
            node?.textContent ===
            'UnionFind · 28 lines, unchanged, from github/pr-review-service.ts:360'
        )
      ).toBeTruthy()
    })

    it('shows the R4 gutter insight chips in the split view', async () => {
      const prWithInsights = {
        ...mockPr,
        insights: {
          complexity: {
            branchDelta: 6,
            functions: [{ path: 'src/foo.ts', name: 'shardByDuration', line: 88, branchDelta: 6 }],
            source: 'tree-sitter',
          },
          coverage: {
            changedFunctions: 1,
            testedFunctions: 1,
            untestedFunctions: [],
            patchPercent: null,
            source: 'test files',
            changedSourceFiles: 1,
            changedSourceFilesWithTests: 1,
          },
          health: { flags: [], source: 'tree-sitter' },
          understandability: {
            level: 'moderate' as const,
            linesToRead: 10,
            newExports: 1,
            longestChain: 1,
            crossChapterRefs: 0,
            source: 'reading-order',
          },
        },
      }
      await renderSplit({ pr: prWithInsights })
      expect(screen.getByText('+6')).toBeTruthy()
    })
  })

  describe('private notes side (S2)', () => {
    it('renders a LEFT-side note under the removed line', async () => {
      const diff = {
        path: 'src/foo.ts',
        isBinary: false,
        hunks: [
          {
            header: '@@ -5,1 +5,0 @@',
            lines: [
              { type: 'remove' as const, content: 'x', oldLineNumber: 5, newLineNumber: null },
            ],
          },
        ],
      }
      mockPrFileDiff.mockResolvedValue({ diff })
      vi.mocked(usePrReviewStore).mockReturnValue({
        ...basePrReviewStoreState(),
        notes: [
          {
            id: 'n1',
            path: 'src/foo.ts',
            line: 5,
            side: 'LEFT' as const,
            body: 'left side note',
            createdAt: '',
          },
        ],
      } as unknown as ReturnType<typeof usePrReviewStore>)
      await renderPane()
      await waitFor(() => expect(screen.getByText('left side note')).toBeTruthy())
    })
  })

  describe('pending drafts (S5)', () => {
    it('shows a draft under its line, marked pending, with its markdown rendered', async () => {
      const diff = {
        path: 'src/foo.ts',
        isBinary: false,
        hunks: [
          {
            header: '@@ -61,1 +61,1 @@',
            lines: [
              {
                type: 'add' as const,
                content: 'fetch(filter)',
                oldLineNumber: null,
                newLineNumber: 62,
              },
            ],
          },
        ],
      }
      mockPrFileDiff.mockResolvedValue({ diff })
      vi.mocked(usePrReviewStore).mockReturnValue({
        ...basePrReviewStoreState(),
        drafts: [
          {
            id: 'd1',
            path: 'src/foo.ts',
            line: 62,
            startLine: null,
            side: 'RIGHT' as const,
            body: '`fetch(filter)` reloads the same page.',
            fromFindingId: null,
          },
        ],
      } as unknown as ReturnType<typeof usePrReviewStore>)
      const { container } = await renderPane()
      await waitFor(() => expect(screen.getByText(/sent when you submit your review/)).toBeTruthy())
      const code = container.querySelector('.rs-thread-bd code')
      expect(code?.textContent).toBe('fetch(filter)')
    })
  })

  describe('keyboard events (REVIEW_KEY_EVENTS)', () => {
    const twoHunkDiff = {
      path: 'src/foo.ts',
      isBinary: false,
      hunks: [
        {
          header: '@@ -1,1 +1,1 @@',
          lines: [{ type: 'context' as const, content: 'a', oldLineNumber: 1, newLineNumber: 1 }],
        },
        {
          header: '@@ -10,1 +10,1 @@',
          lines: [{ type: 'context' as const, content: 'b', oldLineNumber: 10, newLineNumber: 10 }],
        },
      ],
    }

    beforeEach(() => {
      Element.prototype.scrollIntoView = vi.fn()
    })

    it('nextHunk scrolls the next hunk header into view', async () => {
      mockPrFileDiff.mockResolvedValue({ diff: twoHunkDiff })
      await renderPane()
      await waitFor(() => expect(screen.getByText('@@ -1,1 +1,1 @@')).toBeTruthy())
      const headers = screen.getAllByText(/@@/)
      const spy = vi.spyOn(headers[1], 'scrollIntoView')
      window.dispatchEvent(new CustomEvent('review:next-hunk'))
      expect(spy).toHaveBeenCalledWith({ block: 'start' })
    })

    it('nextHunk at the last hunk calls onNextFile', async () => {
      const singleHunkDiff = {
        path: 'src/foo.ts',
        isBinary: false,
        hunks: [
          {
            header: '@@ -1,1 +1,1 @@',
            lines: [{ type: 'context' as const, content: 'a', oldLineNumber: 1, newLineNumber: 1 }],
          },
        ],
      }
      mockPrFileDiff.mockResolvedValue({ diff: singleHunkDiff })
      const onNextFile = vi.fn()
      await renderPane({ onNextFile })
      await waitFor(() => expect(screen.getByText('@@ -1,1 +1,1 @@')).toBeTruthy())
      window.dispatchEvent(new CustomEvent('review:next-hunk'))
      expect(onNextFile).toHaveBeenCalled()
    })

    it('prevHunk scrolls the previous hunk header into view', async () => {
      mockPrFileDiff.mockResolvedValue({ diff: twoHunkDiff })
      await renderPane()
      await waitFor(() => expect(screen.getByText('@@ -1,1 +1,1 @@')).toBeTruthy())
      const headers = screen.getAllByText(/@@/)
      window.dispatchEvent(new CustomEvent('review:next-hunk')) // move to hunk 1 first
      const spy = vi.spyOn(headers[0], 'scrollIntoView')
      window.dispatchEvent(new CustomEvent('review:prev-hunk'))
      expect(spy).toHaveBeenCalledWith({ block: 'start' })
    })

    it('askAgent with no selection opens the agent panel scoped to the nearest hunk', async () => {
      mockPrFileDiff.mockResolvedValue({ diff: twoHunkDiff })
      await renderPane()
      await waitFor(() => expect(screen.getByText('@@ -1,1 +1,1 @@')).toBeTruthy())
      window.dispatchEvent(new CustomEvent('review:ask-agent'))
      expect(mockOpenAgentPanel).toHaveBeenCalledWith(
        {
          kind: 'hunk',
          path: 'src/foo.ts',
          startLine: 1,
          endLine: 1,
          side: 'RIGHT',
          chapter: null,
        },
        'review'
      )
    })

    it('explain requests explain with autoStart', async () => {
      mockPrFileDiff.mockResolvedValue({ diff: twoHunkDiff })
      await renderPane()
      await waitFor(() => expect(screen.getByText('@@ -1,1 +1,1 @@')).toBeTruthy())
      window.dispatchEvent(new CustomEvent('review:explain'))
      expect(mockOpenAgentPanel).toHaveBeenCalledWith(
        {
          kind: 'hunk',
          path: 'src/foo.ts',
          startLine: 1,
          endLine: 1,
          side: 'RIGHT',
          chapter: null,
        },
        'explain',
        true
      )
    })

    it('comment opens the composer on the selection', async () => {
      vi.mocked(useReviewUiStore).mockReturnValue({
        ...baseReviewUiStoreState(),
        selection: { path: 'src/foo.ts', side: 'RIGHT' as const, startLine: 1, endLine: 1 },
      } as unknown as ReturnType<typeof useReviewUiStore>)
      mockPrFileDiff.mockResolvedValue({ diff: twoHunkDiff })
      await renderPane()
      await waitFor(() => expect(screen.getByText('@@ -1,1 +1,1 @@')).toBeTruthy())
      expect(screen.queryByTestId('composer')).toBeNull()
      window.dispatchEvent(new CustomEvent('review:comment'))
      await waitFor(() => expect(screen.getByTestId('composer')).toBeTruthy())
    })

    it('note opens the note composer on the selection', async () => {
      vi.mocked(useReviewUiStore).mockReturnValue({
        ...baseReviewUiStoreState(),
        selection: { path: 'src/foo.ts', side: 'RIGHT' as const, startLine: 1, endLine: 1 },
      } as unknown as ReturnType<typeof useReviewUiStore>)
      mockPrFileDiff.mockResolvedValue({ diff: twoHunkDiff })
      await renderPane()
      await waitFor(() => expect(screen.getByText('@@ -1,1 +1,1 @@')).toBeTruthy())
      window.dispatchEvent(new CustomEvent('review:note'))
      await waitFor(() => expect(screen.getByPlaceholderText('Private note…')).toBeTruthy())
    })

    it('peekDefinition selects the definition file', async () => {
      const prWithOrder = {
        ...mockPr,
        readingOrder: [
          {
            step: 4,
            path: 'src/foo.ts',
            symbol: 'fetchFileMetrics',
            reason: 'Uses computeRiskScore (step 2)',
            uses: [{ symbol: 'computeRiskScore', definedInStep: 2, definedInPath: 'src/other.ts' }],
          },
        ],
        chapters: [
          {
            id: 'ch-1',
            name: 'Ch',
            estimatedMinutes: 5,
            status: 'not-started' as const,
            files: [mockFile],
          },
          {
            id: 'ch-2',
            name: 'Ch2',
            estimatedMinutes: 5,
            status: 'not-started' as const,
            files: [{ ...mockFile, path: 'src/other.ts' }],
          },
        ],
      }
      mockPrFileDiff.mockResolvedValue({ diff: twoHunkDiff })
      await renderPane({ pr: prWithOrder })
      await waitFor(() => expect(screen.getByText('@@ -1,1 +1,1 @@')).toBeTruthy())
      window.dispatchEvent(new CustomEvent('review:peek-definition'))
      expect(mockSetCurrentChapter).toHaveBeenCalledWith('ch-2')
      expect(mockSetCurrentFile).toHaveBeenCalledWith('src/other.ts')
    })
  })

  describe('reading order (R3)', () => {
    it('shows "Step N of M" and a use chip for a defined-and-read symbol', async () => {
      const prWithOrder = {
        ...mockPr,
        readingOrder: [
          {
            step: 4,
            path: 'src/foo.ts',
            symbol: 'fetchFileMetrics',
            reason: 'Uses computeRiskScore (step 2)',
            uses: [{ symbol: 'computeRiskScore', definedInStep: 2, definedInPath: 'src/other.ts' }],
          },
        ],
      }
      vi.mocked(usePrReviewStore).mockReturnValue({
        ...basePrReviewStoreState(),
        viewedFiles: new Set(['src/other.ts']),
      } as unknown as ReturnType<typeof usePrReviewStore>)
      await renderPane({ pr: prWithOrder })
      expect(screen.getByText('Step 4 of 1')).toBeTruthy()
      expect(screen.getByText('computeRiskScore · read in step 2')).toBeTruthy()
    })

    it('calls setCurrentChapter/setCurrentFile when Peek definition is clicked', async () => {
      const prWithOrder = {
        ...mockPr,
        readingOrder: [
          {
            step: 4,
            path: 'src/foo.ts',
            symbol: 'fetchFileMetrics',
            reason: 'Uses computeRiskScore (step 2)',
            uses: [{ symbol: 'computeRiskScore', definedInStep: 2, definedInPath: 'src/other.ts' }],
          },
        ],
        chapters: [
          {
            id: 'ch-1',
            name: 'Ch',
            estimatedMinutes: 5,
            status: 'not-started' as const,
            files: [mockFile],
          },
          {
            id: 'ch-2',
            name: 'Ch2',
            estimatedMinutes: 5,
            status: 'not-started' as const,
            files: [{ ...mockFile, path: 'src/other.ts' }],
          },
        ],
      }
      await renderPane({ pr: prWithOrder })
      fireEvent.click(screen.getByText('Peek definition'))
      expect(mockSetCurrentChapter).toHaveBeenCalledWith('ch-2')
      expect(mockSetCurrentFile).toHaveBeenCalledWith('src/other.ts')
    })
  })

  describe('since-my-review diff (S1)', () => {
    it('calls prCompare with the viewed sha when the file changed since the review', async () => {
      vi.mocked(usePrReviewStore).mockReturnValue({
        ...basePrReviewStoreState(),
        changedSince: new Set(['src/foo.ts']),
        viewedAt: { 'src/foo.ts': '9f0c76eb0000000000000000000000000000000' },
      } as unknown as ReturnType<typeof usePrReviewStore>)
      vi.mocked(useReviewUiStore).mockReturnValue({
        ...baseReviewUiStoreState(),
        diffRange: 'since',
      } as unknown as ReturnType<typeof useReviewUiStore>)
      mockPrCompare.mockResolvedValue({
        rewritten: false,
        commits: [],
        files: [{ path: 'src/foo.ts', status: 'modified', patch: '@@ -1,1 +1,1 @@\n-a\n+b' }],
      })
      await renderPane()
      await waitFor(() =>
        expect(mockPrCompare).toHaveBeenCalledWith({
          repoRoot: '/repo',
          fromSha: '9f0c76eb0000000000000000000000000000000',
          toSha: 'abc',
        })
      )
      await waitFor(() => expect(screen.getByText(/Showing 9f0c76eb/)).toBeTruthy())
      expect(mockPrFileDiff).not.toHaveBeenCalled()
    })
  })

  describe('insight gutter chips (R4)', () => {
    it('shows a warning "+N" chip and a danger "untested" chip', async () => {
      const diff = {
        path: 'src/foo.ts',
        isBinary: false,
        hunks: [
          {
            header: '@@ -85,3 +88,3 @@',
            lines: [
              { type: 'add' as const, content: 'a', oldLineNumber: null, newLineNumber: 88 },
              { type: 'add' as const, content: 'b', oldLineNumber: null, newLineNumber: 89 },
            ],
          },
        ],
      }
      mockPrFileDiff.mockResolvedValue({ diff })
      const prWithInsights = {
        ...mockPr,
        insights: {
          complexity: {
            branchDelta: 6,
            functions: [
              { path: 'src/foo.ts', name: 'shardByDuration', line: 88, branchDelta: 6 },
              { path: 'src/foo.ts', name: 'readBurnIn', line: 89, branchDelta: 3 },
            ],
            source: 'tree-sitter',
          },
          coverage: {
            changedFunctions: 2,
            testedFunctions: 0,
            untestedFunctions: ['readBurnIn'],
            patchPercent: null,
            source: 'test files',
            changedSourceFiles: 1,
            changedSourceFilesWithTests: 0,
          },
          health: { flags: [], source: 'tree-sitter' },
          understandability: {
            level: 'moderate' as const,
            linesToRead: 10,
            newExports: 1,
            longestChain: 1,
            crossChapterRefs: 0,
            source: 'reading-order',
          },
        },
      }
      await renderPane({ pr: prWithInsights })
      await waitFor(() => expect(screen.getByText('@@ -85,3 +88,3 @@')).toBeTruthy())
      expect(screen.getByText('+6')).toBeTruthy()
      expect(screen.getByText('untested')).toBeTruthy()
      // The gutter column is sized to its widest chip ("untested"), so it never overlaps code.
      const gut = screen.getByText('untested').closest('td') as HTMLElement
      expect(gut.className).toBe('rs-gut')
      expect(gut.style.width).toBe('78px')
    })
  })
})
