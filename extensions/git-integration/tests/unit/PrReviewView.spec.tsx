import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { usePrReviewStore } from '../../src/stores/pr-review.store'

vi.mock('../../src/stores/pr-review.store', () => ({ usePrReviewStore: vi.fn() }))
vi.mock('../../src/hooks/usePrReview', () => ({ useLoadInlineComments: vi.fn(() => vi.fn()) }))
vi.mock('../../src/components/pr-review/ChapterNav', () => ({
  ChapterNav: () => <div data-testid="chapter-nav" />,
}))
vi.mock('../../src/components/pr-review/ChapterFileList', () => ({
  ChapterFileList: () => <div data-testid="chapter-file-list" />,
}))
vi.mock('../../src/components/pr-review/FullFileList', () => ({
  FullFileList: () => <div data-testid="full-file-list" />,
}))
vi.mock('../../src/components/pr-review/ReviewDiffPane', () => ({
  ReviewDiffPane: ({
    onPause,
    onOpenSubmit,
    onMarkViewed,
    onFinishChapter,
    onShowRisk,
    onPrevFile,
  }: {
    onPause: () => void
    onOpenSubmit: () => void
    onMarkViewed: () => void
    onFinishChapter: () => void
    onShowRisk: () => void
    onPrevFile: () => void
  }) => (
    <div data-testid="review-diff-pane">
      <button onClick={onPause}>Pause</button>
      <button onClick={onOpenSubmit}>Submit</button>
      <button onClick={onMarkViewed}>MarkViewed</button>
      <button onClick={onFinishChapter}>FinishChapter</button>
      <button onClick={onShowRisk}>ShowRisk</button>
      <button onClick={onPrevFile}>PrevFile</button>
    </div>
  ),
}))
vi.mock('../../src/components/pr-review/RiskBreakdownPanel', () => ({
  RiskBreakdownPanel: () => <div data-testid="risk-panel" />,
}))
vi.mock('../../src/components/pr-review/ReviewSubmitPanel', () => ({
  ReviewSubmitPanel: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="submit-panel">
      <button onClick={onClose}>CloseSubmit</button>
    </div>
  ),
}))

const mockSetCurrentChapter = vi.fn()
const mockSetCurrentFile = vi.fn()
const mockMarkFileViewed = vi.fn()
const mockSetPaused = vi.fn()

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

const mockChapter = {
  id: 'ch-1',
  name: 'Chapter 1',
  estimatedMinutes: 10,
  status: 'not-started' as const,
  files: [mockFile],
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
  chapters: [mockChapter],
}

const mockClose = vi.fn()
const mockRefresh = vi.fn().mockResolvedValue(undefined)

function setupStore(overrides: Record<string, unknown> = {}) {
  vi.mocked(usePrReviewStore).mockReturnValue({
    currentChapterId: null,
    currentFilePath: null,
    setCurrentChapter: mockSetCurrentChapter,
    setCurrentFile: mockSetCurrentFile,
    viewedFiles: new Set<string>(),
    fileOrderOverrides: {},
    markFileViewed: mockMarkFileViewed,
    setPaused: mockSetPaused,
    ...overrides,
  } as unknown as ReturnType<typeof usePrReviewStore>)
}

beforeEach(() => {
  vi.clearAllMocks()
  setupStore()
})

async function renderView(
  prOverrides: Record<string, unknown> = {},
  storeOverrides: Record<string, unknown> = {}
) {
  const { PrReviewView } = await import('../../src/components/pr-review/PrReviewView')
  setupStore(storeOverrides)
  return render(
    <PrReviewView
      repoRoot="/repo"
      pr={{ ...mockPr, ...prOverrides }}
      onClose={mockClose}
      onRefresh={mockRefresh}
    />
  )
}

