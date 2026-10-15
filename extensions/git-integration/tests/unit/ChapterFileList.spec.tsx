import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ChapterFileList } from '../../src/components/pr-review/ChapterFileList'
import { usePrReviewStore } from '../../src/stores/pr-review.store'
import type { Chapter } from '../../src/schemas/pr-review.schema'
import { changedFile } from './support/pr-review-file'
import { makeRiskScore } from './risk-score-fixtures'

vi.mock('../../src/stores/pr-review.store', () => ({
  usePrReviewStore: vi.fn(),
}))

const mockReorderFiles = vi.fn()

function makeChapter(): Chapter {
  return {
    id: 'ch-1',
    name: 'Core',
    estimatedMinutes: 5,
    status: 'not-started',
    files: [
      changedFile('src/foo.ts', {
        additions: 3,
        deletions: 1,
        riskScore: makeRiskScore(),
        whyHere: 'Core logic',
      }),
      changedFile('src/bar.ts', {
        changeType: 'added',
        additions: 10,
        tier: 2,
        riskScore: makeRiskScore(),
        whyHere: 'New feature',
      }),
    ],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(usePrReviewStore).mockReturnValue({
    viewedFiles: new Set<string>(),
    fileOrderOverrides: {},
    reorderFiles: mockReorderFiles,
  })
})

const defaultProps = {
  repoRoot: '/repo',
  prNumber: 42,
  headSHA: 'abc',
  chapter: makeChapter(),
  currentFilePath: null,
  onSelectFile: vi.fn(),
}

describe('ChapterFileList', () => {
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
})

describe('ChapterFileList — marks active file with active class', () => {
  it('marks active file with active class', () => {
    const { container } = render(<ChapterFileList {...defaultProps} currentFilePath="src/foo.ts" />)
    const active = container.querySelector('.chapter-file-row--active')
    expect(active?.getAttribute('aria-current')).toBe('true')
    expect(container.querySelectorAll('[aria-current]')).toHaveLength(1)
  })

  it('shows viewed check for viewed files', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      viewedFiles: new Set(['src/foo.ts']),
      fileOrderOverrides: {},
      reorderFiles: mockReorderFiles,
    })
    render(<ChapterFileList {...defaultProps} />)
    expect(screen.getByRole('img', { name: 'Viewed' })).toBeTruthy()
  })

  it('shows file additions and deletions', () => {
    render(<ChapterFileList {...defaultProps} />)
    expect(screen.getAllByText('+3').length).toBeGreaterThan(0)
  })

  it('does not show why-here text on the row', () => {
    render(<ChapterFileList {...defaultProps} />)
    expect(screen.queryByText('Core logic')).toBeNull()
    expect(screen.queryByTitle('Core logic')).toBeNull()
  })
})

describe('ChapterFileList — respects fileOrderOverrides for file order', () => {
  it('respects fileOrderOverrides for file order', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      viewedFiles: new Set<string>(),
      fileOrderOverrides: { 'ch-1': ['src/bar.ts', 'src/foo.ts'] },
      reorderFiles: mockReorderFiles,
    })
    render(<ChapterFileList {...defaultProps} />)
    const rows = screen.getAllByRole('button')
    expect(rows[0].textContent).toContain('bar.ts')
    expect(rows[1].textContent).toContain('foo.ts')
  })
})

describe('ChapterFileList — calls reorderFiles on drag and drop between rows', () => {
  it('calls reorderFiles on drag and drop between rows', () => {
    render(<ChapterFileList {...defaultProps} />)
    const rows = screen.getAllByRole('button')
    fireEvent.dragStart(rows[0])
    fireEvent.dragOver(rows[1])
    fireEvent.drop(rows[1])
    expect(mockReorderFiles).toHaveBeenCalledWith(
      { repoRoot: '/repo', prNumber: 42, headSHA: 'abc' },
      'ch-1',
      ['src/bar.ts', 'src/foo.ts']
    )
  })

  it('does not reorder when dropping on the same index', () => {
    render(<ChapterFileList {...defaultProps} />)
    const rows = screen.getAllByRole('button')
    fireEvent.dragStart(rows[0])
    fireEvent.drop(rows[0])
    expect(mockReorderFiles).not.toHaveBeenCalled()
  })
})

describe('ChapterFileList — sets drag-over class when dragging over a row', () => {
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

describe('ChapterFileList — shows changed for a file changed since it was viewed', () => {
  it('shows "changed" for a file changed since it was viewed', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      viewedFiles: new Set<string>(),
      fileOrderOverrides: {},
      reorderFiles: mockReorderFiles,
      changedSince: new Set(['src/foo.ts']),
      viewedAt: {},
    })
    render(<ChapterFileList {...defaultProps} />)
    expect(screen.getByText('changed')).toBeTruthy()
  })

  it('shows "new file" for a file a push added since your last look', () => {
    const chapter = makeChapter()
    chapter.files[1] = { ...chapter.files[1], changeType: 'added' } as Chapter['files'][number]
    vi.mocked(usePrReviewStore).mockReturnValue({
      viewedFiles: new Set<string>(),
      fileOrderOverrides: {},
      reorderFiles: mockReorderFiles,
      changedSince: new Set<string>(),
      newSinceLook: new Set([chapter.files[1].path]),
    })
    render(<ChapterFileList {...defaultProps} chapter={chapter} />)
    expect(screen.getByText('new file')).toBeTruthy()
  })
})

describe('ChapterFileList — does not call an added file new on a first review', () => {
  it('does not call an added file new on a first review', () => {
    const chapter = makeChapter()
    chapter.files[1] = { ...chapter.files[1], changeType: 'added' } as Chapter['files'][number]
    vi.mocked(usePrReviewStore).mockReturnValue({
      viewedFiles: new Set<string>(),
      fileOrderOverrides: {},
      reorderFiles: mockReorderFiles,
      changedSince: new Set<string>(),
      newSinceLook: new Set<string>(),
    })
    render(<ChapterFileList {...defaultProps} chapter={chapter} />)
    expect(screen.queryByText('new file')).toBeNull()
  })
})
