import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AppBand } from '../../../../src/renderer/components/sidebar/AppBand'

const noop = () => null

const globalTabs = [
  { id: 'overview', label: 'Overview', component: noop, icon: <svg data-testid="i-overview" /> },
  { id: 'notes', label: 'Notes', component: noop, icon: <svg data-testid="i-notes" /> },
  { id: 'vault', label: 'Task Vault', component: noop },
]

let onSelect: ReturnType<typeof vi.fn>
let onRunItem: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  onSelect = vi.fn()
  onRunItem = vi.fn()
})

const sidebarItems = () => [{ id: 'git-changes', label: 'Git Changes', action: onRunItem }]

function renderBand(props: Partial<React.ComponentProps<typeof AppBand>> = {}) {
  return render(
    <AppBand
      globalTabs={globalTabs}
      sidebarItems={sidebarItems()}
      activeId={null}
      onSelect={onSelect}
      {...props}
    />
  )
}

describe('AppBand — one labelled home for app-level surfaces (US4)', () => {
  it('shows a visible text label for every entry, not just an icon', () => {
    renderBand()
    for (const label of ['Overview', 'Notes', 'Task Vault', 'Git Changes']) {
      expect(screen.getByText(label)).toBeTruthy()
    }
  })

  it('draws global tabs and contributed sidebar items in the same band', () => {
    const { container } = renderBand()
    expect(container.querySelectorAll('.app-band__entry')).toHaveLength(4)
  })

  it('gives every entry an accessible name', () => {
    const { container } = renderBand()
    const names = [...container.querySelectorAll('.app-band__entry')].map((el) =>
      el.getAttribute('aria-label')
    )
    expect(names).toEqual(['Overview', 'Notes', 'Task Vault', 'Git Changes'])
  })

  it('hides the icon from assistive technology — the label carries it', () => {
    const { container } = renderBand()
    for (const icon of container.querySelectorAll('.app-band__icon')) {
      expect(icon.getAttribute('aria-hidden')).toBe('true')
    }
  })

  it('falls back to a neutral glyph when a contribution supplies no icon', () => {
    const { container } = renderBand()
    const vault = [...container.querySelectorAll('.app-band__entry')].find(
      (el) => el.getAttribute('aria-label') === 'Task Vault'
    )!
    // Renders something, and does not throw — an extension must not be able to
    // break the sidebar by omitting an icon.
    expect(vault.querySelector('.app-band__icon')).toBeTruthy()
  })

  it('selects a global tab by id', () => {
    renderBand()
    fireEvent.click(screen.getByText('Notes'))
    expect(onSelect).toHaveBeenCalledWith('notes')
  })

  it('runs a contributed item action rather than selecting it as a tab', () => {
    renderBand()
    fireEvent.click(screen.getByText('Git Changes'))
    expect(onRunItem).toHaveBeenCalledOnce()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('marks the active global tab', () => {
    const { container } = renderBand({ activeId: 'notes' })
    const active = container.querySelectorAll('.app-band__entry--active')
    expect(active).toHaveLength(1)
    expect(active[0].getAttribute('aria-label')).toBe('Notes')
  })

  it('exposes selection state to assistive technology as well as visually', () => {
    const { container } = renderBand({ activeId: 'notes' })
    const notes = [...container.querySelectorAll('.app-band__entry')].find(
      (el) => el.getAttribute('aria-label') === 'Notes'
    )!
    expect(notes.getAttribute('aria-current')).toBe('page')
  })

  it('keeps every entry keyboard reachable in reading order', () => {
    const { container } = renderBand()
    for (const el of container.querySelectorAll('.app-band__entry')) {
      expect(el.tagName).toBe('BUTTON')
      expect(el.getAttribute('tabindex')).not.toBe('-1')
    }
  })

  it('omits a global tab that asked to be hidden', () => {
    const { container } = renderBand({
      globalTabs: [...globalTabs, { id: 'secret', label: 'Secret', component: noop, hidden: true }],
    })
    expect(container.querySelectorAll('.app-band__entry')).toHaveLength(4)
    expect(screen.queryByText('Secret')).toBeNull()
  })

  it('renders nothing at all when nothing is contributed', () => {
    const { container } = renderBand({ globalTabs: [], sidebarItems: [] })
    expect(container.querySelector('.app-band')).toBeNull()
  })

  it('names no extension in its own markup — it renders registry data only', () => {
    const { container } = renderBand({
      globalTabs: [{ id: 'x', label: 'Anything At All', component: noop }],
      sidebarItems: [],
    })
    expect(screen.getByText('Anything At All')).toBeTruthy()
    expect(container.querySelectorAll('.app-band__entry')).toHaveLength(1)
  })
})
