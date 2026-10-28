import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ContextMenu } from '../../../../src/renderer/components/ContextMenu'

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

// Here, not in a test body: a failed expect would otherwise leave the window size stubbed.
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
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
    expect(screen.getAllByRole('menuitem')).toHaveLength(3)
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

describe('ContextMenu — dismissal is the browser’s light dismiss', () => {
  it('dismisses on an outside click', () => {
    render(<ContextMenu x={0} y={0} items={items} onDismiss={onDismiss} />)
    fireEvent.click(document.body)
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('does not dismiss when the menu itself is clicked', () => {
    render(<ContextMenu x={0} y={0} items={items} onDismiss={onDismiss} />)
    fireEvent.click(document.querySelector('.ctx-menu')!)
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('dismisses on Escape', () => {
    render(<ContextMenu x={0} y={0} items={items} onDismiss={onDismiss} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('stops listening once unmounted', () => {
    const { unmount } = render(<ContextMenu x={0} y={0} items={items} onDismiss={onDismiss} />)
    unmount()
    fireEvent.click(document.body)
    expect(onDismiss).not.toHaveBeenCalled()
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
    expect(menu.closest('body > div')?.parentElement).toBe(document.body)
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
  })
})

/** A 160×120 menu box whose top-left corner sits at `left`, `top`. */
const menuBox = (left: number, top: number) => ({
  left,
  top,
  right: left + 160,
  bottom: top + 120,
  width: 160,
  height: 120,
  x: left,
  y: top,
  toJSON: () => ({}),
})

describe('ContextMenu — moved while open', () => {
  it('drops an earlier nudge once the new position fits', () => {
    const measure = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue(menuBox(980, 740))
    vi.stubGlobal('innerWidth', 1024)
    vi.stubGlobal('innerHeight', 768)
    const { rerender } = render(<ContextMenu x={980} y={740} items={items} onDismiss={onDismiss} />)
    measure.mockReturnValue(menuBox(100, 100))
    rerender(<ContextMenu x={100} y={100} items={items} onDismiss={onDismiss} />)
    const menu = document.querySelector('.ctx-menu') as HTMLElement
    expect(menu.style.marginLeft).toBe('')
    expect(menu.style.marginTop).toBe('')
  })
})

describe('ContextMenu — an item changed while open', () => {
  it('measures again, so a wider label cannot run past the edge', () => {
    const measure = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue(menuBox(800, 100))
    vi.stubGlobal('innerWidth', 1024)
    vi.stubGlobal('innerHeight', 768)
    const { rerender } = render(<ContextMenu x={800} y={100} items={items} onDismiss={onDismiss} />)
    measure.mockReturnValue({ ...menuBox(800, 100), right: 1100, width: 300 })
    const longer = [...items, { label: 'Open AUTH-1234 in Linear', onSelect: vi.fn() }]
    rerender(<ContextMenu x={800} y={100} items={longer} onDismiss={onDismiss} />)
    const menu = document.querySelector('.ctx-menu') as HTMLElement
    expect(menu.style.marginLeft).toBe('-84px')
  })
})

describe('ContextMenu — keys stay in the menu', () => {
  it('does not hand Enter on an item to the row that opened it', () => {
    const rowKeyDown = vi.fn()
    render(
      <div onKeyDown={rowKeyDown}>
        <ContextMenu x={0} y={0} items={items} onDismiss={onDismiss} />
      </div>
    )
    fireEvent.keyDown(screen.getByText('Rename'), { key: 'Enter' })
    expect(rowKeyDown).not.toHaveBeenCalled()
  })
})

describe('ContextMenu — moving', () => {
  it('reopens, rather than stays, when it moves to a new point', () => {
    const { rerender } = render(<ContextMenu x={12} y={34} items={items} onDismiss={onDismiss} />)
    const first = document.querySelector('.ctx-menu')
    rerender(<ContextMenu x={56} y={78} items={items} onDismiss={onDismiss} />)
    const moved = document.querySelector('.ctx-menu') as HTMLElement
    expect(moved).not.toBe(first)
    expect(moved.style.left).toBe('56px')
    expect(onDismiss).not.toHaveBeenCalled()
  })
})
