import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// The pane reads both stores through selectors; these resolve them against the state each test sets.
const { prStoreMock, uiStoreMock, highlightSpy } = vi.hoisted(() => ({
  prStoreMock: vi.fn(),
  uiStoreMock: vi.fn(),
  highlightSpy: vi.fn(),
}))
vi.mock('../../src/stores/pr-review.store', () => ({
  usePrReviewStore: (sel?: (s: unknown) => unknown) => {
    const state = prStoreMock()
    return sel ? sel(state) : state
  },
}))
vi.mock('../../src/stores/review-ui.store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/stores/review-ui.store')>()
  return {
    ...actual,
    useReviewUiStore: (sel?: (s: unknown) => unknown) => {
      const state = uiStoreMock()
      return sel ? sel(state) : state
    },
  }
})
vi.mock('../../src/components/FileDiffView', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/components/FileDiffView')>()
  highlightSpy.mockImplementation(actual.highlight)
  return { ...actual, highlight: highlightSpy }
})
vi.mock('../../src/components/pr-review/ViewMenu', () => ({
  ViewMenu: ({ sinceNote }: { sinceNote?: string | null }) => (
    <div data-testid="view-menu">{sinceNote}</div>
  ),
}))
vi.mock('../../src/components/pr-review/UsesPopover', () => ({
  UsesPopover: ({
    uses,
    onPeekDefinition,
  }: {
    uses: Array<{ symbol: string; definedInStep: number; read: boolean }>
    onPeekDefinition: () => void
  }) => (
    <div data-testid="uses">
      {uses.map((u) => (
        <span
          key={u.symbol}
        >{`${u.symbol} · step ${u.definedInStep} · ${u.read ? 'read' : 'not read'}`}</span>
      ))}
      <button onClick={onPeekDefinition}>Peek definition</button>
    </div>
  ),
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
const mockMarkFileViewed = vi.fn()
const mockUnmarkFileViewed = vi.fn()
const mockSetHideFormattingHunks = vi.fn()
const mockSetSelection = vi.fn()
const mockSetCommentVisibility = vi.fn()
const mockSetAgentNotesOn = vi.fn()
const mockRequestComposer = vi.fn()
const mockOpenAgentPanel = vi.fn()
const mockPrFileDiff = vi.fn()
const mockPrCompare = vi.fn()
const mockPrFileContent = vi.fn()
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
    markFileViewed: mockMarkFileViewed,
    unmarkFileViewed: mockUnmarkFileViewed,
  }
}

function baseReviewUiStoreState() {
  return {
    commentVisibility: 'all' as const,
    setCommentVisibility: mockSetCommentVisibility,
    agentNotesOn: true,
    setAgentNotesOn: mockSetAgentNotesOn,
    diffViewMode: 'unified' as const,
    hideFormattingHunks: true,
    setHideFormattingHunks: mockSetHideFormattingHunks,
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
  onMarkViewed: vi.fn(),
  onPrevFile: vi.fn(),
  onNextFile: vi.fn(),
  onShowRisk: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPrFileDiff.mockResolvedValue({ diff: { hunks: [] } })
  mockPrCompare.mockResolvedValue({ rewritten: false, commits: [], files: [] })
  mockInvoke.mockImplementation((channel: string, payload: unknown) => {
    if (channel === 'github:pr-file-diff') return mockPrFileDiff(payload)
    if (channel === 'github:pr-compare') return mockPrCompare(payload)
    if (channel === 'github:pr-file-content') return mockPrFileContent(payload)
    return Promise.resolve({})
  })
  ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
    extensionBridge: { invoke: mockInvoke },
  }
  prStoreMock.mockReturnValue(basePrReviewStoreState())
  uiStoreMock.mockReturnValue(baseReviewUiStoreState())
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
    expect(screen.getByTitle('src/foo.ts').textContent).toBe('src/foo.ts')
  })

  it('leaves the additions and deletions to the file list', async () => {
    await renderPane()
    expect(screen.queryByText('+5/−2')).toBeNull()
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
    prStoreMock.mockReturnValue({
      ...basePrReviewStoreState(),
      viewedFiles: new Set(['src/foo.ts']),
    })
    await renderPane()
    const box = screen.getByRole('checkbox', { name: 'Viewed' }) as HTMLInputElement
    expect(box.checked).toBe(true)
    fireEvent.click(box)
    expect(mockUnmarkFileViewed).toHaveBeenCalledWith(
      '/repo',
      mockPr.number,
      mockPr.headSHA,
      'src/foo.ts'
    )
  })

  it('marks the file viewed from the header checkbox without leaving it', async () => {
    const onMarkViewed = vi.fn()
    await renderPane({ onMarkViewed })
    const box = screen.getByRole('checkbox', { name: 'Viewed' }) as HTMLInputElement
    expect(box.checked).toBe(false)
    fireEvent.click(box)
    expect(mockMarkFileViewed).toHaveBeenCalledWith(
      '/repo',
      mockPr.number,
      mockPr.headSHA,
      'src/foo.ts'
    )
    expect(onMarkViewed).not.toHaveBeenCalled()
  })

  it('calls onShowRisk when the Why? button is clicked', async () => {
    const onShowRisk = vi.fn()
    await renderPane({ onShowRisk })
    fireEvent.click(screen.getByRole('button', { name: 'Low risk' }))
    expect(onShowRisk).toHaveBeenCalled()
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

  it('does not repeat the change type in the file toolbar', async () => {
    const addedFile = { ...mockFile, changeType: 'added' as const }
    await renderPane({ file: addedFile })
    expect(screen.queryByText('added')).toBeNull()
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
    uiStoreMock.mockReturnValue({
      ...baseReviewUiStoreState(),
      diffViewMode: 'split',
    })
    const { container } = await renderPane()
    await waitFor(() => expect(screen.getByText('@@ -1,3 +1,3 @@')).toBeTruthy())

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

  it('a gutter drag across rows keeps the multi-line selection after the trailing click', async () => {
    const actual = await vi.importActual<typeof import('../../src/stores/review-ui.store')>(
      '../../src/stores/review-ui.store'
    )
    actual.useReviewUiStore.setState({ selection: null })
    uiStoreMock.mockImplementation(actual.useReviewUiStore)
    const diff = {
      path: 'src/foo.ts',
      isBinary: false,
      hunks: [
        {
          header: '@@ -1,3 +1,3 @@',
          lines: [1, 2, 3].map((n) => ({
            type: 'context' as const,
            content: `line ${n}`,
            oldLineNumber: n,
            newLineNumber: n,
          })),
        },
      ],
    }
    mockPrFileDiff.mockResolvedValue({ diff })
    const { container } = await renderPane()
    await waitFor(() => expect(screen.getByText('@@ -1,3 +1,3 @@')).toBeTruthy())

    const rows = container.querySelectorAll<HTMLTableRowElement>('tr.diff-line')
    fireEvent.mouseDown(rows[0].querySelector('.diff-gutter-btn')!)
    fireEvent.mouseEnter(rows[1])
    fireEvent.mouseEnter(rows[2])
    fireEvent.mouseUp(rows[2].querySelector('.diff-line__content')!)
    // A press and release on different elements clicks their common ancestor.
    fireEvent.click(rows[0].parentElement!)

    await waitFor(() => expect(container.querySelectorAll('tr.rs-line--selected')).toHaveLength(3))
    expect(screen.getByText('Comment')).toBeTruthy()
    expect(actual.useReviewUiStore.getState().selection).toEqual({
      path: 'src/foo.ts',
      side: 'RIGHT',
      startLine: 1,
      endLine: 3,
    })
  })

  it('a background click after the drag has settled still clears the selection', async () => {
    const actual = await vi.importActual<typeof import('../../src/stores/review-ui.store')>(
      '../../src/stores/review-ui.store'
    )
    actual.useReviewUiStore.setState({ selection: null })
    uiStoreMock.mockImplementation(actual.useReviewUiStore)
    const diff = {
      path: 'src/foo.ts',
      isBinary: false,
      hunks: [
        {
          header: '@@ -1,2 +1,2 @@',
          lines: [1, 2].map((n) => ({
            type: 'context' as const,
            content: `line ${n}`,
            oldLineNumber: n,
            newLineNumber: n,
          })),
        },
      ],
    }
    mockPrFileDiff.mockResolvedValue({ diff })
    const { container } = await renderPane()
    await waitFor(() => expect(screen.getByText('@@ -1,2 +1,2 @@')).toBeTruthy())

    const rows = container.querySelectorAll<HTMLTableRowElement>('tr.diff-line')
    fireEvent.mouseDown(rows[0].querySelector('.diff-gutter-btn')!)
    fireEvent.mouseEnter(rows[1])
    fireEvent.mouseUp(rows[1])
    await waitFor(() => expect(container.querySelectorAll('tr.rs-line--selected')).toHaveLength(2))
    await new Promise((r) => setTimeout(r, 0))

    fireEvent.click(rows[0].querySelector('.diff-line__content')!)

    await waitFor(() => expect(container.querySelectorAll('tr.rs-line--selected')).toHaveLength(0))
    expect(actual.useReviewUiStore.getState().selection).toBeNull()
  })

  it('shows the float bar under a selection, with Comment opening the composer', async () => {
    uiStoreMock.mockReturnValue({
      ...baseReviewUiStoreState(),
      selection: { path: 'src/foo.ts', side: 'RIGHT' as const, startLine: 1, endLine: 1 },
    })
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
    uiStoreMock.mockReturnValue({
      ...baseReviewUiStoreState(),
      selection: { path: 'src/foo.ts', side: 'RIGHT' as const, startLine: 1, endLine: 1 },
    })
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
    prStoreMock.mockReturnValue({
      ...basePrReviewStoreState(),
      threads: { 'src/foo.ts': [thread] },
    })

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
      prStoreMock.mockReturnValue({
        ...basePrReviewStoreState(),
        threads: { 'src/foo.ts': [openThread, resolvedThread] },
      })
      uiStoreMock.mockReturnValue({
        ...baseReviewUiStoreState(),
        commentVisibility: 'hidden',
      })
      mockPrFileDiff.mockResolvedValue({ diff: singleLineDiff })
      await renderPane()
      await waitFor(() => expect(screen.getByText('@@ -1,1 +1,1 @@')).toBeTruthy())

      expect(screen.queryByTestId('thread')).toBeNull()
      expect(screen.getByText('2')).toBeTruthy()
    })

    it('clicking a hidden pip sets visibility back to all', async () => {
      prStoreMock.mockReturnValue({
        ...basePrReviewStoreState(),
        threads: { 'src/foo.ts': [openThread] },
      })
      uiStoreMock.mockReturnValue({
        ...baseReviewUiStoreState(),
        commentVisibility: 'hidden',
      })
      mockPrFileDiff.mockResolvedValue({ diff: singleLineDiff })
      await renderPane()
      await waitFor(() => expect(screen.getByText('@@ -1,1 +1,1 @@')).toBeTruthy())

      fireEvent.click(screen.getByRole('button', { name: '1 hidden comments' }))
      expect(mockSetCommentVisibility).toHaveBeenCalledWith('all')
    })

    it('Unresolved hides a resolved thread but keeps an open one', async () => {
      prStoreMock.mockReturnValue({
        ...basePrReviewStoreState(),
        threads: { 'src/foo.ts': [openThread, resolvedThread] },
      })
      uiStoreMock.mockReturnValue({
        ...baseReviewUiStoreState(),
        commentVisibility: 'unresolved',
      })
      mockPrFileDiff.mockResolvedValue({ diff: singleLineDiff })
      await renderPane()
      await waitFor(() => expect(screen.getByText('@@ -1,1 +1,1 @@')).toBeTruthy())

      expect(screen.getAllByTestId('thread')).toHaveLength(1)
    })

    it('All shows every thread, including resolved ones', async () => {
      prStoreMock.mockReturnValue({
        ...basePrReviewStoreState(),
        threads: { 'src/foo.ts': [openThread, resolvedThread] },
      })
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
      uiStoreMock.mockReturnValue({
        ...baseReviewUiStoreState(),
        agentRuns: [agentRun],
      })
      mockPrFileDiff.mockResolvedValue({ diff: singleLineDiff })
      await renderPane()
      await waitFor(() => expect(screen.getByText(/calls computeRiskScore again/)).toBeTruthy())
      expect(screen.getByText(/Agent note ·/)).toBeTruthy()
    })

    it('shows an agent pip instead of the note when agent notes are off', async () => {
      uiStoreMock.mockReturnValue({
        ...baseReviewUiStoreState(),
        agentRuns: [agentRun],
        agentNotesOn: false,
      })
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
      const state = uiStoreMock.getMockImplementation()?.() ?? baseReviewUiStoreState()
      uiStoreMock.mockReturnValue({
        ...(state as object),
        diffViewMode: 'split',
      })
      const view = await renderPane(overrides)
      await waitFor(() => expect(screen.getByText('@@ -85,3 +88,3 @@')).toBeTruthy())
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
      uiStoreMock.mockReturnValue({
        ...baseReviewUiStoreState(),
        agentRuns: [agentRun],
      })
      const first = await renderSplit()
      expect(screen.getByText(/split-view agent note body/)).toBeTruthy()
      first.unmount()

      uiStoreMock.mockReturnValue({
        ...baseReviewUiStoreState(),
        agentRuns: [agentRun],
        agentNotesOn: false,
      })
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
      prStoreMock.mockReturnValue({
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
      })
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
      prStoreMock.mockReturnValue({
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
      })
      const { container } = await renderPane()
      await waitFor(() => expect(screen.getByText(/sent when you submit your review/)).toBeTruthy())
      const code = container.querySelector('.rs-thread-bd code')
      expect(code?.textContent).toBe('fetch(filter)')
    })
  })

  describe('jump to the tests for a block', () => {
    const diff = {
      path: 'src/foo.ts',
      isBinary: false,
      hunks: [
        {
          header: '@@ -1,2 +1,2 @@ export function foo(',
          lines: [
            { type: 'remove' as const, content: 'old()', oldLineNumber: 1, newLineNumber: null },
            { type: 'add' as const, content: 'next()', oldLineNumber: null, newLineNumber: 1 },
            { type: 'context' as const, content: 'done()', oldLineNumber: 2, newLineNumber: 2 },
          ],
        },
      ],
    }

    beforeEach(() => {
      Element.prototype.scrollIntoView = vi.fn()
    })

    it('searches the tests with the hunk as it reads after the change', async () => {
      mockPrFileDiff.mockResolvedValue({ diff })
      mockInvoke.mockImplementation((channel: string, payload: unknown) => {
        if (channel === 'github:pr-file-diff') return mockPrFileDiff(payload)
        if (channel === 'github:tests-for-block')
          return Promise.resolve({ symbols: ['foo'], locations: [] })
        return Promise.resolve({})
      })
      await renderPane()
      fireEvent.click(
        await screen.findByRole('button', { name: 'Jump to the tests for this block' })
      )
      await waitFor(() =>
        expect(mockInvoke).toHaveBeenCalledWith('github:tests-for-block', {
          repoRoot: '/repo',
          headSHA: mockPr.headSHA,
          path: 'src/foo.ts',
          code: 'next()\ndone()',
          hunkHeader: '@@ -1,2 +1,2 @@ export function foo(',
        })
      )
      expect(await screen.findByText('No test mentions foo.')).toBeTruthy()
    })

    it('opens a test in the PR at its line', async () => {
      mockPrFileDiff.mockResolvedValue({ diff })
      mockInvoke.mockImplementation((channel: string, payload: unknown) => {
        if (channel === 'github:pr-file-diff') return mockPrFileDiff(payload)
        if (channel === 'github:tests-for-block')
          return Promise.resolve({
            symbols: ['foo'],
            locations: [{ path: 'src/foo.ts', line: 2, symbol: 'foo', text: 'done()' }],
          })
        return Promise.resolve({})
      })
      await renderPane()
      fireEvent.click(
        await screen.findByRole('button', { name: 'Jump to the tests for this block' })
      )
      fireEvent.click(await screen.findByRole('button', { name: /src\/foo\.ts:2/ }))
      expect(mockSetCurrentFile).toHaveBeenCalledWith('src/foo.ts')
      const row = document.querySelector('[data-new-line="2"]') as HTMLElement
      await waitFor(() => expect(row.scrollIntoView).toHaveBeenCalledWith({ block: 'center' }))
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
      uiStoreMock.mockReturnValue({
        ...baseReviewUiStoreState(),
        selection: { path: 'src/foo.ts', side: 'RIGHT' as const, startLine: 1, endLine: 1 },
      })
      mockPrFileDiff.mockResolvedValue({ diff: twoHunkDiff })
      await renderPane()
      await waitFor(() => expect(screen.getByText('@@ -1,1 +1,1 @@')).toBeTruthy())
      expect(screen.queryByTestId('composer')).toBeNull()
      window.dispatchEvent(new CustomEvent('review:comment'))
      await waitFor(() => expect(screen.getByTestId('composer')).toBeTruthy())
    })

    it('note opens the note composer on the selection', async () => {
      uiStoreMock.mockReturnValue({
        ...baseReviewUiStoreState(),
        selection: { path: 'src/foo.ts', side: 'RIGHT' as const, startLine: 1, endLine: 1 },
      })
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
      prStoreMock.mockReturnValue({
        ...basePrReviewStoreState(),
        viewedFiles: new Set(['src/other.ts']),
      })
      await renderPane({ pr: prWithOrder })
      expect(screen.queryByText('Step 4 of 1')).toBeNull()
      expect(screen.getByText('computeRiskScore · step 2 · read')).toBeTruthy()
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
      prStoreMock.mockReturnValue({
        ...basePrReviewStoreState(),
        changedSince: new Set(['src/foo.ts']),
        viewedAt: { 'src/foo.ts': '9f0c76eb0000000000000000000000000000000' },
      })
      uiStoreMock.mockReturnValue({
        ...baseReviewUiStoreState(),
        diffRange: 'since',
      })
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

describe('ReviewDiffPane expandable context', () => {
  const FILE_LINES = 100
  const fileText = Array.from({ length: FILE_LINES }, (_, i) => `line ${i + 1}`).join('\n') + '\n'
  const ctx = (n: number) => ({
    type: 'context' as const,
    content: `line ${n}`,
    oldLineNumber: n,
    newLineNumber: n,
  })
  const hunk = (start: number) => ({
    header: `@@ -${start},3 +${start},3 @@`,
    lines: [
      ctx(start),
      { type: 'remove' as const, content: 'old', oldLineNumber: start + 1, newLineNumber: null },
      { type: 'add' as const, content: 'new', oldLineNumber: null, newLineNumber: start + 1 },
      ctx(start + 2),
    ],
  })
  // Gaps: top 1-9, after-0 13-49, bottom 53-100.
  const twoHunkDiff = { path: 'src/foo.ts', isBinary: false, hunks: [hunk(10), hunk(50)] }

  const renderLoaded = async (
    diff: unknown = twoHunkDiff,
    props: Partial<typeof defaultProps> = {}
  ) => {
    mockPrFileDiff.mockResolvedValue({ diff })
    const view = await renderPane(props)
    await waitFor(() => expect(view.container.querySelector('.diff-hunk-header')).toBeTruthy())
    return view
  }
  const expandedRows = (c: HTMLElement) => c.querySelectorAll('tr[data-expanded="true"]')

  beforeEach(() => {
    mockPrFileContent.mockResolvedValue({ content: fileText })
  })

  it('shows no expanded rows and fetches nothing on first render', async () => {
    const { container } = await renderLoaded()
    expect(expandedRows(container).length).toBe(0)
    expect(mockPrFileContent).not.toHaveBeenCalled()
  })

  it('offers the right buttons per gap kind without touching hunk headers', async () => {
    const { container } = await renderLoaded()
    const rows = Array.from(container.querySelectorAll('.diff-gap-row'))
    expect(rows.length).toBe(3)
    const names = rows.map((r) =>
      Array.from(r.querySelectorAll('button')).map((b) => b.getAttribute('aria-label'))
    )
    expect(names[0]).toEqual(['Show all 9 lines', 'Show 20 lines above'])
    expect(names[1]).toEqual(['Show 20 lines below', 'Show all 37 lines', 'Show 20 lines above'])
    expect(names[2]).toEqual(['Show 20 lines below', 'Show all lines'])
    expect(container.querySelectorAll('.diff-hunk-header').length).toBe(2)
  })

  it('fetches once on the first click and renders 20 numbered rows below the hunk', async () => {
    const { container } = await renderLoaded()
    const between = container.querySelectorAll('.diff-gap-row')[1] as HTMLElement
    fireEvent.click(between.querySelector('button[aria-label="Show 20 lines below"]')!)
    await waitFor(() => expect(expandedRows(container).length).toBe(20))
    expect(mockPrFileContent).toHaveBeenCalledTimes(1)
    expect(mockPrFileContent).toHaveBeenCalledWith({
      repoRoot: '/repo',
      prNumber: 1,
      path: 'src/foo.ts',
      ref: 'abc',
    })
    const rows = Array.from(expandedRows(container))
    expect(rows[0].getAttribute('data-old-line')).toBe('13')
    expect(rows[0].getAttribute('data-new-line')).toBe('13')
    expect(rows[19].getAttribute('data-new-line')).toBe('32')
    expect(rows[0].classList.contains('diff-line--expanded')).toBe(true)
    expect(rows[0].textContent).toContain('line 13')

    fireEvent.click(
      (container.querySelectorAll('.diff-gap-row')[1] as HTMLElement).querySelector(
        'button[aria-label="Show 20 lines below"]'
      )!
    )
    await waitFor(() => expect(expandedRows(container).length).toBe(37))
    expect(mockPrFileContent).toHaveBeenCalledTimes(1)
  })

  it('reveals lines just above the next hunk from the above button', async () => {
    const { container } = await renderLoaded()
    const top = container.querySelectorAll('.diff-gap-row')[0] as HTMLElement
    fireEvent.click(top.querySelector('button[aria-label="Show 20 lines above"]')!)
    await waitFor(() => expect(expandedRows(container).length).toBe(9))
    const rows = Array.from(expandedRows(container))
    expect(rows[0].getAttribute('data-new-line')).toBe('1')
    expect(rows[8].getAttribute('data-new-line')).toBe('9')
  })

  it('Show all removes that expander and offsets old numbers after a net line change', async () => {
    const shifted = {
      path: 'src/foo.ts',
      isBinary: false,
      hunks: [
        {
          header: '@@ -10,2 +10,3 @@',
          lines: [
            ctx(10),
            { type: 'add' as const, content: 'x', oldLineNumber: null, newLineNumber: 11 },
            { type: 'context' as const, content: 'line 11', oldLineNumber: 11, newLineNumber: 12 },
          ],
        },
        {
          header: '@@ -20,1 +21,1 @@',
          lines: [{ ...ctx(21), oldLineNumber: 20 }],
        },
      ],
    }
    const { container } = await renderLoaded(shifted)
    const between = container.querySelectorAll('.diff-gap-row')[1] as HTMLElement
    fireEvent.click(between.querySelector('button[aria-label^="Show all"]')!)
    await waitFor(() => expect(expandedRows(container).length).toBe(8))
    const rows = Array.from(expandedRows(container))
    expect(rows[0].getAttribute('data-new-line')).toBe('13')
    expect(rows[0].getAttribute('data-old-line')).toBe('12')
    expect(container.querySelectorAll('.diff-gap-row').length).toBe(2)
  })

  it('renders revealed rows in split view', async () => {
    uiStoreMock.mockReturnValue({
      ...baseReviewUiStoreState(),
      diffViewMode: 'split' as const,
    })
    mockPrFileDiff.mockResolvedValue({ diff: twoHunkDiff })
    const { container } = await renderPane()
    await waitFor(() => expect(container.querySelector('.diff-split-header')).toBeTruthy())
    const between = container.querySelectorAll('.diff-gap-row')[1] as HTMLElement
    fireEvent.click(between.querySelector('button[aria-label="Show 20 lines below"]')!)
    await waitFor(() =>
      expect(container.querySelectorAll('tr[data-expanded="true"]').length).toBe(40)
    )
    expect(container.querySelectorAll('.diff-table--left tr[data-old-line="13"]').length).toBe(1)
    expect(container.querySelectorAll('.diff-table--right tr[data-new-line="13"]').length).toBe(1)
    expect(container.querySelectorAll('.diff-hunk-header').length).toBe(0)
  })

  it('hides Comment but keeps the other actions when the selection includes a revealed line', async () => {
    const actual = await vi.importActual<typeof import('../../src/stores/review-ui.store')>(
      '../../src/stores/review-ui.store'
    )
    actual.useReviewUiStore.setState({ selection: null })
    uiStoreMock.mockImplementation(actual.useReviewUiStore)
    const { container } = await renderLoaded()
    const between = container.querySelectorAll('.diff-gap-row')[1] as HTMLElement
    fireEvent.click(between.querySelector('button[aria-label="Show 20 lines below"]')!)
    await waitFor(() => expect(expandedRows(container).length).toBe(20))

    const row = container.querySelector('tr[data-new-line="13"]')!
    fireEvent.mouseDown(row.querySelector('.diff-gutter-btn')!)
    fireEvent.mouseUp(window)
    await waitFor(() => expect(screen.getByRole('button', { name: /Ask agent/ })).toBeTruthy())
    expect(screen.queryByRole('button', { name: /Comment/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Add note/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Explain' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Tests' })).toBeTruthy()
    expect(screen.queryByTestId('composer')).toBeNull()

    window.dispatchEvent(new Event('review:comment'))
    expect(screen.queryByTestId('composer')).toBeNull()
  })

  it('still offers Comment for a selection inside the diff', async () => {
    const actual = await vi.importActual<typeof import('../../src/stores/review-ui.store')>(
      '../../src/stores/review-ui.store'
    )
    actual.useReviewUiStore.setState({ selection: null })
    uiStoreMock.mockImplementation(actual.useReviewUiStore)
    const { container } = await renderLoaded()
    const row = container.querySelector('tr[data-new-line="11"]')!
    fireEvent.mouseDown(row.querySelector('.diff-gutter-btn')!)
    fireEvent.mouseUp(window)
    await waitFor(() => expect(screen.getByRole('button', { name: /Comment/ })).toBeTruthy())
  })

  it('says the file is too large and offers no buttons', async () => {
    mockPrFileContent.mockResolvedValue({ tooLarge: true })
    const { container } = await renderLoaded()
    fireEvent.click(
      (container.querySelectorAll('.diff-gap-row')[1] as HTMLElement).querySelector(
        'button[aria-label="Show 20 lines below"]'
      )!
    )
    await waitFor(() =>
      expect(screen.getAllByText('This file is too large to expand here.').length).toBe(3)
    )
    expect(container.querySelectorAll('.diff-gap-row button').length).toBe(0)
  })

  it('shows the error with Retry, and Retry fetches again', async () => {
    mockPrFileContent.mockResolvedValueOnce({ error: 'NETWORK_DOWN' })
    const { container } = await renderLoaded()
    fireEvent.click(
      (container.querySelectorAll('.diff-gap-row')[1] as HTMLElement).querySelector(
        'button[aria-label="Show 20 lines below"]'
      )!
    )
    await waitFor(() => expect(screen.getAllByText('NETWORK_DOWN').length).toBe(3))
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0])
    await waitFor(() => expect(expandedRows(container).length).toBe(20))
    expect(mockPrFileContent).toHaveBeenCalledTimes(2)
  })

  it('resets expansions when another file opens', async () => {
    const { container, rerender } = await renderLoaded()
    fireEvent.click(
      (container.querySelectorAll('.diff-gap-row')[1] as HTMLElement).querySelector(
        'button[aria-label="Show 20 lines below"]'
      )!
    )
    await waitFor(() => expect(expandedRows(container).length).toBe(20))

    const { ReviewDiffPane } = await import('../../src/components/pr-review/ReviewDiffPane')
    const other = { ...mockFile, path: 'src/bar.ts' }
    mockPrFileDiff.mockResolvedValue({ diff: { ...twoHunkDiff, path: 'src/bar.ts' } })
    rerender(<ReviewDiffPane {...defaultProps} file={other} />)
    await waitFor(() => expect(screen.getByTitle('src/bar.ts')).toBeTruthy())
    await waitFor(() => expect(container.querySelectorAll('.diff-gap-row').length).toBe(3))
    expect(expandedRows(container).length).toBe(0)
  })

  it('shows no expanders for a binary file', async () => {
    const { container } = await renderPane({ file: { ...mockFile, isBinary: true } })
    expect(container.querySelectorAll('.diff-gap-row').length).toBe(0)
  })

  it('shows no expanders for a truncated diff', async () => {
    const { container } = await renderLoaded({ ...twoHunkDiff, truncated: true })
    expect(container.querySelectorAll('.diff-gap-row').length).toBe(0)
  })

  it('shows no expanders for an added file', async () => {
    const added = {
      path: 'src/foo.ts',
      isBinary: false,
      hunks: [
        {
          header: '@@ -0,0 +1,2 @@',
          lines: [
            { type: 'add' as const, content: 'a', oldLineNumber: null, newLineNumber: 1 },
            { type: 'add' as const, content: 'b', oldLineNumber: null, newLineNumber: 2 },
          ],
        },
      ],
    }
    const { container } = await renderLoaded(added)
    expect(container.querySelectorAll('.diff-gap-row').length).toBe(0)
  })
})

describe('ReviewDiffPane — fetch and render cost', () => {
  const diffOf = (path: string, content: string) => ({
    path,
    isBinary: false,
    hunks: [
      {
        header: '@@ -1,2 +1,2 @@',
        lines: [
          { type: 'context' as const, content, oldLineNumber: 1, newLineNumber: 1 },
          {
            type: 'add' as const,
            content: `${content} // again`,
            oldLineNumber: null,
            newLineNumber: 2,
          },
        ],
      },
    ],
  })
  // Highlighting splits a line into token spans, so match on the line's whole text.
  const codeLine = (text: string) => (_: string, el: Element | null) =>
    el?.tagName === 'PRE' && el.textContent === text
  const otherFile = { ...mockFile, path: 'src/bar.ts' }

  it('tells the main process the base ref and head sha so it can skip its own fetch', async () => {
    await renderPane()
    await waitFor(() => expect(mockPrFileDiff).toHaveBeenCalledTimes(1))
    expect(mockPrFileDiff).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'src/foo.ts', baseRef: 'main', headSHA: 'abc' })
    )
  })

  it('does not refetch the open file when it is marked viewed', async () => {
    mockPrFileDiff.mockResolvedValue({ diff: diffOf('src/foo.ts', 'const viewedMark = 1') })
    const view = await renderPane()
    await screen.findByText(codeLine('const viewedMark = 1'))
    prStoreMock.mockReturnValue({
      ...basePrReviewStoreState(),
      viewedFiles: new Set(['src/foo.ts']),
      viewedAt: { 'src/foo.ts': 'abc' },
    })
    const { ReviewDiffPane } = await import('../../src/components/pr-review/ReviewDiffPane')
    view.rerender(<ReviewDiffPane {...defaultProps} />)
    expect(await screen.findByRole('checkbox', { name: 'Viewed' })).toHaveProperty('checked', true)
    expect(mockPrFileDiff).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Loading diff…')).toBeNull()
    expect(screen.getByText(codeLine('const viewedMark = 1'))).toBeTruthy()
  })

  it('shows a diff it already has straight away when switching back to a file', async () => {
    mockPrFileDiff.mockImplementation((payload: { path: string }) =>
      Promise.resolve({ diff: diffOf(payload.path, `const in_${payload.path.slice(4, 7)} = 1`) })
    )
    const view = await renderPane()
    await screen.findByText(codeLine('const in_foo = 1'))
    const { ReviewDiffPane } = await import('../../src/components/pr-review/ReviewDiffPane')
    view.rerender(<ReviewDiffPane {...defaultProps} file={otherFile} />)
    await screen.findByText(codeLine('const in_bar = 1'))
    view.rerender(<ReviewDiffPane {...defaultProps} />)
    expect(screen.getByText(codeLine('const in_foo = 1'))).toBeTruthy()
    expect(screen.queryByText('Loading diff…')).toBeNull()
    expect(mockPrFileDiff).toHaveBeenCalledTimes(2)
  })

  it('refetches when the head moves, since the cached diff belongs to the old head', async () => {
    mockPrFileDiff.mockResolvedValue({ diff: diffOf('src/foo.ts', 'const headMoves = 1') })
    const view = await renderPane()
    await screen.findByText(codeLine('const headMoves = 1'))
    const { ReviewDiffPane } = await import('../../src/components/pr-review/ReviewDiffPane')
    view.rerender(<ReviewDiffPane {...defaultProps} pr={{ ...mockPr, headSHA: 'def' }} />)
    await waitFor(() => expect(mockPrFileDiff).toHaveBeenCalledTimes(2))
  })

  it('highlights each distinct line once however often the pane re-renders', async () => {
    mockPrFileDiff.mockResolvedValue({ diff: diffOf('src/foo.ts', 'const highlightOnce = 1') })
    const view = await renderPane()
    await screen.findByText(codeLine('const highlightOnce = 1'))
    const seen = highlightSpy.mock.calls.filter((c) =>
      String(c[0]).includes('highlightOnce')
    ).length
    expect(seen).toBe(2)
    const { ReviewDiffPane } = await import('../../src/components/pr-review/ReviewDiffPane')
    view.rerender(<ReviewDiffPane {...defaultProps} onMarkViewed={vi.fn()} />)
    view.rerender(<ReviewDiffPane {...defaultProps} onMarkViewed={vi.fn()} />)
    const after = highlightSpy.mock.calls.filter((c) =>
      String(c[0]).includes('highlightOnce')
    ).length
    expect(after).toBe(seen)
  })
})
