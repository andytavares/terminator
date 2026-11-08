import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChapterNav } from '../../src/components/pr-review/ChapterNav'
import { usePrReviewStore } from '../../src/stores/pr-review.store'
import type { Chapter } from '../../src/schemas/pr-review.schema'
import { changedFile } from './support/pr-review-file'
import { partialFake } from '../../../../packages/test-support/src/fakes'

type PrReviewState = ReturnType<typeof usePrReviewStore.getState>

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
  vi.mocked(usePrReviewStore).mockImplementation((selector?: (s: PrReviewState) => unknown) =>
    selector ? selector(partialFake<PrReviewState>(full)) : full
  )
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
    expect(container.innerHTML).toBe('')
  })

  it('calls setCurrentChapter when a tab is clicked', async () => {
    const user = userEvent.setup()
    const chapters = [makeChapter('c1', 'Core'), makeChapter('c2', 'Tests')]
    render(<ChapterNav chapters={chapters} />)
    await user.click(screen.getByRole('tab', { name: /^Tests/ }))
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

  it('shows a complete checkmark on each chapter whose files are all viewed', () => {
    setupStore({ currentChapterId: null, viewedFiles: new Set(['a.ts', 'b.ts']) })
    const chapters = [makeChapter('c1', 'Core', ['a.ts']), makeChapter('c2', 'Tests', ['b.ts'])]
    render(<ChapterNav chapters={chapters} />)
    expect(screen.getAllByLabelText('complete')).toHaveLength(2)
  })

  it('shows file count and estimate time for each chapter', () => {
    const chapters = [makeChapter('c1', 'Core', ['a.ts', 'b.ts']), makeChapter('c2', 'Tests')]
    render(<ChapterNav chapters={chapters} />)
    expect(screen.getByText('2 files · 5m')).toBeTruthy()
    expect(screen.getByText('1 file · 5m')).toBeTruthy()
  })
})

describe('ChapterNav — accessible tab names', () => {
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

  it('ArrowDown focuses and activates the next tab', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<ChapterNav chapters={three} onSelectChapter={onSelect} />)
    const tabs = screen.getAllByRole('tab')
    tabs[0].focus()
    expect(tabs[0].matches(':focus')).toBe(true)
    await user.keyboard('{ArrowDown}')
    expect(tabs[1].matches(':focus')).toBe(true)
    expect(mockSetCurrentChapter).toHaveBeenCalledWith('c2')
    expect(onSelect).toHaveBeenCalledWith('c2')
  })
})

describe('ChapterNav (continued) — keyboard model — ArrowDown wraps from last to first and ArrowUp wraps from first to last', () => {
  it('ArrowDown wraps from last to first and ArrowUp wraps from first to last', async () => {
    const user = userEvent.setup()
    render(<ChapterNav chapters={three} />)
    const tabs = screen.getAllByRole('tab')
    tabs[2].focus()
    expect(tabs[2].matches(':focus')).toBe(true)
    await user.keyboard('{ArrowDown}')
    expect(tabs[0].matches(':focus')).toBe(true)
    await user.keyboard('{ArrowUp}')
    expect(tabs[2].matches(':focus')).toBe(true)
    expect(mockSetCurrentChapter).toHaveBeenLastCalledWith('c3')
  })

  it('Home and End go to the first and last tab', async () => {
    const user = userEvent.setup()
    render(<ChapterNav chapters={three} />)
    const tabs = screen.getAllByRole('tab')
    tabs[1].focus()
    expect(tabs[1].matches(':focus')).toBe(true)
    await user.keyboard('{End}')
    expect(tabs[2].matches(':focus')).toBe(true)
    await user.keyboard('{Home}')
    expect(tabs[0].matches(':focus')).toBe(true)
    expect(mockSetCurrentChapter).toHaveBeenLastCalledWith('c1')
  })
})
