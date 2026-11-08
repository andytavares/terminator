import React from 'react'
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { isInaccessible, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppBand } from '../../../../src/renderer/components/sidebar/AppBand'

const noop = () => null

const globalTabs = [
  { id: 'overview', label: 'Overview', component: noop, icon: <svg data-testid="i-overview" /> },
  { id: 'notes', label: 'Notes', component: noop, icon: <svg data-testid="i-notes" /> },
  { id: 'vault', label: 'Task Vault', component: noop },
]

let onSelect: Mock<(id: string) => void>

beforeEach(() => {
  vi.clearAllMocks()
  onSelect = vi.fn()
})

function renderBand(props: Partial<React.ComponentProps<typeof AppBand>> = {}) {
  return render(<AppBand globalTabs={globalTabs} activeId={null} onSelect={onSelect} {...props} />)
}

describe('AppBand — one labelled home for app-level surfaces (US4)', () => {
  it('names every entry as a reachable button with no drawn text, since the band is icons only (FR-036)', () => {
    renderBand()
    const entries = screen
      .getAllByRole('button')
      .map((el) => [el.getAttribute('aria-label'), el.title, el.textContent, el.tabIndex])
    expect(entries).toEqual([
      ['Overview', 'Overview', '', 0],
      ['Notes', 'Notes', '', 0],
      ['Task Vault', 'Task Vault', '', 0],
    ])
  })

  it('hides the icon from assistive technology — the label carries it', () => {
    renderBand()
    expect(isInaccessible(screen.getByTestId('i-overview'))).toBe(true)
    expect(isInaccessible(screen.getByTestId('i-notes'))).toBe(true)
  })

  it('draws the puzzle glyph when a contribution supplies no icon', () => {
    renderBand()
    // eslint-disable-next-line testing-library/no-node-access -- the glyph is an aria-hidden SVG with no role, name or test id
    const icon = screen.getByRole('button', { name: 'Task Vault' }).querySelector('svg')
    expect(icon?.classList.contains('lucide-puzzle')).toBe(true)
  })
})

describe('AppBand — selection', () => {
  it('selects a global tab by id', async () => {
    const user = userEvent.setup()
    renderBand()
    await user.click(screen.getByRole('button', { name: 'Notes' }))
    expect(onSelect).toHaveBeenCalledWith('notes')
  })

  it('marks only the active global tab as the current page', () => {
    renderBand({ activeId: 'notes' })
    const current = screen.getAllByRole('button').map((el) => el.getAttribute('aria-current'))
    expect(current).toEqual([null, 'page', null])
  })

  it('omits a global tab that asked to be hidden', () => {
    renderBand({
      globalTabs: [...globalTabs, { id: 'secret', label: 'Secret', component: noop, hidden: true }],
    })
    expect(screen.getAllByRole('button')).toHaveLength(3)
    expect(screen.queryByText('Secret')).toBeNull()
  })

  it('renders nothing at all when nothing is contributed', () => {
    const { container } = renderBand({ globalTabs: [] })
    expect(container.innerHTML).toBe('')
  })
})

describe('AppBand — quick actions', () => {
  it('renders the band for this entry alone', () => {
    const onOpenQuickActions = vi.fn()
    renderBand({ globalTabs: [], onOpenQuickActions })
    expect(screen.getByRole('button', { name: 'Quick actions (⌘P)' })).toBeTruthy()
  })

  it('calls the handler on click', async () => {
    const user = userEvent.setup()
    const onOpenQuickActions = vi.fn()
    renderBand({ onOpenQuickActions })
    await user.click(screen.getByRole('button', { name: 'Quick actions (⌘P)' }))
    expect(onOpenQuickActions).toHaveBeenCalledOnce()
  })

  it('sits before the notification bell', () => {
    renderBand({ onOpenQuickActions: vi.fn(), onBellClick: vi.fn() })
    const names = [...screen.getAllByRole('button')].map((el) => el.getAttribute('aria-label'))
    expect(names.indexOf('Quick actions (⌘P)')).toBeLessThan(names.indexOf('Notifications'))
  })

  it('draws the icon with no inline colour', () => {
    renderBand({ onOpenQuickActions: vi.fn() })
    // eslint-disable-next-line testing-library/no-node-access -- the glyph is an aria-hidden SVG with no role, name or test id
    const icon = screen.getByRole('button', { name: 'Quick actions (⌘P)' }).querySelector('svg')!
    expect(icon.getAttribute('style')).toBeNull()
  })
})

describe('AppBand — a tab badge', () => {
  it('counts on the entry and names the count for a reader', () => {
    renderBand({
      globalTabs: [
        { id: 'core.home', label: 'Home', component: noop, badge: 2, badgeLabel: '2 need you' },
      ],
    })
    const entry = screen.getByRole('button', { name: 'Home, 2 need you' })
    expect(entry.textContent).toContain('2')
  })

  it('caps the count at 9+', () => {
    renderBand({ globalTabs: [{ id: 'core.home', label: 'Home', component: noop, badge: 12 }] })
    expect(screen.getByRole('button', { name: 'Home' }).textContent).toContain('9+')
  })

  it('draws nothing for a zero count', () => {
    renderBand({
      globalTabs: [{ id: 'core.home', label: 'Home', component: noop, badge: 0, badgeLabel: 'x' }],
    })
    expect(screen.getByRole('button', { name: 'Home' }).textContent).toBe('')
  })
})
