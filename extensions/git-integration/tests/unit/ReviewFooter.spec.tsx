import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReviewFooter } from '../../src/components/pr-review/ReviewFooter'
import type { DraftComment } from '../../src/schemas/pr-review.schema'

function makeDraft(overrides: Partial<DraftComment> = {}): DraftComment {
  return {
    id: 'd1',
    path: 'src/foo.ts',
    line: 10,
    startLine: null,
    side: 'RIGHT',
    body: 'fix this',
    fromFindingId: null,
    ...overrides,
  }
}

function renderFooter(props: Partial<React.ComponentProps<typeof ReviewFooter>> = {}) {
  const handlers = {
    onPause: vi.fn(),
    onPrevFile: vi.fn(),
    onMarkViewed: vi.fn(),
    onFinishChapter: vi.fn(),
    onOpenSubmit: vi.fn(),
    onOpenShortcuts: vi.fn(),
  }
  render(
    <ReviewFooter drafts={[]} isLastFile={false} isLastChapter={false} {...handlers} {...props} />
  )
  return handlers
}

describe('ReviewFooter', () => {
  it('fires onPause when Pause review is clicked', async () => {
    const handlers = renderFooter()
    await userEvent.click(screen.getByRole('button', { name: 'Pause review' }))
    expect(handlers.onPause).toHaveBeenCalledTimes(1)
  })

  it('fires onPrevFile from the Previous file button', async () => {
    const handlers = renderFooter()
    await userEvent.click(screen.getByRole('button', { name: 'Previous file' }))
    expect(handlers.onPrevFile).toHaveBeenCalledTimes(1)
  })

  it('fires onMarkViewed from "Mark viewed, next file" when not on the last file', async () => {
    const handlers = renderFooter({ isLastFile: false })
    await userEvent.click(screen.getByRole('button', { name: 'Mark viewed, next file' }))
    expect(handlers.onMarkViewed).toHaveBeenCalledTimes(1)
  })

  it('fires onFinishChapter with "Finish chapter" label when last file but not last chapter', async () => {
    const handlers = renderFooter({ isLastFile: true, isLastChapter: false })
    await userEvent.click(screen.getByRole('button', { name: 'Finish chapter ↵' }))
    expect(handlers.onFinishChapter).toHaveBeenCalledTimes(1)
  })

  it('labels the primary action "Submit review…" on the last file of the last chapter and finishes', async () => {
    const handlers = renderFooter({ isLastFile: true, isLastChapter: true })
    await userEvent.click(screen.getByRole('button', { name: 'Submit review…' }))
    expect(handlers.onFinishChapter).toHaveBeenCalledTimes(1)
    expect(handlers.onOpenSubmit).not.toHaveBeenCalled()
    expect(screen.getByText('⌘↵')).toBeTruthy()
  })

  it.each([
    [false, false, 'Mark viewed, next file'],
    [true, true, 'Submit review…'],
    [true, false, 'Finish chapter ↵'],
  ])(
    'renders exactly one primary button (last file %s, last chapter %s)',
    (isLastFile, isLastChapter, name) => {
      renderFooter({ isLastFile, isLastChapter })
      const primary = document.querySelectorAll('.rf-pri')
      expect(primary).toHaveLength(1)
      expect(screen.getByRole('button', { name })).toBe(primary[0])
    }
  )

  it('has no separate "Submit review" button mid-review', () => {
    renderFooter({ isLastFile: false })
    expect(screen.queryByRole('button', { name: /^Submit review/ })).toBeNull()
  })

  it('opens the keyboard help from the "? Shortcuts" hint', async () => {
    const handlers = renderFooter()
    await userEvent.click(screen.getByRole('button', { name: /Shortcuts/ }))
    expect(handlers.onOpenShortcuts).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('all keys')).toBeNull()
  })

  it('hides the shortcuts hint when there are drafts', () => {
    renderFooter({ drafts: [makeDraft()] })
    expect(screen.queryByRole('button', { name: /Shortcuts/ })).toBeNull()
  })

  it('shows singular draft/file label for one draft on one file', () => {
    renderFooter({ drafts: [makeDraft({ path: 'src/foo.ts' })] })
    expect(screen.getByRole('button', { name: '1 draft on 1 file' })).toBeTruthy()
  })

  it('shows plural draft/file label and counts distinct files with duplicates', () => {
    renderFooter({
      drafts: [
        makeDraft({ id: 'd1', path: 'src/foo.ts' }),
        makeDraft({ id: 'd2', path: 'src/foo.ts' }),
        makeDraft({ id: 'd3', path: 'src/bar.ts' }),
      ],
    })
    expect(screen.getByRole('button', { name: '3 drafts on 2 files' })).toBeTruthy()
  })

  it('appends the agent-finding suffix only when drafts have a fromFindingId', () => {
    renderFooter({
      drafts: [
        makeDraft({ id: 'd1', path: 'src/foo.ts', fromFindingId: 'f1' }),
        makeDraft({ id: 'd2', path: 'src/bar.ts', fromFindingId: null }),
      ],
    })
    expect(
      screen.getByRole('button', { name: '2 drafts on 2 files · 1 from an agent finding' })
    ).toBeTruthy()
  })

  it('omits the agent-finding suffix when no drafts came from a finding', () => {
    renderFooter({
      drafts: [makeDraft({ id: 'd1', path: 'src/foo.ts', fromFindingId: null })],
    })
    expect(screen.getByRole('button', { name: '1 draft on 1 file' })).toBeTruthy()
  })

  it('opens the submit panel when the drafts summary button is clicked', async () => {
    const handlers = renderFooter({
      drafts: [makeDraft({ id: 'd1', path: 'src/foo.ts' })],
    })
    await userEvent.click(screen.getByRole('button', { name: '1 draft on 1 file' }))
    expect(handlers.onOpenSubmit).toHaveBeenCalledTimes(1)
  })
})
