import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { usePrReviewStore } from '../../src/stores/pr-review.store'

vi.mock('../../src/stores/pr-review.store', () => ({ usePrReviewStore: vi.fn() }))
vi.mock('../../src/components/pr-review/HealthChips', () => ({
  HealthChips: () => <div data-testid="health-chips" />,
}))
vi.mock('../../src/components/pr-review/InlineCommentThread', () => ({
  InlineCommentThread: () => <div data-testid="thread" />,
}))
vi.mock('../../src/components/pr-review/CommentComposer', () => ({
  CommentComposer: ({ onCancel }: any) => (
    <div data-testid="composer">
      <button onClick={onCancel}>Cancel</button>
    </div>
  ),
}))
vi.mock('../../src/github/pr-review-service', () => ({
  detectComplexityHotspots: vi.fn().mockReturnValue([]),
  computeFileCyclomaticDelta: vi.fn().mockReturnValue(0),
}))

const mockPatchFileComplexity = vi.fn()
const mockPrFileDiff = vi.fn()

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
  onPause: vi.fn(),
  onOpenSubmit: vi.fn(),
  onShowRisk: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPrFileDiff.mockResolvedValue({ diff: { hunks: [] } })
  ;(globalThis as any).electronAPI = {
    github: { prFileDiff: mockPrFileDiff },
  }
  vi.mocked(usePrReviewStore).mockReturnValue({
    viewedFiles: new Set<string>(),
    threads: {},
    patchFileComplexity: mockPatchFileComplexity,
  } as any)
})

afterEach(() => {
  delete (globalThis as any).electronAPI
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

  it('shows LOW RISK label for low risk file', async () => {
    await renderPane()
    expect(screen.getByText(/LOW RISK/)).toBeTruthy()
  })

  it('shows HIGH RISK label for high risk file', async () => {
    const highFile = { ...mockFile, riskScore: { ...mockFile.riskScore, level: 'high' as const } }
    await renderPane({ file: highFile })
    expect(screen.getByText(/HIGH RISK/)).toBeTruthy()
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
      viewedFiles: new Set(['src/foo.ts']),
      threads: {},
      patchFileComplexity: mockPatchFileComplexity,
    } as any)
    await renderPane()
    expect(screen.getByText('✓ Viewed')).toBeTruthy()
  })

  it('shows Finish chapter button when on last file', async () => {
    await renderPane({ chapterProgress: { index: 1, total: 2 } })
    expect(screen.getByText('Finish chapter ↵')).toBeTruthy()
  })

  it('shows Mark viewed button when not on last file', async () => {
    await renderPane({ chapterProgress: { index: 0, total: 2 } })
    expect(screen.getByText('Mark viewed → Next 1')).toBeTruthy()
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

  it('calls onShowRisk when why? button is clicked', async () => {
    const onShowRisk = vi.fn()
    await renderPane({ onShowRisk })
    fireEvent.click(screen.getByText('why?'))
    expect(onShowRisk).toHaveBeenCalled()
  })

  it('calls onPrevFile when ← Prev is clicked', async () => {
    const onPrevFile = vi.fn()
    await renderPane({ onPrevFile })
    fireEvent.click(screen.getByText('← Prev'))
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
})
