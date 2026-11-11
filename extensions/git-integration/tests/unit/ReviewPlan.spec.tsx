import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReviewPlan } from '../../src/components/pr-review/ReviewPlan'
import { makeFile } from './overview-fixtures'
import type { Chapter, PrChangedFile } from '../../src/schemas/pr-review.schema'

function file(path: string): PrChangedFile {
  return makeFile(path)
}

type ChapterFields = Pick<Chapter, 'id' | 'name' | 'files' | 'summary'>

function chapter(fields: ChapterFields): Chapter {
  return { ...fields, status: 'not-started' }
}

const chapters: Chapter[] = [
  chapter({
    id: 'c1',
    name: 'Settings store and debounce',
    summary: 'Changes markViewed and viewAll',
    files: [file('src/a/store.ts')],
  }),
  chapter({
    id: 'c2',
    name: 'Panel layout',
    files: ['one', 'two', 'three', 'four', 'five'].map((n) => file(`src/${n}.tsx`)),
  }),
]

describe('ReviewPlan', () => {
  it('renders a row per chapter with its name and changed lines, and no risk or minutes', () => {
    render(<ReviewPlan chapters={chapters} onStartAt={() => {}} />)
    const row = screen.getByRole('button', { name: /Start here: Settings store and debounce/ })
    expect(row.textContent).toContain('+10 −5')
    expect(row.textContent).toContain('store.ts')
    expect(row.textContent).not.toMatch(/risk|min$/i)
  })

  it('shows the first three file names and the rest as a count', () => {
    render(<ReviewPlan chapters={chapters} onStartAt={() => {}} />)
    const row = screen.getByRole('button', { name: /Start here: Panel layout/ })
    expect(row.textContent).toContain('+2')
    expect(row.textContent).not.toContain('four.tsx')
    expect(row.textContent).toContain('5 files')
  })

  it('starts at the chapter whose row is clicked', async () => {
    const user = userEvent.setup()
    const started: string[] = []
    render(<ReviewPlan chapters={chapters} onStartAt={(id) => started.push(id)} />)
    await user.click(screen.getByRole('button', { name: /Start here: Panel layout/ }))
    expect(started).toEqual(['c2'])
  })
})

describe('ReviewPlan rows and headings', () => {
  it('describes each row by its file count and changed lines', () => {
    render(<ReviewPlan chapters={chapters} onStartAt={() => {}} />)
    const row = screen.getByRole('button', {
      name: /Start here: Panel layout/,
      description: '5 files, +50 −25 lines',
    })
    expect(row).toBeTruthy()
  })

  it('titles the plan with a level 2 heading', () => {
    render(<ReviewPlan chapters={chapters} onStartAt={() => {}} />)
    expect(screen.getByRole('heading', { level: 2, name: 'Review plan' })).toBeTruthy()
  })

  it('renders nothing without chapters', () => {
    const { container } = render(<ReviewPlan chapters={[]} onStartAt={() => {}} />)
    expect(container.innerHTML).toBe('')
  })

  it('counts the chapters in the heading line', () => {
    render(<ReviewPlan chapters={chapters} onStartAt={() => {}} />)
    expect(screen.getByText('2 chapters')).toBeTruthy()
  })
})

describe('ReviewPlan chapter summary', () => {
  it("shows a chapter's summary line under its name", () => {
    render(<ReviewPlan chapters={chapters} onStartAt={() => {}} />)
    const row = screen.getByRole('button', { name: /Start here: Settings store and debounce/ })
    expect(within(row).getByText('Changes markViewed and viewAll')).toBeTruthy()
  })

  it('shows no summary line for a chapter without one', () => {
    render(<ReviewPlan chapters={chapters} onStartAt={() => {}} />)
    const row = screen.getByRole('button', { name: /Start here: Panel layout/ })
    expect(within(row).queryByTestId('chapter-summary')).toBeNull()
  })
})
