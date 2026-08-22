import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ViewBar } from '../../../../src/renderer/components/sidebar/ViewBar'
import { BUILT_IN_VIEWS } from '../../../../src/renderer/sidebar/views'
import type { SessionView } from '../../../../src/renderer/sidebar/view-model'

const custom: SessionView = {
  id: 'mine',
  name: 'Mine',
  groupBy: 'status',
  sortBy: 'recent',
  filters: {},
}

let props: React.ComponentProps<typeof ViewBar>

beforeEach(() => {
  props = {
    views: [...BUILT_IN_VIEWS, custom],
    activeViewId: 'everything',
    onSelectView: vi.fn(),
    onChangeView: vi.fn(),
    onSaveAsNew: vi.fn(),
    onDeleteView: vi.fn(),
    hideStaleUnavailable: false,
  }
})

const renderBar = (patch: Partial<typeof props> = {}) => render(<ViewBar {...props} {...patch} />)

describe('ViewBar — saved views', () => {
  it('renders a chip for every view', () => {
    renderBar()
    for (const name of ['Everything', 'Needs me', 'Active', 'Stale', 'Mine']) {
      expect(screen.getByText(name)).toBeTruthy()
    }
  })

  it('marks the active view', () => {
    const { container } = renderBar()
    expect(container.querySelectorAll('.view-bar__chip--active')).toHaveLength(1)
    expect(container.querySelector('.view-bar__chip--active')!.textContent).toBe('Everything')
  })

  it('switches views in one click', () => {
    renderBar()
    fireEvent.click(screen.getByText('Needs me'))
    expect(props.onSelectView).toHaveBeenCalledWith('needs-me')
  })

  it('deletes a custom view from its context menu', () => {
    renderBar()
    fireEvent.contextMenu(screen.getByText('Mine'))
    expect(props.onDeleteView).toHaveBeenCalledWith('mine')
  })

  it('refuses to delete a built-in view', () => {
    renderBar()
    fireEvent.contextMenu(screen.getByText('Everything'))
    expect(props.onDeleteView).not.toHaveBeenCalled()
  })

  it('saves the current view under a new name', () => {
    const { container } = renderBar()
    fireEvent.click(screen.getByTitle('Save current view'))
    const input = container.querySelector('.view-bar__name-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Deploys' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(props.onSaveAsNew).toHaveBeenCalledWith('Deploys')
  })

  it('abandons the save on Escape', () => {
    const { container } = renderBar()
    fireEvent.click(screen.getByTitle('Save current view'))
    fireEvent.keyDown(container.querySelector('.view-bar__name-input')!, { key: 'Escape' })
    expect(props.onSaveAsNew).not.toHaveBeenCalled()
  })

  it('ignores a blank view name', () => {
    const { container } = renderBar()
    fireEvent.click(screen.getByTitle('Save current view'))
    const input = container.querySelector('.view-bar__name-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.blur(input)
    expect(props.onSaveAsNew).not.toHaveBeenCalled()
  })

  it('caps a view name at 40 characters', () => {
    const { container } = renderBar()
    fireEvent.click(screen.getByTitle('Save current view'))
    const input = container.querySelector('.view-bar__name-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'x'.repeat(60) } })
    fireEvent.blur(input)
    expect(props.onSaveAsNew.mock.calls[0][0]).toHaveLength(40)
  })
})

describe('ViewBar — grouping and sort', () => {
  it('shows the active grouping and sort', () => {
    renderBar()
    expect(screen.getByText('Group: Project')).toBeTruthy()
    expect(screen.getByText('Sort: Manual')).toBeTruthy()
  })

  it('offers every grouping key (FR-010)', () => {
    renderBar()
    fireEvent.click(screen.getByText('Group: Project'))
    for (const label of ['Project', 'Workspace', 'Status', 'Branch', 'None']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
  })

  it('offers every sort key (FR-011)', () => {
    renderBar()
    fireEvent.click(screen.getByText('Sort: Manual'))
    for (const label of ['Recent', 'Oldest', 'Name', 'Status', 'Manual']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
  })

  it('changes the grouping of the active view', () => {
    renderBar()
    fireEvent.click(screen.getByText('Group: Project'))
    fireEvent.click(screen.getByText('Branch'))
    expect(props.onChangeView).toHaveBeenCalledWith({ groupBy: 'branch' })
  })

  it('changes the sort of the active view', () => {
    renderBar()
    fireEvent.click(screen.getByText('Sort: Manual'))
    fireEvent.click(screen.getByText('Oldest'))
    expect(props.onChangeView).toHaveBeenCalledWith({ sortBy: 'oldest' })
  })

  it('closes the menu on an outside click, like every other menu in the app', () => {
    const { container } = renderBar()
    fireEvent.click(screen.getByText('Group: Project'))
    expect(container.querySelector('.view-bar__menu')).toBeTruthy()
    fireEvent.click(window)
    expect(container.querySelector('.view-bar__menu')).toBeNull()
  })

  it('does not close when the menu itself is clicked', () => {
    const { container } = renderBar()
    fireEvent.click(screen.getByText('Sort: Manual'))
    fireEvent.click(container.querySelector('.view-bar__menu')!)
    expect(container.querySelector('.view-bar__menu')).toBeTruthy()
  })

  it('closes an open menu when another context menu broadcasts a close', () => {
    const { container } = renderBar()
    fireEvent.click(screen.getByText('Group: Project'))
    fireEvent(window, new CustomEvent('close-context-menus'))
    expect(container.querySelector('.view-bar__menu')).toBeNull()
  })

  it('stops listening once unmounted', () => {
    const { unmount } = renderBar()
    fireEvent.click(screen.getByText('Group: Project'))
    unmount()
    expect(() => fireEvent.click(window)).not.toThrow()
  })

  it('closes the menu when the same control is clicked again', () => {
    const { container } = renderBar()
    fireEvent.click(screen.getByText('Group: Project'))
    fireEvent.click(screen.getByText('Group: Project'))
    expect(container.querySelector('.view-bar__menu')).toBeNull()
  })
})

describe('ViewBar — hide stale (FR-021)', () => {
  it('offers the toggle on an ordinary view', () => {
    renderBar()
    expect(screen.getByText('Hide stale')).toBeTruthy()
  })

  it('turns hide-stale on for the active view', () => {
    renderBar()
    fireEvent.click(screen.getByLabelText('Hide stale'))
    expect(props.onChangeView).toHaveBeenCalledWith({ filters: { hideStale: true } })
  })

  it('reflects hide-stale already being on', () => {
    const on = { ...BUILT_IN_VIEWS[0], filters: { hideStale: true } }
    renderBar({ views: [on], activeViewId: on.id })
    expect((screen.getByLabelText('Hide stale') as HTMLInputElement).checked).toBe(true)
  })

  it('hides the toggle on the Stale view, where it would contradict itself', () => {
    renderBar({ activeViewId: 'stale', hideStaleUnavailable: true })
    expect(screen.queryByText('Hide stale')).toBeNull()
  })

  it('falls back to the first view when the active id is unknown', () => {
    renderBar({ activeViewId: 'gone' })
    expect(screen.getByText('Group: Project')).toBeTruthy()
  })
})
