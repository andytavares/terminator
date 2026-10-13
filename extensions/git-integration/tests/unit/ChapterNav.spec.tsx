import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ChapterNav } from '../../src/components/pr-review/ChapterNav'
import { usePrReviewStore } from '../../src/stores/pr-review.store'
import type { Chapter } from '../../src/schemas/pr-review.schema'
import { changedFile } from './support/pr-review-file'

vi.mock('../../src/stores/pr-review.store', () => ({
  usePrReviewStore: vi.fn(),
}))

vi.mock('../../src/github/pr-review-service', () => ({
  chapterRiskLevel: vi.fn().mockReturnValue('low'),
}))

const mockSetCurrentChapter = vi.fn()

function setupStore(state: { currentChapterId?: string | null; viewedFiles?: Set<string> } = {}) {
  const full = {
    currentChapterId: null,
    setCurrentChapter: mockSetCurrentChapter,
    viewedFiles: new Set<string>(),
    ...state,
  }
  vi.mocked(usePrReviewStore).mockImplementation(((selector?: (s: typeof full) => unknown) =>
    selector ? selector(full) : full) as unknown as typeof usePrReviewStore)
}

beforeEach(() => {
  vi.clearAllMocks()
  setupStore()
})

function makeChapter(id: string, name: string, files: string[] = ['a.ts']): Chapter {
  return {
    id,
    name,
    estimatedMinutes: 5,
    status: 'not-started',
    files: files.map((f) => changedFile(f)),
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
})

describe('ChapterNav — marks active chapter with aria-selected=true', () => {
  it('marks active chapter with aria-selected=true', () => {
    setupStore({ currentChapterId: 'c1', viewedFiles: new Set<string>() })
    const chapters = [makeChapter('c1', 'Core'), makeChapter('c2', 'Tests')]
    render(<ChapterNav chapters={chapters} />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
    expect(tabs[1].getAttribute('aria-selected')).toBe('false')
  })

  it('shows complete checkmark when all files in chapter are viewed', () => {
    setupStore({ currentChapterId: null, viewedFiles: new Set(['a.ts', 'b.ts']) })
    const chapters = [makeChapter('c1', 'Core', ['a.ts']), makeChapter('c2', 'Tests', ['b.ts'])]
    render(<ChapterNav chapters={chapters} />)
    expect(screen.getAllByLabelText('complete').length).toBeGreaterThanOrEqual(1)
  })

  it('shows file count and estimate time for each chapter', () => {
    const chapters = [makeChapter('c1', 'Core', ['a.ts', 'b.ts']), makeChapter('c2', 'Tests')]
    render(<ChapterNav chapters={chapters} />)
    expect(screen.getByText('2 files · 5m')).toBeTruthy()
    expect(screen.getByText('1 file · 5m')).toBeTruthy()
  })
})

describe('ChapterNav — renders tablist with correct aria-label', () => {
  it('renders tablist with correct aria-label', () => {
    const chapters = [makeChapter('c1', 'Core'), makeChapter('c2', 'Tests')]
    render(<ChapterNav chapters={chapters} />)
    expect(screen.getByRole('tablist')).toBeTruthy()
  })

  it('names each chapter tab with its name, file count and whether it is viewed', () => {
    setupStore({ currentChapterId: null, viewedFiles: new Set(['a.ts']) })
    const chapters = [
      makeChapter('c1', 'Core', ['a.ts']),
      makeChapter('c2', 'Tests', ['b.ts', 'c.ts']),
    ]
    render(<ChapterNav chapters={chapters} />)
    expect(screen.getByRole('tab', { name: 'Core, 1 file, viewed' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Tests, 2 files' })).toBeTruthy()
  })
})

const three = [makeChapter('c1', 'Core'), makeChapter('c2', 'Tests'), makeChapter('c3', 'Docs')]

describe('ChapterNav (continued) — keyboard model', () => {
  it('gives tabIndex 0 only to the active tab, falling back to the first chapter', () => {
    const { unmount } = render(<ChapterNav chapters={three} />)
    expect(screen.getAllByRole('tab').map((t) => t.tabIndex)).toEqual([0, -1, -1])
    unmount()
    setupStore({ currentChapterId: 'c2' })
    render(<ChapterNav chapters={three} />)
    expect(screen.getAllByRole('tab').map((t) => t.tabIndex)).toEqual([-1, 0, -1])
  })

  it('declares a vertical tablist', () => {
    render(<ChapterNav chapters={three} />)
    expect(screen.getByRole('tablist').getAttribute('aria-orientation')).toBe('vertical')
  })

  it('ArrowDown focuses and activates the next tab', () => {
    const onSelect = vi.fn()
    render(<ChapterNav chapters={three} onSelectChapter={onSelect} />)
    const tabs = screen.getAllByRole('tab')
    tabs[0].focus()
    fireEvent.keyDown(tabs[0], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(tabs[1])
    expect(mockSetCurrentChapter).toHaveBeenCalledWith('c2')
    expect(onSelect).toHaveBeenCalledWith('c2')
  })
})

describe('ChapterNav (continued) — keyboard model — ArrowDown wraps from last to first and ArrowUp wraps from first to last', () => {
  it('ArrowDown wraps from last to first and ArrowUp wraps from first to last', () => {
    render(<ChapterNav chapters={three} />)
    const tabs = screen.getAllByRole('tab')
    tabs[2].focus()
    fireEvent.keyDown(tabs[2], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(tabs[0])
    fireEvent.keyDown(tabs[0], { key: 'ArrowUp' })
    expect(document.activeElement).toBe(tabs[2])
    expect(mockSetCurrentChapter).toHaveBeenLastCalledWith('c3')
  })

  it('Home and End go to the first and last tab', () => {
    render(<ChapterNav chapters={three} />)
    const tabs = screen.getAllByRole('tab')
    tabs[1].focus()
    fireEvent.keyDown(tabs[1], { key: 'End' })
    expect(document.activeElement).toBe(tabs[2])
    fireEvent.keyDown(tabs[2], { key: 'Home' })
    expect(document.activeElement).toBe(tabs[0])
    expect(mockSetCurrentChapter).toHaveBeenLastCalledWith('c1')
  })
})
