import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReviewFooter } from '../../src/components/pr-review/ReviewFooter'

function renderFooter(props: Partial<React.ComponentProps<typeof ReviewFooter>> = {}) {
  const handlers = {
    onPrevFile: vi.fn(),
    onMarkViewed: vi.fn(),
    onFinishChapter: vi.fn(),
    onOpenShortcuts: vi.fn(),
  }
  render(
    <ReviewFooter
      previousFileName="store.py"
      nextFileName="api.py"
      isLastFile={false}
      isLastChapter={false}
      {...handlers}
      {...props}
    />
  )
  return handlers
}

describe('ReviewFooter — previous file', () => {
  it('names the previous file and goes back to it', async () => {
    const handlers = renderFooter()
    await userEvent.click(screen.getByRole('button', { name: 'Previous file: store.py' }))
    expect(handlers.onPrevFile).toHaveBeenCalledTimes(1)
  })

  it('is disabled on the first file', () => {
    renderFooter({ previousFileName: null })
    const previous = screen.getByRole('button', { name: /^Previous file/ })
    expect(previous.hasAttribute('disabled')).toBe(true)
  })
})

describe('ReviewFooter — forward action', () => {
  it('names the next file and marks the open one viewed', async () => {
    const handlers = renderFooter()
    await userEvent.click(screen.getByRole('button', { name: 'Viewed, next: api.py' }))
    expect(handlers.onMarkViewed).toHaveBeenCalledTimes(1)
  })

  it('says "next chapter" on the last file of a chapter', async () => {
    const handlers = renderFooter({ isLastFile: true, nextFileName: 'models.py' })
    await userEvent.click(screen.getByRole('button', { name: 'Viewed, next chapter' }))
    expect(handlers.onFinishChapter).toHaveBeenCalledTimes(1)
  })

  it('says "submit review" on the last file overall and finishes, which opens the submit panel', async () => {
    const handlers = renderFooter({ isLastFile: true, isLastChapter: true, nextFileName: null })
    await userEvent.click(screen.getByRole('button', { name: 'Viewed, submit review' }))
    expect(handlers.onFinishChapter).toHaveBeenCalledTimes(1)
  })
})

describe('ReviewFooter — one primary action', () => {
  it.each([
    [false, false, 'Viewed, next: api.py'],
    [true, false, 'Viewed, next chapter'],
    [true, true, 'Viewed, submit review'],
  ])(
    'renders exactly one primary button (last file %s, last chapter %s)',
    (isLastFile, isLastChapter, name) => {
      renderFooter({ isLastFile, isLastChapter })
      const primary = document.querySelectorAll('.tmui-button--primary')
      expect(primary).toHaveLength(1)
      expect(screen.getByRole('button', { name })).toBe(primary[0])
    }
  )
})

describe('ReviewFooter — hints', () => {
  it('shows the Enter hint on the forward action', () => {
    renderFooter()
    expect(screen.getByRole('button', { name: /^Viewed, next/ }).textContent).toContain('↵')
  })
})

describe('ReviewFooter — what it no longer holds', () => {
  it('has no Pause review or drafts button, both moved to the header', () => {
    renderFooter()
    expect(screen.queryByRole('button', { name: 'Pause review' })).toBeNull()
    expect(screen.queryByRole('button', { name: /drafts? on/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Submit review/ })).toBeNull()
  })

  it('opens the keyboard help from the "? Shortcuts" hint', async () => {
    const handlers = renderFooter()
    await userEvent.click(screen.getByRole('button', { name: /Shortcuts/ }))
    expect(handlers.onOpenShortcuts).toHaveBeenCalledTimes(1)
  })
})
