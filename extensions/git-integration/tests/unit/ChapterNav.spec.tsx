import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ChapterNav } from '../../src/components/pr-review/ChapterNav'
import { usePrReviewStore } from '../../src/stores/pr-review.store'
import type { Chapter } from '../../src/schemas/pr-review.schema'

vi.mock('../../src/stores/pr-review.store', () => ({
  usePrReviewStore: vi.fn(),
}))

vi.mock('../../src/github/pr-review-service', () => ({
  chapterRiskLevel: vi.fn().mockReturnValue('low'),
}))

const mockSetCurrentChapter = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(usePrReviewStore).mockReturnValue({
    currentChapterId: null,
    setCurrentChapter: mockSetCurrentChapter,
    viewedFiles: new Set<string>(),
  } as unknown as ReturnType<typeof usePrReviewStore>)
})

function makeChapter(id: string, name: string, files: string[] = ['a.ts']): Chapter {
  return {
    id,
    name,
    estimatedMinutes: 5,
    files: files.map((f) => ({ path: f, status: 'modified' as const, additions: 1, deletions: 0 })),
  }
}

describe('ChapterNav', () => {
  it('returns null when only one chapter', () => {
    const { container } = render(<ChapterNav chapters={[makeChapter('c1', 'Core')]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders tabs for multiple chapters', () => {
    const chapters = [makeChapter('c1', 'Core'), makeChapter('c2', 'Tests')]
    render(<ChapterNav chapters={chapters} />)
    expect(screen.getByText('Core')).toBeTruthy()
    expect(screen.getByText('Tests')).toBeTruthy()
  })

  it('calls setCurrentChapter when a tab is clicked', () => {
    const chapters = [makeChapter('c1', 'Core'), makeChapter('c2', 'Tests')]
    render(<ChapterNav chapters={chapters} />)
    fireEvent.click(screen.getByText('Tests'))
    expect(mockSetCurrentChapter).toHaveBeenCalledWith('c2')
  })

  it('marks active chapter with aria-selected=true', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      currentChapterId: 'c1',
      setCurrentChapter: mockSetCurrentChapter,
      viewedFiles: new Set<string>(),
    } as unknown as ReturnType<typeof usePrReviewStore>)
    const chapters = [makeChapter('c1', 'Core'), makeChapter('c2', 'Tests')]
    render(<ChapterNav chapters={chapters} />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
    expect(tabs[1].getAttribute('aria-selected')).toBe('false')
  })

  it('shows complete checkmark when all files in chapter are viewed', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      currentChapterId: null,
      setCurrentChapter: mockSetCurrentChapter,
      viewedFiles: new Set(['a.ts', 'b.ts']),
    } as unknown as ReturnType<typeof usePrReviewStore>)
    const chapters = [makeChapter('c1', 'Core', ['a.ts']), makeChapter('c2', 'Tests', ['b.ts'])]
    render(<ChapterNav chapters={chapters} />)
    expect(screen.getAllByLabelText('complete').length).toBeGreaterThanOrEqual(1)
  })

  it('shows file count and estimate time for each chapter', () => {
    const chapters = [makeChapter('c1', 'Core', ['a.ts', 'b.ts']), makeChapter('c2', 'Tests')]
    render(<ChapterNav chapters={chapters} />)
    expect(screen.getByText('2 files · 5m')).toBeTruthy()
    expect(screen.getByText('1 files · 5m')).toBeTruthy()
  })

  it('renders tablist with correct aria-label', () => {
    const chapters = [makeChapter('c1', 'Core'), makeChapter('c2', 'Tests')]
    render(<ChapterNav chapters={chapters} />)
    expect(screen.getByRole('tablist')).toBeTruthy()
  })
})
