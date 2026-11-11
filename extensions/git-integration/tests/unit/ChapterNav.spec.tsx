import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChapterNav } from '../../src/components/pr-review/ChapterNav'
import type { Chapter } from '../../src/schemas/pr-review.schema'
import { changedFile } from './support/pr-review-file'

function makeChapter(id: string, name: string, files: string[] = ['a.ts']): Chapter {
  return {
    id,
    name,
    status: 'not-started',
    files: files.map((f) => changedFile(f)),
  }
}

const three = [makeChapter('c1', 'Core'), makeChapter('c2', 'Tests'), makeChapter('c3', 'Docs')]

const progress = {
  c1: { read: 3, total: 3 },
  c2: { read: 1, total: 4 },
  c3: { read: 0, total: 2 },
}

function renderRail(props: Partial<React.ComponentProps<typeof ChapterNav>> = {}) {
  const onSelectChapter = vi.fn()
  render(
    <ChapterNav
      chapters={three}
      progress={progress}
      activeId="c2"
      onSelectChapter={onSelectChapter}
      {...props}
    />
  )
  return { onSelectChapter }
}

describe('ChapterNav — the chapter rail', () => {
  it('opens a chapter when it is picked', async () => {
    const { onSelectChapter } = renderRail()
    await userEvent.click(screen.getByRole('button', { name: /^Docs/ }))
    expect(onSelectChapter).toHaveBeenCalledWith('c3')
  })

  it('marks the open chapter current', () => {
    renderRail()
    const current = screen.getAllByRole('button').map((b) => b.getAttribute('aria-current'))
    expect(current).toEqual([null, 'true', null])
  })

  it("shows each chapter's summary under its name", () => {
    const chapters = [{ ...three[0], summary: 'Changes markViewed and viewAll' }, three[1]]
    renderRail({ chapters })
    const core = screen.getByRole('button', { name: /^Core/ })
    expect(within(core).getByText('Changes markViewed and viewAll')).toBeTruthy()
  })
})

describe('ChapterNav — read progress', () => {
  it('names each chapter with its read hunks', () => {
    renderRail()
    expect(screen.getByRole('button', { name: 'Core, 3 of 3 hunks read' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Tests, 1 of 4 hunks read' })).toBeTruthy()
  })

  it('shows read and total hunks, and a check only on a chapter read to the end', () => {
    renderRail()
    expect(screen.getByText('1/4')).toBeTruthy()
    expect(screen.getAllByLabelText('complete')).toHaveLength(1)
    const core = screen.getByRole('button', { name: /^Core/ })
    expect(within(core).getByLabelText('complete')).toBeTruthy()
  })
})
