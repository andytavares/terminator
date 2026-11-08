import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
  it('renders one item per entry', () => {
    render(<ContextMenu x={0} y={0} items={items} onDismiss={onDismiss} />)
    expect(screen.getAllByRole('menuitem')).toHaveLength(3)
  })

  it('invokes onSelect when an item is clicked', async () => {
    const user = userEvent.setup()
    render(<ContextMenu x={0} y={0} items={items} onDismiss={onDismiss} />)
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }))
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
  it('does not hand Enter on an item to the row that opened it', async () => {
    const user = userEvent.setup()
    const rowKeyDown = vi.fn()
    render(
      <div onKeyDown={rowKeyDown}>
        <ContextMenu x={0} y={0} items={items} onDismiss={onDismiss} />
      </div>
    )
    const rename = screen.getByRole('menuitem', { name: 'Rename' })
    rename.focus()
    expect(document.activeElement).toBe(rename)
    await user.keyboard('{Enter}')
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
