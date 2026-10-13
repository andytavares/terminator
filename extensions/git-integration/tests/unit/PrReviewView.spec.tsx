import React from 'react'
import { describe, it, beforeAll, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { usePrReviewStore } from '../../src/stores/pr-review.store'
import { PrReviewDetailSchema } from '../../src/schemas/pr-review.schema'

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
    onMarkViewed,
    onShowRisk,
    onPrevFile,
  }: {
    onMarkViewed: () => void
    onShowRisk: () => void
    onPrevFile: () => void
  }) => (
    <div data-testid="review-diff-pane">
      <button onClick={onMarkViewed}>MarkViewed</button>
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
vi.mock('../../src/components/pr-review/AgentPanel', () => ({
  AgentPanel: () => <div data-testid="agent-panel" />,
}))
vi.mock('../../src/hooks/useAgentRuns', () => ({ useAgentRuns: vi.fn() }))

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

// Parsed as the review channel's answer is, so the schema's defaults are filled in.
const mockPr = PrReviewDetailSchema.parse({
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
})

const mockMarkFilesViewed = vi.fn()
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
    markFilesViewed: mockMarkFilesViewed,
    setPaused: mockSetPaused,
    changedSince: new Set<string>(),
    lastAccessedAt: null,
    notes: [],
    drafts: [],
    ...overrides,
  })
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

// The first import compiles the component tree, which on a loaded machine takes longer
// than one test's 5 s; load it once here so every test times only its own work.
beforeAll(async () => {
  await import('../../src/components/pr-review/PrReviewView')
}, 60_000)

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
    fireEvent.click(screen.getByRole('radio', { name: 'Chapters' }))
    expect(screen.getByTestId('chapter-file-list')).toBeTruthy()
  })

  it('shows chapter nav for multi-chapter PRs in guided mode', async () => {
    const ch2 = { ...mockChapter, id: 'ch-2', name: 'Chapter 2' }
    await renderView(
      { chapters: [mockChapter, ch2] },
      { currentChapterId: 'ch-1', currentFilePath: 'src/foo.ts' }
    )
    fireEvent.click(screen.getByRole('radio', { name: 'Chapters' }))
    expect(screen.getByTestId('chapter-nav')).toBeTruthy()
  })
})

describe('PrReviewView — does not show chapter nav for single-chapter PRs', () => {
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
    fireEvent.click(screen.getByRole('button', { name: /^Submit review/ }))
    expect(screen.getByTestId('submit-panel')).toBeTruthy()
  })

  it('hides submit panel when CloseSubmit clicked', async () => {
    const { PrReviewView } = await import('../../src/components/pr-review/PrReviewView')
    setupStore({ currentFilePath: 'src/foo.ts' })
    render(
      <PrReviewView repoRoot="/repo" pr={mockPr} onClose={mockClose} onRefresh={mockRefresh} />
    )
    fireEvent.click(screen.getByRole('button', { name: /^Submit review/ }))
    fireEvent.click(screen.getByText('CloseSubmit'))
    expect(screen.queryByTestId('submit-panel')).toBeNull()
  })
})

