import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SidebarHeader } from '../../../../src/renderer/components/sidebar/SidebarHeader'
import type { GlobalTabRegistration } from '../../../../src/renderer/extensions/registry'

const makeTab = (id: string, label: string, hidden = false): GlobalTabRegistration => ({
  id,
  label,
  icon: label[0],
  component: (() => null) as unknown as GlobalTabRegistration['component'],
  hidden,
})

const defaultProps = {
  globalTabs: [] as GlobalTabRegistration[],
  sidebarItems: [],
  activeGlobalTabId: null as string | null,
  onSelectGlobalTab: vi.fn(),
  onSearchFocus: vi.fn(),
  onAddWorkspace: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('SidebarHeader', () => {
  it('renders a search input element', () => {
    const { container } = render(<SidebarHeader {...defaultProps} />)
    expect(container.querySelector('.sidebar-search')).toBeTruthy()
    expect(container.querySelector('input')).toBeTruthy()
  })

  it('calls onSearchChange when search input value changes', () => {
    const onSearchChange = vi.fn()
    const { container } = render(
      <SidebarHeader {...defaultProps} searchQuery="" onSearchChange={onSearchChange} />
    )
    fireEvent.change(container.querySelector('input')!, { target: { value: 'test' } })
    expect(onSearchChange).toHaveBeenCalledWith('test')
  })

  it('renders one button per non-hidden globalTabs entry', () => {
    const tabs = [makeTab('t1', 'Overview'), makeTab('t2', 'Git')]
    render(<SidebarHeader {...defaultProps} globalTabs={tabs} />)
    expect(screen.getByLabelText('Overview')).toBeTruthy()
    expect(screen.getByLabelText('Git')).toBeTruthy()
  })

  it('does not render hidden tabs', () => {
    const tabs = [makeTab('t1', 'Overview'), makeTab('t2', 'Hidden', true)]
    render(<SidebarHeader {...defaultProps} globalTabs={tabs} />)
    expect(screen.getByLabelText('Overview')).toBeTruthy()
    expect(screen.queryByTitle('Hidden')).toBeNull()
  })

  it('calls onSelectGlobalTab with the correct id when a tab button is clicked', () => {
    const onSelect = vi.fn()
    const tabs = [makeTab('t1', 'Overview')]
    render(<SidebarHeader {...defaultProps} globalTabs={tabs} onSelectGlobalTab={onSelect} />)
    fireEvent.click(screen.getByLabelText('Overview'))
    expect(onSelect).toHaveBeenCalledWith('t1')
  })

  it('applies active class to the active global tab button', () => {
    const tabs = [makeTab('t1', 'Overview')]
    const { container } = render(
      <SidebarHeader {...defaultProps} globalTabs={tabs} activeGlobalTabId="t1" />
    )
    expect(container.querySelector('.app-band__entry--active')).toBeTruthy()
  })

  it('renders + workspace button', () => {
    render(<SidebarHeader {...defaultProps} />)
    expect(screen.getByLabelText(/new repo/i)).toBeTruthy()
  })

  it('calls onAddWorkspace when + button is clicked', () => {
    const onAdd = vi.fn()
    render(<SidebarHeader {...defaultProps} onAddWorkspace={onAdd} />)
    fireEvent.click(screen.getByLabelText(/new repo/i))
    expect(onAdd).toHaveBeenCalledOnce()
  })

  it('renders bell badge when unreadNotifications > 0', () => {
    const { container } = render(<SidebarHeader {...defaultProps} unreadNotifications={3} />)
    const badge = container.querySelector('.sidebar-header__bell-badge')
    expect(badge).toBeTruthy()
    expect(badge?.textContent).toBe('3')
  })

  it('renders 9+ badge when unreadNotifications exceeds 9', () => {
    const { container } = render(<SidebarHeader {...defaultProps} unreadNotifications={12} />)
    const badge = container.querySelector('.sidebar-header__bell-badge')
    expect(badge).toBeTruthy()
    expect(badge?.textContent).toBe('9+')
  })

  it('does not render bell badge when unreadNotifications is 0', () => {
    const { container } = render(<SidebarHeader {...defaultProps} unreadNotifications={0} />)
    expect(container.querySelector('.sidebar-header__bell-badge')).toBeNull()
  })
})

function renderHeader(overrides: Partial<React.ComponentProps<typeof SidebarHeader>> = {}) {
  return render(<SidebarHeader {...defaultProps} sidebarItems={[]} {...overrides} />)
}

describe('SidebarHeader — the app band sits above, list controls sit with the list (US4)', () => {
  it('draws the app band above the search row', () => {
    const { container } = renderHeader({
      globalTabs: [makeTab('overview', 'Overview')],
    })
    const band = container.querySelector('.app-band')
    const search = container.querySelector('.sidebar-search')
    expect(band).toBeTruthy()
    expect(search).toBeTruthy()
    expect(band!.compareDocumentPosition(search!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps no unlabelled icon row of its own', () => {
    const { container } = renderHeader({
      globalTabs: [makeTab('overview', 'Overview')],
    })
    expect(container.querySelector('.sidebar-header__tabs')).toBeNull()
  })

  it('puts the bell and add-repo controls on the search row, where the list is', () => {
    const { container } = renderHeader()
    const row = container.querySelector('.sidebar-header__search-row')!
    expect(row.querySelector('.sidebar-header__bell')).toBeTruthy()
    expect(row.querySelector('.sidebar-header__add')).toBeTruthy()
  })

  it('labels every app-band entry', () => {
    renderHeader({
      globalTabs: [makeTab('overview', 'Overview')],
    })
    expect(screen.getByText('Overview')).toBeTruthy()
  })
})

describe('SidebarHeader — optional search handlers', () => {
  it('does not crash when typing with no onSearchChange supplied', () => {
    const { container } = render(<SidebarHeader {...defaultProps} sidebarItems={[]} />)
    expect(() =>
      fireEvent.change(container.querySelector('input')!, { target: { value: 'x' } })
    ).not.toThrow()
  })

  it('does not crash when clearing with no onSearchClear supplied', () => {
    const { container } = render(
      <SidebarHeader {...defaultProps} sidebarItems={[]} searchQuery="abc" />
    )
    const clear = container.querySelector('.sidebar-search__clear') as HTMLElement | null
    if (clear) expect(() => fireEvent.click(clear)).not.toThrow()
    else expect(container.querySelector('input')).toBeTruthy()
  })
})
