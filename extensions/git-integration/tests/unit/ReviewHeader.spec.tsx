import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ReviewHeader, type ReviewHeaderProps } from '../../src/components/pr-review/ReviewHeader'
import type { StatusCheck } from '../../src/schemas/pr-review.schema'

const passing: StatusCheck[] = [
  { name: 'build / test', state: 'pass' },
  { name: 'lint', state: 'pass' },
]

const failing: StatusCheck[] = [
  { name: 'build / test', state: 'fail' },
  { name: 'lint', state: 'pass' },
]

const pending: StatusCheck[] = [
  { name: 'build / test', state: 'pending' },
  { name: 'lint', state: 'pass' },
]

function noOwnedFilter() {
  return { ownedCount: 0, ownedOnly: false, onToggleOwnedOnly: vi.fn() }
}

function baseProps(overrides: Partial<ReviewHeaderProps> = {}): ReviewHeaderProps {
  return {
    prNumber: 42,
    title: 'Fix the thing',
    isDraft: false,
    checks: [],
    viewedCount: 2,
    totalFiles: 10,
    chapters: [
      { id: 'c1', fileCount: 6, viewedCount: 2 },
      { id: 'c2', fileCount: 4, viewedCount: 0 },
    ],
    minutesLeft: 6,
    draftCount: 0,
    onSubmit: vi.fn(),
    onPause: vi.fn(),
    largePr: null,
    onDismissLargePr: vi.fn(),
    focusMode: false,
    onToggleFocusMode: vi.fn(),
    ...noOwnedFilter(),
    onAskAgent: vi.fn(),
    onRefresh: vi.fn(),
    refreshing: false,
    onToggleFileList: vi.fn(),
    onOpenKeyboardHelp: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  }
}

