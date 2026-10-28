import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Menu, MenuItem } from '../../../../packages/extension-ui/src/Menu'

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
    expect(screen.getByRole('menu', { name: 'Actions' })).toBeTruthy()
    expect(names()).toEqual(['Rename', 'Move', 'Delete'])
  })

  it('opens on its first item', () => {
    renderMenu()
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Rename' }))
  })
})

describe('Menu — keys', () => {
  it('moves down and up with the arrow keys, wrapping at both ends', async () => {
    renderMenu()
    const user = userEvent.setup()
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Move' }))
    await user.keyboard('{ArrowUp}{ArrowUp}')
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Delete' }))
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Rename' }))
  })

  it('jumps to the first and last item with Home and End', async () => {
    renderMenu()
    const user = userEvent.setup()
    await user.keyboard('{End}')
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Delete' }))
    await user.keyboard('{Home}')
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Rename' }))
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
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Filter' }))
    await userEvent.setup().keyboard('{ArrowUp}')
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Three' }))
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

  it('closes on Escape and on a click outside', () => {
    const { onDismiss } = renderMenu()
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(document.body)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

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
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Three' }))
  })
})
