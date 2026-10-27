import React from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, within } from 'storybook/test'
import { Popover } from '../src/Popover'
import { Button } from '../src/Button'
import { inLight } from './in-light'

const meta = {
  title: 'Components/Popover',
  component: Popover,
  args: {
    label: 'Branch actions',
    onDismiss: fn(),
    children: (
      <div style={{ display: 'grid', gap: 'var(--tm-space-1)' }}>
        <Button variant="ghost" size="sm">
          Rename branch
        </Button>
        <Button variant="ghost" size="sm">
          Delete branch
        </Button>
      </div>
    ),
  },
  decorators: [
    (Story) => (
      <div style={{ position: 'relative', height: 200 }}>
        <Button variant="secondary">Branch</Button>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Popover>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

const surfaceIn = (canvasElement: HTMLElement): HTMLElement =>
  within(canvasElement).getByRole('group', { name: 'Branch actions' })

/** Open in the top layer, under the element it is rendered inside, left edges together. */
export const OpensUnderItsAnchor: Story = {
  play: async ({ canvasElement }) => {
    const surface = surfaceIn(canvasElement)
    await expect(surface.matches(':popover-open')).toBe(true)
    const anchor = surface.parentElement!.getBoundingClientRect()
    const box = surface.getBoundingClientRect()
    await expect(box.top).toBeGreaterThanOrEqual(anchor.bottom)
    await expect(Math.round(box.left)).toBe(Math.round(anchor.left))
  },
}

/** Focus moves in to the first control. Escape and an outside click are the browser's light
 * dismiss, driven with real keys in visual/popover.visual.ts. */
export const FocusMovesIn: Story = {
  play: async ({ canvasElement }) => {
    await expect(
      within(surfaceIn(canvasElement)).getByRole('button', { name: 'Rename branch' })
    ).toHaveFocus()
  },
}

export const DefaultLight = inLight(Default)
export const OpensUnderItsAnchorLight = inLight(OpensUnderItsAnchor)