describe('PrReviewView', () => {
  it('renders the diff pane when chapter and file are available', async () => {
    await renderView()
    expect(screen.getByTestId('review-diff-pane')).toBeTruthy()
  })

  it('renders chapter file list when switched to guided mode', async () => {
    const ch2 = { ...mockChapter, id: 'ch-2', name: 'Chapter 2' }
    await renderView(
      { chapters: [mockChapter, ch2] },
      { currentChapterId: 'ch-1', currentFilePath: 'src/foo.ts' }
    )
    // Default is full mode; switch to guided
    fireEvent.click(screen.getByTitle('Switch to guided chapter view'))
    expect(screen.getByTestId('chapter-file-list')).toBeTruthy()
  })

  it('shows chapter nav for multi-chapter PRs in guided mode', async () => {
    const ch2 = { ...mockChapter, id: 'ch-2', name: 'Chapter 2' }
    await renderView(
      { chapters: [mockChapter, ch2] },
      { currentChapterId: 'ch-1', currentFilePath: 'src/foo.ts' }
    )
    // Default is full mode; chapter nav only visible in guided mode
    fireEvent.click(screen.getByTitle('Switch to guided chapter view'))
    expect(screen.getByTestId('chapter-nav')).toBeTruthy()
  })

  it('does not show chapter nav for single-chapter PRs', async () => {
    await renderView()
    expect(screen.queryByTestId('chapter-nav')).toBeNull()
  })

  it('shows submit panel when Submit button clicked', async () => {
    const { PrReviewView } = await import('../../src/components/pr-review/PrReviewView')
    setupStore({ currentFilePath: 'src/foo.ts' })
    render(
      <PrReviewView repoRoot="/repo" pr={mockPr} onClose={mockClose} onRefresh={mockRefresh} />
    )
    fireEvent.click(screen.getByText('Submit'))
    expect(screen.getByTestId('submit-panel')).toBeTruthy()
  })

  it('hides submit panel when CloseSubmit clicked', async () => {
    const { PrReviewView } = await import('../../src/components/pr-review/PrReviewView')
    setupStore({ currentFilePath: 'src/foo.ts' })
    render(
      <PrReviewView repoRoot="/repo" pr={mockPr} onClose={mockClose} onRefresh={mockRefresh} />
    )
    fireEvent.click(screen.getByText('Submit'))
    fireEvent.click(screen.getByText('CloseSubmit'))
    expect(screen.queryByTestId('submit-panel')).toBeNull()
  })

  it('calls setPaused and onClose when Pause is clicked', async () => {
    const { PrReviewView } = await import('../../src/components/pr-review/PrReviewView')
    setupStore({ currentFilePath: 'src/foo.ts' })
    render(
      <PrReviewView repoRoot="/repo" pr={mockPr} onClose={mockClose} onRefresh={mockRefresh} />
    )
    fireEvent.click(screen.getByText('Pause'))
    expect(mockSetPaused).toHaveBeenCalled()
    expect(mockClose).toHaveBeenCalled()
  })

  it('shows risk panel when ShowRisk is clicked', async () => {
    const { PrReviewView } = await import('../../src/components/pr-review/PrReviewView')
    setupStore({ currentFilePath: 'src/foo.ts' })
    render(
      <PrReviewView repoRoot="/repo" pr={mockPr} onClose={mockClose} onRefresh={mockRefresh} />
    )
    fireEvent.click(screen.getByText('ShowRisk'))
    expect(screen.getByTestId('risk-panel')).toBeTruthy()
  })

  it('opens submit panel when FinishChapter is clicked on the last (only) chapter', async () => {
    const { PrReviewView } = await import('../../src/components/pr-review/PrReviewView')
    setupStore({ currentFilePath: 'src/foo.ts' })
    render(
      <PrReviewView repoRoot="/repo" pr={mockPr} onClose={mockClose} onRefresh={mockRefresh} />
    )
    fireEvent.click(screen.getByText('FinishChapter'))
    expect(screen.getByTestId('submit-panel')).toBeTruthy()
  })

  it('advances to next chapter (not submit) when FinishChapter is clicked on a non-final chapter', async () => {
    const ch2 = { ...mockChapter, id: 'ch-2', name: 'Chapter 2', files: [mockFile] }
    const { PrReviewView } = await import('../../src/components/pr-review/PrReviewView')
    setupStore({ currentChapterId: 'ch-1', currentFilePath: 'src/foo.ts' })
    render(
      <PrReviewView
        repoRoot="/repo"
        pr={{ ...mockPr, chapters: [mockChapter, ch2] }}
        onClose={mockClose}
        onRefresh={mockRefresh}
      />
    )
    fireEvent.click(screen.getByText('FinishChapter'))
    expect(mockSetCurrentChapter).toHaveBeenCalledWith('ch-2')
    expect(screen.queryByTestId('submit-panel')).toBeNull()
  })

  it('calls markFileViewed and advances file on MarkViewed', async () => {
    const file2 = { ...mockFile, path: 'src/bar.ts' }
    const chapter = { ...mockChapter, files: [mockFile, file2] }
    const { PrReviewView } = await import('../../src/components/pr-review/PrReviewView')
    setupStore({ currentFilePath: 'src/foo.ts' })
    render(
      <PrReviewView
        repoRoot="/repo"
        pr={{ ...mockPr, chapters: [chapter] }}
        onClose={mockClose}
        onRefresh={mockRefresh}
      />
    )
    fireEvent.click(screen.getByText('MarkViewed'))
    expect(mockMarkFileViewed).toHaveBeenCalledWith('/repo', 1, 'abc', 'src/foo.ts')
    expect(mockSetCurrentFile).toHaveBeenCalledWith('src/bar.ts')
  })

  it('shows full-file-list by default, restores it after switching to guided and back', async () => {
    const ch2 = { ...mockChapter, id: 'ch-2', name: 'Chapter 2' }
    const { PrReviewView } = await import('../../src/components/pr-review/PrReviewView')
    setupStore({ currentFilePath: 'src/foo.ts', currentChapterId: 'ch-1' })
    render(
      <PrReviewView
        repoRoot="/repo"
        pr={{ ...mockPr, chapters: [mockChapter, ch2] }}
        onClose={mockClose}
        onRefresh={mockRefresh}
      />
    )
    // Full is default
    expect(screen.getByTestId('full-file-list')).toBeTruthy()
    // Switch to guided
    fireEvent.click(screen.getByTitle('Switch to guided chapter view'))
    expect(screen.getByTestId('chapter-file-list')).toBeTruthy()
    // Switch back to full
    fireEvent.click(screen.getByTitle('Switch to full file view'))
    expect(screen.getByTestId('full-file-list')).toBeTruthy()
  })

  it('switches to guided mode from full mode', async () => {
    const ch2 = { ...mockChapter, id: 'ch-2', name: 'Chapter 2' }
    const { PrReviewView } = await import('../../src/components/pr-review/PrReviewView')
    setupStore({ currentFilePath: 'src/foo.ts', currentChapterId: 'ch-1' })
    render(
      <PrReviewView
        repoRoot="/repo"
        pr={{ ...mockPr, chapters: [mockChapter, ch2] }}
        onClose={mockClose}
        onRefresh={mockRefresh}
      />
    )
    fireEvent.click(screen.getByTitle('Switch to guided chapter view'))
    expect(screen.getByTestId('chapter-file-list')).toBeTruthy()
  })

  it('calls onRefresh when Refresh button is clicked', async () => {
    const { PrReviewView } = await import('../../src/components/pr-review/PrReviewView')
    setupStore({ currentFilePath: 'src/foo.ts' })
    render(
      <PrReviewView repoRoot="/repo" pr={mockPr} onClose={mockClose} onRefresh={mockRefresh} />
    )
    fireEvent.click(screen.getByTitle('Refresh PR'))
    expect(mockRefresh).toHaveBeenCalled()
  })

  it('shows empty state message when no active file', async () => {
    const { PrReviewView } = await import('../../src/components/pr-review/PrReviewView')
    setupStore({ currentFilePath: null })
    render(
      <PrReviewView
        repoRoot="/repo"
        pr={{ ...mockPr, chapters: [] }}
        onClose={mockClose}
        onRefresh={mockRefresh}
      />
    )
    expect(screen.getByText('Select a file to review.')).toBeTruthy()
  })
})
