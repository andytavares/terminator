import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
  it('Display opens its panel in the top layer', async () => {
    const user = userEvent.setup()
    render(<DisplayMenu view={VIEW} onChangeView={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Display' }))
    expect(screen.getByRole('menu').matches(':popover-open')).toBe(true)
  })

  it('Filter opens its panel in the top layer', async () => {
    const user = userEvent.setup()
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
    await user.click(screen.getByRole('button', { name: 'Filter' }))
    expect(screen.getByRole('menu').matches(':popover-open')).toBe(true)
  })
})

async function renderFilter(onChangeView = vi.fn()): Promise<void> {
  render(
    <FilterMenu
      views={[{ ...VIEW, filters: { query: 'api' } }]}
      activeViewId="all"
      onSelectView={vi.fn()}
      onChangeView={onChangeView}
      hideStaleUnavailable={false}
      shown={1}
      total={1}
      onShowAll={vi.fn()}
    />
  )
  await userEvent.setup().click(screen.getByRole('button', { name: 'Filter' }))
}

describe('sidebar menus — Hide stale', () => {
  it('turns the toggle on, keeping the active view’s other filters', async () => {
    const user = userEvent.setup()
    const onChangeView = vi.fn()
    await renderFilter(onChangeView)
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Hide stale' }))
    expect(onChangeView).toHaveBeenCalledWith({ filters: { query: 'api', hideStale: true } })
  })
})
