import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
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
    onPause: vi.fn(),
    onAskAgent: vi.fn(),
    onRefresh: vi.fn(),
    refreshing: false,
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

  it.each([
    { isDraft: true, badgeCount: 1 },
    { isDraft: false, badgeCount: 0 },
  ])('shows $badgeCount Draft badge when isDraft is $isDraft', ({ isDraft, badgeCount }) => {
    render(<ReviewHeader {...baseProps({ isDraft })} />)
    expect(screen.queryAllByText(/draft/i)).toHaveLength(badgeCount)
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

  it('is a quiet "Checks pass" status, not a pill, when every check passes', () => {
    render(<ReviewHeader {...baseProps({ checks: passing })} />)
    const status = screen.getByRole('button', { name: 'Checks pass' })
    expect(status.classList.contains('rh-pill')).toBe(false)
  })

  it.each([
    { checks: failing, name: /1 of 2 checks failing/i, tone: 'rh-pill--fail' },
    { checks: pending, name: /1 of 2 checks pending/i, tone: 'rh-pill--pending' },
  ])('is the warning pill when a check is not passing ($tone)', ({ checks, name, tone }) => {
    render(<ReviewHeader {...baseProps({ checks })} />)
    expect(screen.getByRole('button', { name }).classList.contains(tone)).toBe(true)
  })
})

describe('ReviewHeader (continued) — checks pill — opens a popover with the check list on click', () => {
  it('opens a popover with the check list on click', async () => {
    const user = userEvent.setup()
    render(<ReviewHeader {...baseProps({ checks: failing })} />)
    await user.click(screen.getByRole('button', { name: /checks failing/i }))
    expect(screen.getByText('build / test')).toBeTruthy()
    expect(screen.getByText('lint')).toBeTruthy()
  })
})

describe('ReviewHeader (continued)', () => {
  describe('progress', () => {
    it('draws one segment per chapter, named by the viewed total', () => {
      render(<ReviewHeader {...baseProps({ viewedCount: 3, totalFiles: 12 })} />)
      const segments = screen.getByRole('progressbar', { name: 'Files viewed' })
      expect(within(segments).getAllByTestId('progress-segment')).toHaveLength(2)
      expect(segments.getAttribute('aria-valuemin')).toBe('0')
      expect(segments.getAttribute('aria-valuemax')).toBe('12')
      expect(segments.getAttribute('aria-valuenow')).toBe('3')
    })

    it('sizes each segment by its file count and fills the viewed share', () => {
      render(<ReviewHeader {...baseProps()} />)
      const [first, second] = within(
        screen.getByRole('progressbar', { name: 'Files viewed' })
      ).getAllByTestId('progress-segment')
      expect(first.style.flexGrow).toBe('6')
      expect(first.style.getPropertyValue('--filled')).toBe('33.33333333333333%')
      expect(second.style.flexGrow).toBe('4')
      expect(second.style.getPropertyValue('--filled')).toBe('0%')
    })

    it('says how many files are viewed, with no reading time', () => {
      render(<ReviewHeader {...baseProps({ viewedCount: 4, totalFiles: 23 })} />)
      expect(screen.getByText('4 of 23 viewed')).toBeTruthy()
      expect(screen.queryByText(/min/)).toBeNull()
    })
  })
})

describe('ReviewHeader — ask agent', () => {
  it('calls onAskAgent from the Ask agent button with the right accessible name', async () => {
    const user = userEvent.setup()
    const onAskAgent = vi.fn()
    render(<ReviewHeader {...baseProps({ onAskAgent })} />)
    const btn = screen.getByRole('button', { name: 'Ask agent about this PR' })
    expect(btn.textContent).toMatch(/ask agent/i)
    await user.click(btn)
    expect(onAskAgent).toHaveBeenCalledTimes(1)
  })
})

