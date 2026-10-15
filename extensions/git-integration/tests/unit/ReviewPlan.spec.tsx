import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ReviewPlan } from '../../src/components/pr-review/ReviewPlan'
import type { Chapter, PrChangedFile } from '../../src/schemas/pr-review.schema'

function file(path: string, level: 'low' | 'medium' | 'high' = 'low'): PrChangedFile {
  return {
    path,
    changeType: 'modified',
    additions: 10,
    deletions: 5,
    isBinary: false,
    tier: 1,
    whyHere: '',
    riskScore: { level, composite: null, metrics: {} },
    estimatedMinutes: 1,
  } as unknown as PrChangedFile
}

function chapter(fields: Pick<Chapter, 'id' | 'name' | 'files' | 'estimatedMinutes'>): Chapter {
  return { ...fields, status: 'not-started' }
}

const chapters: Chapter[] = [
  chapter({
    id: 'c1',
    name: 'Settings store and debounce',
    files: [file('src/a/store.ts', 'high')],
    estimatedMinutes: 12,
  }),
  chapter({
    id: 'c2',
    name: 'Panel layout',
    files: ['one', 'two', 'three', 'four', 'five'].map((n) => file(`src/${n}.tsx`)),
    estimatedMinutes: 8,
  }),
]

describe('ReviewPlan', () => {
  it('renders a row per chapter with name, minutes and the highest risk', () => {
    render(<ReviewPlan chapters={chapters} onStartAt={() => {}} />)
    const row = screen.getByRole('button', { name: /Start review at Settings store and debounce/ })
    expect(row.textContent).toContain('12 min')
    expect(row.textContent).toContain('High risk')
    expect(row.textContent).toContain('store.ts')
  })

  it('shows the first three file names and the rest as a count', () => {
    render(<ReviewPlan chapters={chapters} onStartAt={() => {}} />)
    const row = screen.getByRole('button', { name: /Start review at Panel layout/ })
    expect(row.textContent).toContain('+2')
    expect(row.textContent).not.toContain('four.tsx')
    expect(row.textContent).toContain('5 files')
  })

  it('starts at the chapter whose row is clicked', () => {
    const started: string[] = []
    render(<ReviewPlan chapters={chapters} onStartAt={(id) => started.push(id)} />)
    fireEvent.click(screen.getByRole('button', { name: /Start review at Panel layout/ }))
    expect(started).toEqual(['c2'])
  })

  it('renders nothing without chapters', () => {
    const { container } = render(<ReviewPlan chapters={[]} onStartAt={() => {}} />)
    expect(container.firstChild).toBeNull()
  })

  it('totals the minutes across chapters in the heading line', () => {
    render(<ReviewPlan chapters={chapters} onStartAt={() => {}} />)
    expect(screen.getByText('2 chapters · about 20 min')).toBeTruthy()
  })
})