describe('ReviewHeader', () => {
  it('renders the PR number and title', () => {
    render(<ReviewHeader {...baseProps()} />)
    expect(screen.getByText(/#42/)).toBeTruthy()
    expect(screen.getByText('Fix the thing')).toBeTruthy()
  })

  it('shows a Draft badge when isDraft is true', () => {
    render(<ReviewHeader {...baseProps({ isDraft: true })} />)
    expect(screen.getByText(/draft/i)).toBeTruthy()
  })

  it('does not show a Draft badge when isDraft is false', () => {
    render(<ReviewHeader {...baseProps({ isDraft: false })} />)
    expect(screen.queryByText(/draft/i)).toBeNull()
  })
})

describe('ReviewHeader (continued) — checks pill', () => {
  it('is absent when there are no checks', () => {
    render(<ReviewHeader {...baseProps({ checks: [] })} />)
    expect(screen.queryByText(/checks/i)).toBeNull()
  })

  it('shows failing count when any check fails', () => {
    render(<ReviewHeader {...baseProps({ checks: failing })} />)
    expect(screen.getByRole('button', { name: /1 of 2 checks failing/i })).toBeTruthy()
  })

  it('shows pending count when none fail but some pend', () => {
    render(<ReviewHeader {...baseProps({ checks: pending })} />)
    expect(screen.getByRole('button', { name: /1 of 2 checks pending/i })).toBeTruthy()
  })

  it('shows passing count when all pass', () => {
    render(<ReviewHeader {...baseProps({ checks: passing })} />)
    expect(screen.getByRole('button', { name: /2 checks passing/i })).toBeTruthy()
  })

  it('uses the singular "check" for a single passing check', () => {
    render(<ReviewHeader {...baseProps({ checks: [{ name: 'only', state: 'pass' }] })} />)
    expect(screen.getByRole('button', { name: /1 check passing/i })).toBeTruthy()
  })
})

describe('ReviewHeader (continued) — checks pill — opens a popover with the check list on click', () => {
  it('opens a popover with the check list on click', () => {
    render(<ReviewHeader {...baseProps({ checks: failing })} />)
    fireEvent.click(screen.getByRole('button', { name: /checks failing/i }))
    expect(screen.getByText('build / test')).toBeTruthy()
    expect(screen.getByText('lint')).toBeTruthy()
  })
})

describe('ReviewHeader (continued)', () => {
  describe('large-PR pill', () => {
    it('is absent when largePr is null', () => {
      render(<ReviewHeader {...baseProps({ largePr: null })} />)
      expect(screen.queryByText(/LOC/)).toBeNull()
    })

    it('shows LOC and estimated minutes when set', () => {
      render(<ReviewHeader {...baseProps({ largePr: { loc: 1234, minutes: 20 } })} />)
      expect(screen.getByRole('button', { name: /1,234 LOC · ~20 min/ })).toBeTruthy()
    })

    it('opens a popover with the warning sentence and a dismiss button', () => {
      const onDismissLargePr = vi.fn()
      render(
        <ReviewHeader {...baseProps({ largePr: { loc: 1234, minutes: 20 }, onDismissLargePr })} />
      )
      fireEvent.click(screen.getByRole('button', { name: /1,234 LOC/ }))
      expect(
        screen.getByText(
          'Large PR — 1,234 LOC, estimated 20 min to review. Consider requesting it be split.'
        )
      ).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
      expect(onDismissLargePr).toHaveBeenCalledTimes(1)
    })
  })
})

describe('ReviewHeader (continued)', () => {
  describe('focus pill', () => {
    it('is absent when focusMode is false', () => {
      render(<ReviewHeader {...baseProps({ focusMode: false })} />)
      expect(screen.queryByRole('button', { name: /^focus mode$/i })).toBeNull()
    })

    it('is shown and pressed when focusMode is true, and toggles off on click', () => {
      const onToggleFocusMode = vi.fn()
      render(<ReviewHeader {...baseProps({ focusMode: true, onToggleFocusMode })} />)
      const btn = screen.getByRole('button', { name: /^focus mode$/i })
      expect(btn.getAttribute('aria-pressed')).toBe('true')
      fireEvent.click(btn)
      expect(onToggleFocusMode).toHaveBeenCalledTimes(1)
    })
  })
})

describe('ReviewHeader (continued)', () => {
  describe('progress', () => {
    it('draws one segment per chapter, named by the viewed total', () => {
      render(<ReviewHeader {...baseProps({ viewedCount: 3, totalFiles: 12 })} />)
      const segments = screen.getByRole('progressbar', { name: 'Files viewed' })
      expect(segments.querySelectorAll('i')).toHaveLength(2)
      expect(segments.getAttribute('aria-valuemin')).toBe('0')
      expect(segments.getAttribute('aria-valuemax')).toBe('12')
      expect(segments.getAttribute('aria-valuenow')).toBe('3')
    })

    it('sizes each segment by its file count and fills the viewed share', () => {
      render(<ReviewHeader {...baseProps()} />)
      const [first, second] = screen
        .getByRole('progressbar', { name: 'Files viewed' })
        .querySelectorAll('i')
      expect(first.style.flexGrow).toBe('6')
      expect(first.style.getPropertyValue('--filled')).toBe('33.33333333333333%')
      expect(second.style.flexGrow).toBe('4')
      expect(second.style.getPropertyValue('--filled')).toBe('0%')
    })

    it('says how many files are viewed and how long is left', () => {
      render(<ReviewHeader {...baseProps({ viewedCount: 4, totalFiles: 23, minutesLeft: 26 })} />)
      expect(screen.getByText('4 of 23 viewed · about 26 min left')).toBeTruthy()
    })

    it('leaves the time out when nothing is left to read', () => {
      render(<ReviewHeader {...baseProps({ viewedCount: 10, totalFiles: 10, minutesLeft: 0 })} />)
      expect(screen.getByText('10 of 10 viewed')).toBeTruthy()
    })
  })
})

describe('ReviewHeader — ask agent', () => {
  it('calls onAskAgent from the Ask agent button with the right accessible name', () => {
    const onAskAgent = vi.fn()
    render(<ReviewHeader {...baseProps({ onAskAgent })} />)
    const btn = screen.getByRole('button', { name: 'Ask agent about this PR' })
    expect(btn.textContent).toMatch(/ask agent/i)
    fireEvent.click(btn)
    expect(onAskAgent).toHaveBeenCalledTimes(1)
  })
})

describe('ReviewHeader — calls onClose from the close button', () => {
  it('calls onClose from the close button', () => {
    const onClose = vi.fn()
    render(<ReviewHeader {...baseProps({ onClose })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close review' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'More review actions' }))
}

describe('ReviewHeader (continued) — More menu', () => {
  it('has aria-haspopup and toggles aria-expanded', () => {
    render(<ReviewHeader {...baseProps()} />)
    const trigger = screen.getByRole('button', { name: 'More review actions' })
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
  })

  it('opens a menu with role=menu and calls onToggleFocusMode, closing after', () => {
    const onToggleFocusMode = vi.fn()
    render(<ReviewHeader {...baseProps({ onToggleFocusMode })} />)
    openMenu()
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /focus mode/i }))
    expect(onToggleFocusMode).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('shows "On" next to Focus mode item when focusMode is true', () => {
    render(<ReviewHeader {...baseProps({ focusMode: true })} />)
    openMenu()
    const item = screen.getByRole('menuitemcheckbox', { name: /focus mode.*on/i })
    expect(item.getAttribute('aria-checked')).toBe('true')
  })
})

describe('ReviewHeader (continued) — More menu — calls onShowOverview and closes when Overview is present', () => {
  it('calls onShowOverview and closes when Overview is present', () => {
    const onShowOverview = vi.fn()
    render(<ReviewHeader {...baseProps({ onShowOverview })} />)
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: /overview/i }))
    expect(onShowOverview).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('omits Overview when onShowOverview is not provided', () => {
    render(<ReviewHeader {...baseProps({ onShowOverview: undefined })} />)
    openMenu()
    expect(screen.queryByRole('menuitem', { name: /overview/i })).toBeNull()
  })

  it('calls onToggleFileList for Hide file list and closes', () => {
    const onToggleFileList = vi.fn()
    render(<ReviewHeader {...baseProps({ onToggleFileList })} />)
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: /hide file list/i }))
    expect(onToggleFileList).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('ReviewHeader (continued) — More menu — calls onRefresh for Refresh PR and closes', () => {
  it('calls onRefresh for Refresh PR and closes', () => {
    const onRefresh = vi.fn()
    render(<ReviewHeader {...baseProps({ onRefresh })} />)
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: /refresh pr/i }))
    expect(onRefresh).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('disables Refresh PR while refreshing', () => {
    render(<ReviewHeader {...baseProps({ refreshing: true })} />)
    openMenu()
    const item = screen.getByRole('menuitem', { name: /refresh pr/i })
    expect(item.hasAttribute('disabled')).toBe(true)
  })
})

describe('ReviewHeader (continued) — More menu — calls onPopOut for Pop out and closes, and omits it when absent', () => {
  it('calls onPopOut for Pop out and closes, and omits it when absent', () => {
    const onPopOut = vi.fn()
    const { unmount } = render(<ReviewHeader {...baseProps({ onPopOut })} />)
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: /pop out/i }))
    expect(onPopOut).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
    unmount()

    render(<ReviewHeader {...baseProps({ onPopOut: undefined })} />)
    openMenu()
    expect(screen.queryByRole('menuitem', { name: /pop out/i })).toBeNull()
  })

  it('calls onOpenKeyboardHelp for Keyboard shortcuts and closes', () => {
    const onOpenKeyboardHelp = vi.fn()
    render(<ReviewHeader {...baseProps({ onOpenKeyboardHelp })} />)
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: /keyboard shortcuts/i }))
    expect(onOpenKeyboardHelp).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('ReviewHeader — back arrow', () => {
  it('goes back to the overview from the back arrow', () => {
    const onShowOverview = vi.fn()
    render(<ReviewHeader {...baseProps({ onShowOverview })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Back to overview' }))
    expect(onShowOverview).toHaveBeenCalledTimes(1)
  })

  it('has no back arrow without an overview to go back to', () => {
    render(<ReviewHeader {...baseProps({ onShowOverview: undefined })} />)
    expect(screen.queryByRole('button', { name: 'Back to overview' })).toBeNull()
  })
})

describe('ReviewHeader — submit and pause', () => {
  it('shows the draft count on the Submit review button', () => {
    const onSubmit = vi.fn()
    render(<ReviewHeader {...baseProps({ draftCount: 2, onSubmit })} />)
    const submit = screen.getByRole('button', { name: /^Submit review/ })
    expect(submit.textContent).toContain('2')
    fireEvent.click(submit)
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('shows no count badge without drafts', () => {
    render(<ReviewHeader {...baseProps({ draftCount: 0 })} />)
    expect(screen.getByRole('button', { name: 'Submit review' }).textContent).toBe('Submit review')
  })

  it('keeps Pause review in the more menu', () => {
    const onPause = vi.fn()
    render(<ReviewHeader {...baseProps({ onPause })} />)
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pause review' }))
    expect(onPause).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('ReviewHeader — only my files', () => {
  it('counts the files the viewer owns and toggles the filter from the More menu', () => {
    const onToggleOwnedOnly = vi.fn()
    render(<ReviewHeader {...baseProps({ ownedCount: 3, onToggleOwnedOnly })} />)
    openMenu()
    const item = screen.getByRole('menuitemcheckbox', { name: /only my files.*3/i })
    fireEvent.click(item)
    expect(onToggleOwnedOnly).toHaveBeenCalledTimes(1)
  })

  it('is disabled when the viewer owns no changed file', () => {
    render(<ReviewHeader {...baseProps({ ownedCount: 0 })} />)
    openMenu()
    const item = screen.getByRole('menuitemcheckbox', { name: /only my files/i })
    expect(item.hasAttribute('disabled')).toBe(true)
  })

  it('shows a pressed pill while the filter is on, and turns it off on click', () => {
    const onToggleOwnedOnly = vi.fn()
    render(<ReviewHeader {...baseProps({ ownedCount: 3, ownedOnly: true, onToggleOwnedOnly })} />)
    const pill = screen.getByRole('button', { name: /^my files$/i })
    expect(pill.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(pill)
    expect(onToggleOwnedOnly).toHaveBeenCalledTimes(1)
  })
})
