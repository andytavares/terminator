import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Menu, MenuItem } from '../../src/Menu'

// Focus return, the top layer and light dismiss are a browser's; the Menu stories prove them in
// Chromium. This asserts the roles and the keys.

function renderMenu(onSelect = vi.fn(), onDismiss = vi.fn()) {
  render(
    <Menu label="Actions" onDismiss={onDismiss}>
      <MenuItem onSelect={() => onSelect('rename')}>Rename</MenuItem>
      <MenuItem onSelect={() => onSelect('move')}>Move</MenuItem>
      <MenuItem danger onSelect={() => onSelect('delete')}>
        Delete
      </MenuItem>
    </Menu>
  )
  return { onSelect, onDismiss }
}

const names = () => screen.getAllByRole('menuitem').map((item) => item.textContent)

describe('Menu', () => {
  it('is a menu of menuitems', () => {
    renderMenu()
    expect(screen.getByRole('menu').getAttribute('aria-label')).toBe('Actions')
    expect(names()).toEqual(['Rename', 'Move', 'Delete'])
  })

  it('opens on its first item', () => {
    renderMenu()
    expect(screen.getByRole('menuitem', { name: 'Rename' }).matches(':focus')).toBe(true)
  })
})

describe('Menu — keys', () => {
  it('moves down and up with the arrow keys, wrapping at both ends', async () => {
    renderMenu()
    const user = userEvent.setup()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Move' }).matches(':focus')).toBe(true)
    await user.keyboard('{ArrowUp}{ArrowUp}')
    expect(screen.getByRole('menuitem', { name: 'Delete' }).matches(':focus')).toBe(true)
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Rename' }).matches(':focus')).toBe(true)
  })

  it('jumps to the first and last item with Home and End', async () => {
    renderMenu()
    const user = userEvent.setup()
    await user.keyboard('{End}')
    expect(screen.getByRole('menuitem', { name: 'Delete' }).matches(':focus')).toBe(true)
    await user.keyboard('{Home}')
    expect(screen.getByRole('menuitem', { name: 'Rename' }).matches(':focus')).toBe(true)
  })
})

describe('Menu — keys from outside the items', () => {
  it('moves up to the last item when focus is on no item', async () => {
    render(
      <Menu label="Actions" onDismiss={vi.fn()}>
        <input aria-label="Filter" />
        <button role="menuitem">One</button>
        <button role="menuitem">Two</button>
        <button role="menuitem">Three</button>
      </Menu>
    )
    expect(screen.getByRole('textbox', { name: 'Filter' }).matches(':focus')).toBe(true)
    await userEvent.setup().keyboard('{ArrowUp}')
    expect(screen.getByRole('menuitem', { name: 'Three' }).matches(':focus')).toBe(true)
  })
})

describe('Menu — activation and dismissal', () => {
  it('activates the focused item with Enter and with Space', async () => {
    const { onSelect } = renderMenu()
    const user = userEvent.setup()
    await user.keyboard('{ArrowDown}{Enter}')
    await user.keyboard('{ArrowDown} ')
    expect(onSelect.mock.calls).toEqual([['move'], ['delete']])
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    const { onDismiss } = renderMenu()
    await user.keyboard('{Escape}')
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('closes on a click outside it', async () => {
    const user = userEvent.setup()
    const { onDismiss } = renderMenu()
    await user.click(document.body)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})

describe('Menu — disabled items', () => {
  it('skips a disabled item', async () => {
    render(
      <Menu label="Actions" onDismiss={vi.fn()}>
        <button role="menuitem">One</button>
        <button role="menuitem" disabled>
          Two
        </button>
        <button role="menuitem">Three</button>
      </Menu>
    )
    await userEvent.setup().keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Three' }).matches(':focus')).toBe(true)
  })
})
