import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
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

const three = [makeChapter('c1', 'Core'), makeChapter('c2', 'Tests'), makeChapter('c3', 'Docs')]

describe('ChapterNav', () => {
  it('shows only the file list when there is one chapter', () => {
    render(
      <ChapterNav chapters={[makeChapter('c1', 'Core')]}>
        <div>core files</div>
      </ChapterNav>
    )
    expect(screen.getByText('core files')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Core/ })).toBeNull()
  })

  it('makes a chapter current when its header is clicked', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const chapters = [makeChapter('c1', 'Core'), makeChapter('c2', 'Tests')]
    render(<ChapterNav chapters={chapters} onSelectChapter={onSelect} />)
    await user.click(screen.getByRole('button', { name: /^Tests/ }))
    expect(mockSetCurrentChapter).toHaveBeenCalledWith('c2')
    expect(onSelect).toHaveBeenCalledWith('c2')
  })
})

describe('ChapterNav — outline', () => {
  it('renders the file list directly under the current chapter header, before the next chapter', () => {
    setupStore({ currentChapterId: 'c1' })
    const chapters = [
      makeChapter('c1', 'Core'),
      makeChapter('c2', 'Tests'),
      makeChapter('c3', 'Docs'),
    ]
    render(
      <ChapterNav chapters={chapters}>
        <div>core files</div>
      </ChapterNav>
    )
    const core = screen.getByRole('button', { name: /^Core/ })
    const files = screen.getByText('core files')
    const tests = screen.getByRole('button', { name: /^Tests/ })
    expect(core.compareDocumentPosition(files) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(files.compareDocumentPosition(tests) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('ChapterNav — outline expansion and summary', () => {
  it('expands only the current chapter, falling back to the first', () => {
    setupStore({ currentChapterId: 'c2' })
    render(<ChapterNav chapters={three} />)
    const expanded = screen.getAllByRole('button').map((b) => b.getAttribute('aria-expanded'))
    expect(expanded).toEqual(['false', 'true', 'false'])
    expect(screen.getByRole('button', { name: /^Tests/ }).getAttribute('aria-current')).toBe('true')
  })

  it("shows each chapter's summary under its name", () => {
    const chapters = [
      { ...makeChapter('c1', 'Core'), summary: 'Changes markViewed and viewAll · 1 test file' },
      makeChapter('c2', 'Tests'),
    ]
    render(<ChapterNav chapters={chapters} />)
    const core = screen.getByRole('button', { name: /^Core/ })
    expect(within(core).getByText('Changes markViewed and viewAll · 1 test file')).toBeTruthy()
  })
})

describe('ChapterNav — chapter header', () => {
  it('shows a complete checkmark on each chapter whose files are all viewed', () => {
    setupStore({ currentChapterId: null, viewedFiles: new Set(['a.ts', 'b.ts']) })
    const chapters = [makeChapter('c1', 'Core', ['a.ts']), makeChapter('c2', 'Tests', ['b.ts'])]
    render(<ChapterNav chapters={chapters} />)
    expect(screen.getAllByLabelText('complete')).toHaveLength(2)
  })

  it('shows viewed and total files and the estimate for each chapter', () => {
    setupStore({ currentChapterId: null, viewedFiles: new Set(['a.ts']) })
    const chapters = [
      makeChapter('c1', 'Core', ['a.ts', 'b.ts']),
      makeChapter('c2', 'Tests', ['c.ts']),
    ]
    render(<ChapterNav chapters={chapters} />)
    expect(screen.getByText('1/2 · 5 min')).toBeTruthy()
    expect(screen.getByText('0/1 · 5 min')).toBeTruthy()
  })

  it('names each chapter header with its name, file count and whether it is viewed', () => {
    setupStore({ currentChapterId: null, viewedFiles: new Set(['a.ts']) })
    const chapters = [
      makeChapter('c1', 'Core', ['a.ts']),
      makeChapter('c2', 'Tests', ['b.ts', 'c.ts']),
    ]
    render(<ChapterNav chapters={chapters} />)
    expect(screen.getByRole('button', { name: 'Core, 1 file, viewed' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Tests, 2 files' })).toBeTruthy()
  })
})
