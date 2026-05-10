import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FullFileList } from '../../src/components/pr-review/FullFileList'
import { usePrReviewStore } from '../../src/stores/pr-review.store'
import type { PrReviewDetail, RiskScore } from '../../src/schemas/pr-review.schema'

vi.mock('../../src/stores/pr-review.store', () => ({
  usePrReviewStore: vi.fn(),
}))

vi.mock('../../src/github/pr-review-service', () => ({
  chapterRiskLevel: vi.fn().mockReturnValue('low'),
}))

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

function makePr(chapters: PrReviewDetail['chapters']): PrReviewDetail {
  return {
    number: 1,
    title: 'My PR',
    body: '',
    headSHA: 'abc',
    headRef: 'feature',
    baseRef: 'main',
    author: 'alice',
    authorAvatarUrl: '',
    state: 'open',
    isDraft: false,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    chapters,
    threads: [],
  }
}

function makeFile(path: string) {
  return {
    path,
    status: 'modified' as const,
    additions: 5,
    deletions: 2,
    tier: 1,
    riskScore: makeRiskScore(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(usePrReviewStore).mockReturnValue({
    viewedFiles: new Set<string>(),
    fileOrderOverrides: {},
  } as unknown as ReturnType<typeof usePrReviewStore>)
})

describe('FullFileList', () => {
  const defaultProps = {
    pr: makePr([
      {
        id: 'ch-1',
        name: 'Core',
        estimatedMinutes: 10,
        files: [makeFile('src/foo.ts'), makeFile('src/bar.ts')],
      },
    ]),
    repoRoot: '/repo',
    headSHA: 'abc',
    currentFilePath: null,
    onSelectFile: vi.fn(),
  }

  it('renders summary with file counts', () => {
    render(<FullFileList {...defaultProps} />)
    expect(screen.getByText('0 / 2 files reviewed')).toBeTruthy()
  })

  it('renders chapter name', () => {
    render(<FullFileList {...defaultProps} />)
    expect(screen.getByText('Core')).toBeTruthy()
  })

  it('renders file names', () => {
    render(<FullFileList {...defaultProps} />)
    expect(screen.getByText('foo.ts')).toBeTruthy()
    expect(screen.getByText('bar.ts')).toBeTruthy()
  })

  it('shows file additions and deletions', () => {
    render(<FullFileList {...defaultProps} />)
    const additions = screen.getAllByText('+5')
    expect(additions.length).toBeGreaterThan(0)
  })

  it('calls onSelectFile when file row is clicked', () => {
    const onSelectFile = vi.fn()
    render(<FullFileList {...defaultProps} onSelectFile={onSelectFile} />)
    fireEvent.click(screen.getByText('foo.ts'))
    expect(onSelectFile).toHaveBeenCalledWith('src/foo.ts', 'ch-1')
  })

  it('toggles chapter collapsed state when header is clicked', () => {
    render(<FullFileList {...defaultProps} />)
    const chapterHeader = screen.getByRole('button', { name: /Ch 1/ })
    fireEvent.click(chapterHeader)
    expect(screen.queryByText('foo.ts')).toBeNull()
  })

  it('marks viewed files with check indicator', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      viewedFiles: new Set(['src/foo.ts']),
      fileOrderOverrides: {},
    } as unknown as ReturnType<typeof usePrReviewStore>)
    const { container } = render(<FullFileList {...defaultProps} />)
    const viewedRow = container.querySelector('.full-file-row--viewed')
    expect(viewedRow).toBeTruthy()
  })

  it('marks active file with active class', () => {
    const { container } = render(<FullFileList {...defaultProps} currentFilePath="src/foo.ts" />)
    const activeRow = container.querySelector('.full-file-row--active')
    expect(activeRow).toBeTruthy()
  })

  it('shows progress per chapter', () => {
    render(<FullFileList {...defaultProps} />)
    expect(screen.getByText('0/2')).toBeTruthy()
  })

  it('shows estimated minutes in summary', () => {
    render(<FullFileList {...defaultProps} />)
    expect(screen.getByText('~10m')).toBeTruthy()
  })

  it('shows done check when chapter is complete', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      viewedFiles: new Set(['src/foo.ts', 'src/bar.ts']),
      fileOrderOverrides: {},
    } as unknown as ReturnType<typeof usePrReviewStore>)
    const { container } = render(<FullFileList {...defaultProps} />)
    expect(container.querySelector('.full-file-chapter-done')).toBeTruthy()
  })

  it('respects fileOrderOverrides for chapter file order', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      viewedFiles: new Set<string>(),
      fileOrderOverrides: { 'ch-1': ['src/bar.ts', 'src/foo.ts'] },
    } as unknown as ReturnType<typeof usePrReviewStore>)
    render(<FullFileList {...defaultProps} />)
    const rows = screen.getAllByTitle(/src\//)
    expect(rows[0].getAttribute('title')).toBe('src/bar.ts')
    expect(rows[1].getAttribute('title')).toBe('src/foo.ts')
  })
})
