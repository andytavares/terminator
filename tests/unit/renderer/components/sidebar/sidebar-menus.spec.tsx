import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
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

// The sidebar clips its overflow, so a panel drawn inside it is cut off at the sidebar's right
// edge; a popover is in the top layer, which no ancestor clips.
const recordUse = vi.hoisted(() => vi.fn())
vi.mock('../../../../../src/renderer/usage/record', () => ({ recordUse }))
beforeEach(() => recordUse.mockClear())

describe('sidebar menus', () => {
  it('Display opens its panel in the top layer', () => {
    render(<DisplayMenu view={VIEW} onChangeView={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Display' }))
    expect(screen.getByRole('menu').matches(':popover-open')).toBe(true)
  })

  it('Filter opens its panel in the top layer', () => {
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
    expect(screen.getByRole('menu').matches(':popover-open')).toBe(true)
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
