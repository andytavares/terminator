import React from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { Menu, MenuItem } from '../src/Menu'
import { Button } from '../src/Button'
import { inLight } from './in-light'

const meta = {
  title: 'Components/Menu',
  component: Menu,
  args: {
    label: 'Branch actions',
    onDismiss: fn(),
    children: (
      <>
        <MenuItem onSelect={fn()}>Rename</MenuItem>
        <MenuItem onSelect={fn()}>Move to repo</MenuItem>
        <MenuItem danger onSelect={fn()}>
          Delete
        </MenuItem>
      </>
    ),
  },
  decorators: [
    (Story) => (
      <div style={{ height: 200 }}>
        <div style={{ display: 'inline-block' }}>
          <Button variant="secondary">Branch</Button>
          <Story />
        </div>
      </div>
    ),
  ],
} satisfies Meta<typeof Menu>

export default meta
type Story = StoryObj<typeof meta>

const item = (canvasElement: HTMLElement, name: string): HTMLElement =>
  within(canvasElement).getByRole('menuitem', { name })

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const menu = within(canvasElement).getByRole('menu', { name: 'Branch actions' })
    await expect(menu.matches(':popover-open')).toBe(true)
    await expect(item(canvasElement, 'Rename')).toHaveFocus()
  },
}

export const ArrowKeysMoveBetweenItems: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.keyboard('{ArrowDown}')
    await expect(item(canvasElement, 'Move to repo')).toHaveFocus()
    await userEvent.keyboard('{End}')
    await expect(item(canvasElement, 'Delete')).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    await expect(item(canvasElement, 'Rename')).toHaveFocus()
    await userEvent.keyboard('{ArrowUp}')
    await expect(item(canvasElement, 'Delete')).toHaveFocus()
    await userEvent.keyboard('{Home}')
    await expect(item(canvasElement, 'Rename')).toHaveFocus()
  },
}

export const EnterAndSpaceActivate: Story = {
  args: {
    children: (
      <>
        <MenuItem onSelect={() => (window as { picked?: string[] }).picked?.push('rename')}>
          Rename
        </MenuItem>
        <MenuItem onSelect={() => (window as { picked?: string[] }).picked?.push('move')}>
          Move to repo
        </MenuItem>
      </>
    ),
  },
  play: async () => {
    const picked: string[] = ((window as { picked?: string[] }).picked = [])
    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard('{ArrowDown} ')
    await expect(picked).toEqual(['rename', 'move'])
  },
}

/** Opened at a point, as a context menu is. */
export const AtAPoint: Story = {
  args: { at: { x: 240, y: 120 } },
  play: async ({ canvasElement }) => {
    const box = within(canvasElement).getByRole('menu').getBoundingClientRect()
    await expect(Math.round(box.left)).toBe(240)
    await expect(Math.round(box.top)).toBe(120)
  },
}

export const DefaultLight = inLight(Default)
export const AtAPointLight = inLight(AtAPoint)

function ContextRow(): JSX.Element {
  const [at, setAt] = React.useState<{ x: number; y: number } | null>(null)
  return (
    <div
      role="button"
      tabIndex={0}
      onContextMenu={(event) => {
        event.preventDefault()
        setAt({ x: event.clientX, y: event.clientY })
      }}
      style={{ padding: 24, width: 240 }}
    >
      Right-click me
      {at && (
        <Menu label="Row actions" at={at} onDismiss={() => setAt(null)}>
          <MenuItem onSelect={() => setAt(null)}>Rename</MenuItem>
        </Menu>
      )}
    </div>
  )
}

/** The menu a right click opens while the button is still down: see visual/popover.visual.ts. */
export const ContextMenuOpenedByRightClick: Story = {
  render: () => <ContextRow />,
}
