import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ChapterFileList } from '../../src/components/pr-review/ChapterFileList'
import { usePrReviewStore } from '../../src/stores/pr-review.store'
import type { Chapter, RiskScore } from '../../src/schemas/pr-review.schema'

vi.mock('../../src/stores/pr-review.store', () => ({
  usePrReviewStore: vi.fn(),
}))

const mockReorderFiles = vi.fn()

function makeRiskScore(): RiskScore {
  return {
    score: 10,
    level: 'low',
    metrics: {
      linesChanged: 5,
      filesChanged: 1,
      testFilePresent: true,
      complexityDelta: 0,
      churn90d: 1,
      blastRadius: 1,
      patchCoverage: 90,
    },
  }
}

function makeChapter(): Chapter {
  return {
    id: 'ch-1',
    name: 'Core',
    estimatedMinutes: 5,
    files: [
      {
        path: 'src/foo.ts',
        status: 'modified',
        additions: 3,
        deletions: 1,
        tier: 1,
        riskScore: makeRiskScore(),
        whyHere: 'Core logic',
      },
      {
        path: 'src/bar.ts',
        status: 'added',
        additions: 10,
        deletions: 0,
        tier: 2,
        riskScore: makeRiskScore(),
        whyHere: 'New feature',
      },
    ],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(usePrReviewStore).mockReturnValue({
    viewedFiles: new Set<string>(),
    fileOrderOverrides: {},
    reorderFiles: mockReorderFiles,
  } as unknown as ReturnType<typeof usePrReviewStore>)
})

describe('ChapterFileList', () => {
  const defaultProps = {
    repoRoot: '/repo',
    prNumber: 42,
    headSHA: 'abc',
    chapter: makeChapter(),
    currentFilePath: null,
    onSelectFile: vi.fn(),
  }

  it('renders file names', () => {
    render(<ChapterFileList {...defaultProps} />)
    expect(screen.getByText('foo.ts')).toBeTruthy()
    expect(screen.getByText('bar.ts')).toBeTruthy()
  })

  it('calls onSelectFile when file row is clicked', () => {
    const onSelectFile = vi.fn()
    render(<ChapterFileList {...defaultProps} onSelectFile={onSelectFile} />)
    fireEvent.click(screen.getByText('foo.ts'))
    expect(onSelectFile).toHaveBeenCalledWith('src/foo.ts')
  })

  it('calls onSelectFile when Enter is pressed on file row', () => {
    const onSelectFile = vi.fn()
    render(<ChapterFileList {...defaultProps} onSelectFile={onSelectFile} />)
    const rows = screen.getAllByRole('button')
    fireEvent.keyDown(rows[0], { key: 'Enter' })
    expect(onSelectFile).toHaveBeenCalled()
  })

  it('marks active file with active class', () => {
    const { container } = render(<ChapterFileList {...defaultProps} currentFilePath="src/foo.ts" />)
    expect(container.querySelector('.chapter-file-row--active')).toBeTruthy()
  })

  it('shows viewed check for viewed files', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      viewedFiles: new Set(['src/foo.ts']),
      fileOrderOverrides: {},
      reorderFiles: mockReorderFiles,
    } as unknown as ReturnType<typeof usePrReviewStore>)
    render(<ChapterFileList {...defaultProps} />)
    expect(screen.getByLabelText('Viewed')).toBeTruthy()
  })

  it('shows file additions and deletions', () => {
    render(<ChapterFileList {...defaultProps} />)
    expect(screen.getAllByText('+3').length).toBeGreaterThan(0)
  })

  it('shows why-here text', () => {
    render(<ChapterFileList {...defaultProps} />)
    expect(screen.getByTitle('Core logic')).toBeTruthy()
  })

  it('respects fileOrderOverrides for file order', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      viewedFiles: new Set<string>(),
      fileOrderOverrides: { 'ch-1': ['src/bar.ts', 'src/foo.ts'] },
      reorderFiles: mockReorderFiles,
    } as unknown as ReturnType<typeof usePrReviewStore>)
    render(<ChapterFileList {...defaultProps} />)
    const rows = screen.getAllByRole('button')
    expect(rows[0].textContent).toContain('bar.ts')
    expect(rows[1].textContent).toContain('foo.ts')
  })

  it('renders row numbers', () => {
    render(<ChapterFileList {...defaultProps} />)
    expect(screen.getByText('1')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
  })

  it('calls reorderFiles on drag and drop between rows', () => {
    render(<ChapterFileList {...defaultProps} />)
    const rows = screen.getAllByRole('button')
    fireEvent.dragStart(rows[0])
    fireEvent.dragOver(rows[1])
    fireEvent.drop(rows[1])
    expect(mockReorderFiles).toHaveBeenCalledWith(
      'ch-1',
      ['src/bar.ts', 'src/foo.ts'],
      '/repo',
      42,
      'abc'
    )
  })

  it('does not reorder when dropping on the same index', () => {
    render(<ChapterFileList {...defaultProps} />)
    const rows = screen.getAllByRole('button')
    fireEvent.dragStart(rows[0])
    fireEvent.drop(rows[0])
    expect(mockReorderFiles).not.toHaveBeenCalled()
  })

  it('sets drag-over class when dragging over a row', () => {
    const { container } = render(<ChapterFileList {...defaultProps} />)
    const rows = screen.getAllByRole('button')
    fireEvent.dragStart(rows[0])
    fireEvent.dragOver(rows[1])
    expect(container.querySelector('.chapter-file-row--drag-over')).toBeTruthy()
  })

  it('clears drag state on drag end', () => {
    const { container } = render(<ChapterFileList {...defaultProps} />)
    const rows = screen.getAllByRole('button')
    fireEvent.dragStart(rows[0])
    fireEvent.dragOver(rows[1])
    fireEvent.dragEnd(rows[0])
    expect(container.querySelector('.chapter-file-row--drag-over')).toBeNull()
  })
})
