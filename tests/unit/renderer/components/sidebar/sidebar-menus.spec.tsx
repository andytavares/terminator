import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DisplayMenu } from '../../../../../src/renderer/components/sidebar/DisplayMenu'
import { FilterMenu } from '../../../../../src/renderer/components/sidebar/FilterMenu'
import type { SessionView } from '../../../../../src/renderer/sidebar/view-model'

const VIEW: SessionView = {
  id: 'all',
  name: 'All',
  groupBy: 'workspace',
  sortBy: 'recent',
  filters: {},
}

// The sidebar clips its overflow, so a panel positioned inside it is cut off at
// the sidebar's right edge; it must be placed against the viewport instead.
describe('sidebar menus', () => {
  it('Display opens a viewport-fixed panel', () => {
    render(<DisplayMenu view={VIEW} onChangeView={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Display' }))
    expect(screen.getByRole('menu').style.position).toBe('fixed')
  })

  it('Filter opens a viewport-fixed panel', () => {
    render(
      <FilterMenu
        views={[VIEW]}
        activeViewId="all"
        onSelectView={vi.fn()}
        onChangeView={vi.fn()}
        hideStaleUnavailable={false}
        shown={1}
        total={1}
        onShowAll={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    expect(screen.getByRole('menu').style.position).toBe('fixed')
  })
})

function renderFilter(onChangeView = vi.fn(), activeViewId = 'all'): void {
  render(
    <FilterMenu
      views={[{ ...VIEW, filters: { query: 'api' } }]}
      activeViewId={activeViewId}
      onSelectView={vi.fn()}
      onChangeView={onChangeView}
      hideStaleUnavailable={false}
      shown={1}
      total={1}
      onShowAll={vi.fn()}
    />
  )
  fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
}

describe('sidebar menus — Hide stale', () => {
  it('turns the toggle on, keeping the active view’s other filters', () => {
    const onChangeView = vi.fn()
    renderFilter(onChangeView)
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Hide stale' }))
    expect(onChangeView).toHaveBeenCalledWith({ filters: { query: 'api', hideStale: true } })
  })

  it('falls back to the first view when the active id is unknown', () => {
    const onChangeView = vi.fn()
    renderFilter(onChangeView, 'gone')
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Hide stale' }))
    expect(onChangeView).toHaveBeenCalledWith({ filters: { query: 'api', hideStale: true } })
  })
})