describe('PrReviewView — calls setPaused and onClose when Pause is clicked', () => {
  it('calls setPaused and onClose when Pause is clicked', async () => {
    const { PrReviewView } = await import('../../src/components/pr-review/PrReviewView')
    setupStore({ currentFilePath: 'src/foo.ts' })
    render(
      <PrReviewView repoRoot="/repo" pr={mockPr} onClose={mockClose} onRefresh={mockRefresh} />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Pause review' }))
    expect(mockSetPaused).toHaveBeenCalled()
    expect(mockClose).toHaveBeenCalled()
  })

  it('shows review progress once, in the header, with the chapter estimate', async () => {
    await renderView({}, { currentFilePath: 'src/foo.ts' })
    expect(screen.getByText('0/1 viewed · ~10m')).toBeTruthy()
    expect(screen.queryByText(/files reviewed/)).toBeNull()
  })

  it('shows exactly one Submit review control', async () => {
    await renderView({}, { currentFilePath: 'src/foo.ts' })
    expect(screen.getAllByRole('button', { name: /^Submit review/ })).toHaveLength(1)
  })
})

describe('PrReviewView — opens the Agent tab of the inspector from Ask agent, and closes it', () => {
  it('opens the Agent tab of the inspector from Ask agent, and closes it', async () => {
    await renderView({}, { currentFilePath: 'src/foo.ts' })
    fireEvent.click(screen.getByRole('button', { name: 'Ask agent about this PR' }))
    expect(screen.getByRole('tab', { name: /Agent/, selected: true })).toBeTruthy()
    expect(screen.getByTestId('agent-panel')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close inspector' }))
    expect(screen.queryByTestId('agent-panel')).toBeNull()
    expect(screen.queryByRole('tablist', { name: 'Inspector' })).toBeNull()
  })

  it('hides and restores the file list from the more menu', async () => {
    await renderView({}, { currentFilePath: 'src/foo.ts' })
    expect(screen.getByTestId('full-file-list')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'More review actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /^Hide file list/ }))
    expect(screen.queryByTestId('full-file-list')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'More review actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /^Hide file list/ }))
    expect(screen.getByTestId('full-file-list')).toBeTruthy()
  })
})

describe('PrReviewView — shows risk panel when ShowRisk is clicked', () => {
  it('shows risk panel when ShowRisk is clicked', async () => {
    const { PrReviewView } = await import('../../src/components/pr-review/PrReviewView')
    setupStore({ currentFilePath: 'src/foo.ts' })
    render(
      <PrReviewView repoRoot="/repo" pr={mockPr} onClose={mockClose} onRefresh={mockRefresh} />
    )
    fireEvent.click(screen.getByText('ShowRisk'))
    expect(screen.getByRole('tab', { name: 'File', selected: true })).toBeTruthy()
    expect(screen.getByTestId('risk-panel')).toBeTruthy()
    expect(screen.getByText('Health')).toBeTruthy()
  })

  it('opens submit panel when FinishChapter is clicked on the last (only) chapter', async () => {
    const { PrReviewView } = await import('../../src/components/pr-review/PrReviewView')
    setupStore({ currentFilePath: 'src/foo.ts' })
    render(
      <PrReviewView repoRoot="/repo" pr={mockPr} onClose={mockClose} onRefresh={mockRefresh} />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Submit review…' }))
    expect(screen.getByTestId('submit-panel')).toBeTruthy()
  })
})

describe('PrReviewView — advances to next chapter (not submit) when FinishChapter is clicked on a non-final chapter', () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Finish chapter ↵' }))
    expect(mockSetCurrentChapter).toHaveBeenCalledWith('ch-2')
    expect(screen.queryByTestId('submit-panel')).toBeNull()
  })
})

describe('PrReviewView — finishing a chapter marks its unviewed files in one batch', () => {
  it('finishing a chapter marks its unviewed files in one batch', async () => {
    const file2 = { ...mockFile, path: 'src/bar.ts' }
    const file3 = { ...mockFile, path: 'src/baz.ts' }
    const chapter = { ...mockChapter, files: [mockFile, file2, file3] }
    const { PrReviewView } = await import('../../src/components/pr-review/PrReviewView')
    setupStore({ currentFilePath: 'src/baz.ts', viewedFiles: new Set(['src/bar.ts']) })
    render(
      <PrReviewView
        repoRoot="/repo"
        pr={{ ...mockPr, chapters: [chapter] }}
        onClose={mockClose}
        onRefresh={mockRefresh}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Submit review…' }))
    expect(mockMarkFilesViewed).toHaveBeenCalledTimes(1)
    expect(mockMarkFilesViewed).toHaveBeenCalledWith(
      { repoRoot: '/repo', prNumber: 1, headSHA: 'abc' },
      ['src/foo.ts', 'src/baz.ts']
    )
    expect(mockMarkFileViewed).not.toHaveBeenCalled()
  })
})

describe('PrReviewView — calls markFileViewed and advances file on MarkViewed', () => {
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
    expect(mockMarkFileViewed).toHaveBeenCalledWith(
      { repoRoot: '/repo', prNumber: 1, headSHA: 'abc' },
      'src/foo.ts'
    )
    expect(mockSetCurrentFile).toHaveBeenCalledWith('src/bar.ts')
  })
})

describe('PrReviewView — shows full-file-list by default, restores it after switching to guided and back', () => {
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
    fireEvent.click(screen.getByRole('radio', { name: 'Chapters' }))
    expect(screen.getByTestId('chapter-file-list')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: 'Files' }))
    expect(screen.getByTestId('full-file-list')).toBeTruthy()
  })
})

