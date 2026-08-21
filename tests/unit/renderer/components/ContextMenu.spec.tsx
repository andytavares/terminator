import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { ContextMenu, closeAllContextMenus } from '../../../../src/renderer/components/ContextMenu'

let onDismiss: ReturnType<typeof vi.fn>

const items = [
  { label: 'Rename', onSelect: vi.fn() },
  { label: 'Move to project', onSelect: vi.fn() },
  { label: 'Close', onSelect: vi.fn(), danger: true, separatorBefore: true },
]

beforeEach(() => {
  vi.clearAllMocks()
  onDismiss = vi.fn()
})

describe('ContextMenu', () => {
  it('positions itself at the given coordinates', () => {
    const { container } = render(<ContextMenu x={12} y={34} items={items} onDismiss={onDismiss} />)
    const menu = container.querySelector('.ctx-menu') as HTMLElement
    expect(menu.style.left).toBe('12px')
    expect(menu.style.top).toBe('34px')
  })

  it('renders one item per entry', () => {
    render(<ContextMenu x={0} y={0} items={items} onDismiss={onDismiss} />)
    expect(screen.getAllByRole('button')).toHaveLength(3)
  })

  it('invokes onSelect when an item is clicked', () => {
    render(<ContextMenu x={0} y={0} items={items} onDismiss={onDismiss} />)
    fireEvent.click(screen.getByText('Rename'))
    expect(items[0].onSelect).toHaveBeenCalledOnce()
  })

  it('marks danger items with the danger modifier', () => {
    const { container } = render(<ContextMenu x={0} y={0} items={items} onDismiss={onDismiss} />)
    expect(container.querySelectorAll('.ctx-menu__item--danger')).toHaveLength(1)
  })

  it('renders a separator before an item that asks for one', () => {
    const { container } = render(<ContextMenu x={0} y={0} items={items} onDismiss={onDismiss} />)
    expect(container.querySelectorAll('.ctx-menu__separator')).toHaveLength(1)
  })

  it('dismisses on an outside click', () => {
    render(<ContextMenu x={0} y={0} items={items} onDismiss={onDismiss} />)
    fireEvent.click(window)
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('does not dismiss when the menu itself is clicked', () => {
    const { container } = render(<ContextMenu x={0} y={0} items={items} onDismiss={onDismiss} />)
    fireEvent.click(container.querySelector('.ctx-menu')!)
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('dismisses when another menu broadcasts close-context-menus', () => {
    render(<ContextMenu x={0} y={0} items={items} onDismiss={onDismiss} />)
    act(() => closeAllContextMenus())
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('stops listening once unmounted', () => {
    const { unmount } = render(<ContextMenu x={0} y={0} items={items} onDismiss={onDismiss} />)
    unmount()
    fireEvent.click(window)
    act(() => closeAllContextMenus())
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('closeAllContextMenus dispatches the coordination event', () => {
    const handler = vi.fn()
    window.addEventListener('close-context-menus', handler)
    closeAllContextMenus()
    window.removeEventListener('close-context-menus', handler)
    expect(handler).toHaveBeenCalledOnce()
  })
})
