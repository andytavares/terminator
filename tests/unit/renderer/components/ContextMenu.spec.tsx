import React from 'react'
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { ContextMenu, closeAllContextMenus } from '../../../../src/renderer/components/ContextMenu'

let onDismiss: Mock<() => void>

const items = [
  { label: 'Rename', onSelect: vi.fn() },
  { label: 'Move to branch', onSelect: vi.fn() },
  { label: 'Close', onSelect: vi.fn(), danger: true, separatorBefore: true },
]

beforeEach(() => {
  vi.clearAllMocks()
  onDismiss = vi.fn()
})

describe('ContextMenu', () => {
  it('positions itself at the given coordinates', () => {
    render(<ContextMenu x={12} y={34} items={items} onDismiss={onDismiss} />)
    const menu = document.querySelector('.ctx-menu') as HTMLElement
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
    render(<ContextMenu x={0} y={0} items={items} onDismiss={onDismiss} />)
    expect(document.querySelectorAll('.ctx-menu__item--danger')).toHaveLength(1)
  })

  it('renders a separator before an item that asks for one', () => {
    render(<ContextMenu x={0} y={0} items={items} onDismiss={onDismiss} />)
    expect(document.querySelectorAll('.ctx-menu__separator')).toHaveLength(1)
  })
})

describe('ContextMenu — dismisses on an outside click', () => {
  it('dismisses on an outside click', () => {
    render(<ContextMenu x={0} y={0} items={items} onDismiss={onDismiss} />)
    fireEvent.click(window)
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('does not dismiss when the menu itself is clicked', () => {
    render(<ContextMenu x={0} y={0} items={items} onDismiss={onDismiss} />)
    fireEvent.click(document.querySelector('.ctx-menu')!)
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
})

describe('ContextMenu — closeAllContextMenus dispatches the coordination event', () => {
  it('closeAllContextMenus dispatches the coordination event', () => {
    const handler = vi.fn()
    window.addEventListener('close-context-menus', handler)
    closeAllContextMenus()
    window.removeEventListener('close-context-menus', handler)
    expect(handler).toHaveBeenCalledOnce()
  })
})

describe('ContextMenu — never clipped by what holds it', () => {
  it('draws in the document body, outside a contained, scrolling ancestor', () => {
    // Home's body sets container-type: size and overflow: auto, which trap and clip a fixed menu.
    const { container } = render(
      <div style={{ containerType: 'size', overflow: 'auto' }}>
        <ContextMenu x={0} y={0} items={items} onDismiss={onDismiss} />
      </div>
    )
    const menu = document.querySelector('.ctx-menu') as HTMLElement
    expect(container.contains(menu)).toBe(false)
    expect(menu.parentElement).toBe(document.body)
  })
})

describe('ContextMenu — stays on screen', () => {
  it('moves back inside the window when opened near the right and bottom edges', () => {
    const rect = { left: 980, top: 740, right: 1140, bottom: 860, width: 160, height: 120 }
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      ...rect,
      x: rect.left,
      y: rect.top,
      toJSON: () => rect,
    })
    vi.stubGlobal('innerWidth', 1024)
    vi.stubGlobal('innerHeight', 768)
    render(<ContextMenu x={980} y={740} items={items} onDismiss={onDismiss} />)
    const menu = document.querySelector('.ctx-menu') as HTMLElement
    expect(menu.style.marginLeft).toBe('-124px')
    expect(menu.style.marginTop).toBe('-100px')
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })
})