describe('ReviewHeader — calls onClose from the close button', () => {
  it('calls onClose from the close button', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ReviewHeader {...baseProps({ onClose })} />)
    await user.click(screen.getByRole('button', { name: 'Close review' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

async function openMenu(user: UserEvent) {
  await user.click(screen.getByRole('button', { name: 'More review actions' }))
}

describe('ReviewHeader (continued) — More menu', () => {
  it('has aria-haspopup and toggles aria-expanded', async () => {
    const user = userEvent.setup()
    render(<ReviewHeader {...baseProps()} />)
    const trigger = screen.getByRole('button', { name: 'More review actions' })
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    await user.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
  })

  it('lists only actions, no settings', async () => {
    const user = userEvent.setup()
    render(<ReviewHeader {...baseProps({ onShowOverview: vi.fn(), onPopOut: vi.fn() })} />)
    await openMenu(user)
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual([
      'Overview',
      'Pause review',
      'Refresh pull request',
      'Pop out',
      'Keyboard shortcuts',
    ])
  })

  it('has no View menu', () => {
    render(<ReviewHeader {...baseProps()} />)
    expect(screen.queryByRole('button', { name: 'View' })).toBeNull()
  })
})

describe('ReviewHeader (continued) — More menu — calls onShowOverview and closes when Overview is present', () => {
  it('calls onShowOverview and closes when Overview is present', async () => {
    const user = userEvent.setup()
    const onShowOverview = vi.fn()
    render(<ReviewHeader {...baseProps({ onShowOverview })} />)
    await openMenu(user)
    await user.click(screen.getByRole('menuitem', { name: /overview/i }))
    expect(onShowOverview).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('omits Overview when onShowOverview is not provided', async () => {
    const user = userEvent.setup()
    render(<ReviewHeader {...baseProps({ onShowOverview: undefined })} />)
    await openMenu(user)
    expect(screen.queryByRole('menuitem', { name: /overview/i })).toBeNull()
  })
})

describe('ReviewHeader (continued) — More menu — calls onRefresh for Refresh pull request and closes', () => {
  it('calls onRefresh for Refresh pull request and closes', async () => {
    const user = userEvent.setup()
    const onRefresh = vi.fn()
    render(<ReviewHeader {...baseProps({ onRefresh })} />)
    await openMenu(user)
    await user.click(screen.getByRole('menuitem', { name: /refresh pull request/i }))
    expect(onRefresh).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('disables Refresh pull request while refreshing', async () => {
    const user = userEvent.setup()
    render(<ReviewHeader {...baseProps({ refreshing: true })} />)
    await openMenu(user)
    const item = screen.getByRole('menuitem', { name: /refresh pull request/i })
    expect(item.hasAttribute('disabled')).toBe(true)
  })
})

describe('ReviewHeader (continued) — More menu — Pop out', () => {
  it('calls onPopOut for Pop out and closes', async () => {
    const user = userEvent.setup()
    const onPopOut = vi.fn()
    render(<ReviewHeader {...baseProps({ onPopOut })} />)
    await openMenu(user)
    await user.click(screen.getByRole('menuitem', { name: /pop out/i }))
    expect(onPopOut).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('omits Pop out when onPopOut is not provided', async () => {
    const user = userEvent.setup()
    render(<ReviewHeader {...baseProps({ onPopOut: undefined })} />)
    await openMenu(user)
    expect(screen.queryByRole('menuitem', { name: /pop out/i })).toBeNull()
  })

  it('calls onOpenKeyboardHelp for Keyboard shortcuts and closes', async () => {
    const user = userEvent.setup()
    const onOpenKeyboardHelp = vi.fn()
    render(<ReviewHeader {...baseProps({ onOpenKeyboardHelp })} />)
    await openMenu(user)
    await user.click(screen.getByRole('menuitem', { name: /keyboard shortcuts/i }))
    expect(onOpenKeyboardHelp).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('ReviewHeader — back arrow', () => {
  it('goes back to the overview from the back arrow', async () => {
    const user = userEvent.setup()
    const onShowOverview = vi.fn()
    render(<ReviewHeader {...baseProps({ onShowOverview })} />)
    await user.click(screen.getByRole('button', { name: 'Back to overview' }))
    expect(onShowOverview).toHaveBeenCalledTimes(1)
  })

  it('has no back arrow without an overview to go back to', () => {
    render(<ReviewHeader {...baseProps({ onShowOverview: undefined })} />)
    expect(screen.queryByRole('button', { name: 'Back to overview' })).toBeNull()
  })
})

describe('ReviewHeader — submit and pause', () => {
  it('has no Submit review button, since the verdict bar submits', () => {
    render(<ReviewHeader {...baseProps()} />)
    expect(screen.queryByRole('button', { name: /Submit review/ })).toBeNull()
  })

  it('keeps Pause review in the more menu', async () => {
    const user = userEvent.setup()
    const onPause = vi.fn()
    render(<ReviewHeader {...baseProps({ onPause })} />)
    await openMenu(user)
    await user.click(screen.getByRole('menuitem', { name: 'Pause review' }))
    expect(onPause).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