describe('PrReviewView — switches to guided mode from full mode', () => {
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
    fireEvent.click(screen.getByRole('radio', { name: 'Chapters' }))
    expect(screen.getByTestId('chapter-file-list')).toBeTruthy()
  })

  it('calls onRefresh when Refresh button is clicked', async () => {
    const { PrReviewView } = await import('../../src/components/pr-review/PrReviewView')
    setupStore({ currentFilePath: 'src/foo.ts' })
    render(
      <PrReviewView repoRoot="/repo" pr={mockPr} onClose={mockClose} onRefresh={mockRefresh} />
    )
    fireEvent.click(screen.getByRole('button', { name: 'More review actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /^Refresh PR/ }))
    expect(mockRefresh).toHaveBeenCalled()
  })
})

describe('PrReviewView — shows empty state message when no active file', () => {
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

function makeLargeFile(path: string, additions: number) {
  return { ...mockFile, path, additions, deletions: 0 }
}

describe('PrReviewView (continued) — large-PR warning', () => {
  it('shows large-PR banner when PR exceeds 400 LOC', async () => {
    const bigFile = makeLargeFile('src/big.ts', 500)
    const chapter = { ...mockChapter, files: [bigFile] }
    const { PrReviewView } = await import('../../src/components/pr-review/PrReviewView')
    setupStore({ currentFilePath: 'src/big.ts' })
    render(
      <PrReviewView
        repoRoot="/repo"
        pr={{ ...mockPr, chapters: [chapter] }}
        onClose={mockClose}
        onRefresh={mockRefresh}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /500 LOC/ }))
    expect(screen.getByText(/Large PR — 500 LOC, estimated 125 min to review/)).toBeTruthy()
  })

  it('does not show large-PR banner when PR is under 400 LOC', async () => {
    await renderView()
    expect(screen.queryByRole('button', { name: /LOC ·/ })).toBeNull()
  })
})

describe('PrReviewView (continued) — large-PR warning — dismisses large-PR banner when × clicked', () => {
  it('dismisses large-PR banner when × clicked', async () => {
    const bigFile = makeLargeFile('src/big.ts', 500)
    const chapter = { ...mockChapter, files: [bigFile] }
    const { PrReviewView } = await import('../../src/components/pr-review/PrReviewView')
    setupStore({ currentFilePath: 'src/big.ts' })
    render(
      <PrReviewView
        repoRoot="/repo"
        pr={{ ...mockPr, chapters: [chapter] }}
        onClose={mockClose}
        onRefresh={mockRefresh}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /500 LOC/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('button', { name: /500 LOC/ })).toBeNull()
  })
})

describe('PrReviewView (continued) — large-PR warning — toggles focus mode on/off', () => {
  it('toggles focus mode on/off', async () => {
    const bigFile = makeLargeFile('src/big.ts', 500)
    const chapter = { ...mockChapter, files: [bigFile] }
    const { PrReviewView } = await import('../../src/components/pr-review/PrReviewView')
    setupStore({ currentFilePath: 'src/big.ts' })
    render(
      <PrReviewView
        repoRoot="/repo"
        pr={{ ...mockPr, chapters: [chapter] }}
        onClose={mockClose}
        onRefresh={mockRefresh}
      />
    )
    expect(screen.queryByRole('button', { name: 'Focus mode', pressed: true })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'More review actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /^Focus mode/ }))
    const pill = screen.getByRole('button', { name: 'Focus mode', pressed: true })
    fireEvent.click(pill)
    expect(screen.queryByRole('button', { name: 'Focus mode', pressed: true })).toBeNull()
  })
})

describe('PrReviewView (continued) — large-PR warning — drops all-low-risk chapters in focus mode instead of showing their full file list', () => {
  it('drops all-low-risk chapters in focus mode instead of showing their full file list', async () => {
    const lowFile = makeLargeFile('src/low.ts', 300)
    const highFile = {
      ...makeLargeFile('src/high.ts', 300),
      riskScore: { ...mockFile.riskScore, level: 'high' as const },
    }
    const lowChapter = { ...mockChapter, id: 'ch-low', name: 'Low only', files: [lowFile] }
    const highChapter = { ...mockChapter, id: 'ch-high', name: 'High risk', files: [highFile] }
    const { unmount } = await renderView(
      { chapters: [lowChapter, highChapter] },
      { currentFilePath: 'src/high.ts', currentChapterId: 'ch-high' }
    )
    fireEvent.click(screen.getByRole('button', { name: 'More review actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /^Focus mode/ }))
    // Progress total should reflect only the high-risk chapter (1 file), not both (2 files)
    expect(screen.getByRole('progressbar', { name: '0 of 1 files viewed' })).toBeTruthy()
    unmount()
  })
})

describe('PrReviewView (continued) — large-PR warning — progress bar does not exceed 100% when viewedFiles exceeds displayPr files in focus mode', () => {
  it('progress bar does not exceed 100% when viewedFiles exceeds displayPr files in focus mode', async () => {
    const bigFile = {
      ...makeLargeFile('src/low.ts', 500),
      riskScore: { ...mockFile.riskScore, level: 'low' as const },
    }
    const chapter = { ...mockChapter, files: [bigFile] }
    const { PrReviewView } = await import('../../src/components/pr-review/PrReviewView')
    // 3 viewed files but only 1 file in PR
    setupStore({
      currentFilePath: 'src/low.ts',
      viewedFiles: new Set(['src/low.ts', 'src/other.ts', 'src/another.ts']),
    })
    render(
      <PrReviewView
        repoRoot="/repo"
        pr={{ ...mockPr, chapters: [chapter] }}
        onClose={mockClose}
        onRefresh={mockRefresh}
      />
    )
    const bar = screen.getByRole('progressbar')
    expect(Number(bar.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(
      Number(bar.getAttribute('aria-valuemax'))
    )
  })
})

const f = (path: string) => ({ ...mockFile, path })

const chapters = [
  { ...mockChapter, id: 'ch-1', name: 'One', files: [f('a.ts'), f('b.ts')] },
  { ...mockChapter, id: 'ch-2', name: 'Two', files: [f('c.ts'), f('d.ts')] },
  { ...mockChapter, id: 'ch-3', name: 'Three', files: [f('e.ts')] },
]

const press = (key: string) => fireEvent.keyDown(window, { key })

describe('PrReviewView (continued) — chapter keyboard navigation', () => {
  it('} selects the next chapter and its first file', async () => {
    await renderView({ chapters }, { currentChapterId: 'ch-1', currentFilePath: 'b.ts' })
    press('}')
    expect(mockSetCurrentChapter).toHaveBeenCalledWith('ch-2')
    expect(mockSetCurrentFile).toHaveBeenCalledWith('c.ts')
  })

  it('{ selects the previous chapter and its first file', async () => {
    await renderView({ chapters }, { currentChapterId: 'ch-3', currentFilePath: 'e.ts' })
    press('{')
    expect(mockSetCurrentChapter).toHaveBeenCalledWith('ch-2')
    expect(mockSetCurrentFile).toHaveBeenCalledWith('c.ts')
  })

  it('chapter keys do not wrap at the ends', async () => {
    await renderView({ chapters }, { currentChapterId: 'ch-1', currentFilePath: 'a.ts' })
    press('{')
    expect(mockSetCurrentChapter).not.toHaveBeenCalled()
    expect(mockSetCurrentFile).not.toHaveBeenCalled()
  })

  it('chapter keys do not wrap past the last chapter', async () => {
    await renderView({ chapters }, { currentChapterId: 'ch-3', currentFilePath: 'e.ts' })
    press('}')
    expect(mockSetCurrentChapter).not.toHaveBeenCalled()
  })
})

describe('PrReviewView (continued) — chapter keyboard navigation — } respects the file order override of the target chapter', () => {
  it('} respects the file order override of the target chapter', async () => {
    await renderView(
      { chapters },
      {
        currentChapterId: 'ch-1',
        currentFilePath: 'a.ts',
        fileOrderOverrides: { 'ch-2': ['d.ts', 'c.ts'] },
      }
    )
    press('}')
    expect(mockSetCurrentFile).toHaveBeenCalledWith('d.ts')
  })

  it('] crosses into the next chapter from the last file of a chapter (Files view)', async () => {
    await renderView({ chapters }, { currentChapterId: 'ch-1', currentFilePath: 'b.ts' })
    press(']')
    expect(mockSetCurrentChapter).toHaveBeenCalledWith('ch-2')
    expect(mockSetCurrentFile).toHaveBeenCalledWith('c.ts')
  })

  it('] stays in the chapter and does not switch it mid-chapter', async () => {
    await renderView({ chapters }, { currentChapterId: 'ch-1', currentFilePath: 'a.ts' })
    press(']')
    expect(mockSetCurrentFile).toHaveBeenCalledWith('b.ts')
    expect(mockSetCurrentChapter).not.toHaveBeenCalled()
  })
})

describe('PrReviewView (continued) — chapter keyboard navigation — ] crosses chapters in the Chapters view too', () => {
  it('] crosses chapters in the Chapters view too', async () => {
    await renderView({ chapters }, { currentChapterId: 'ch-1', currentFilePath: 'b.ts' })
    fireEvent.click(screen.getByRole('radio', { name: 'Chapters' }))
    press(']')
    expect(mockSetCurrentChapter).toHaveBeenCalledWith('ch-2')
    expect(mockSetCurrentFile).toHaveBeenCalledWith('c.ts')
  })

  it('[ crosses back to the last file of the previous chapter', async () => {
    await renderView({ chapters }, { currentChapterId: 'ch-2', currentFilePath: 'c.ts' })
    press('[')
    expect(mockSetCurrentChapter).toHaveBeenCalledWith('ch-1')
    expect(mockSetCurrentFile).toHaveBeenCalledWith('b.ts')
  })

  it('] and [ stop at the first and last files of the whole PR', async () => {
    await renderView({ chapters }, { currentChapterId: 'ch-3', currentFilePath: 'e.ts' })
    press(']')
    expect(mockSetCurrentFile).not.toHaveBeenCalled()
  })
})

describe('PrReviewView (continued) — chapter keyboard navigation — marking the last file of a chapter viewed advances into the next chapter', () => {
  it('marking the last file of a chapter viewed advances into the next chapter', async () => {
    await renderView({ chapters }, { currentChapterId: 'ch-1', currentFilePath: 'b.ts' })
    fireEvent.click(screen.getByText('MarkViewed'))
    expect(mockMarkFileViewed).toHaveBeenCalledWith(
      { repoRoot: '/repo', prNumber: 1, headSHA: 'abc' },
      'b.ts'
    )
    expect(mockSetCurrentChapter).toHaveBeenCalledWith('ch-2')
    expect(mockSetCurrentFile).toHaveBeenCalledWith('c.ts')
  })

  it('shows "Chapter 2 of 3" in the Chapters view only', async () => {
    await renderView({ chapters }, { currentChapterId: 'ch-2', currentFilePath: 'c.ts' })
    expect(screen.queryByText('Chapter 2 of 3')).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: 'Chapters' }))
    expect(screen.getByText('Chapter 2 of 3')).toBeTruthy()
  })
})
