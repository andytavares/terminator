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
