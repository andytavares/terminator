import React from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent } from 'storybook/test'
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

export const EscapeDismisses: Story = {
  play: async ({ args }) => {
    await userEvent.keyboard('{Escape}')
    await expect(args.onDismiss).toHaveBeenCalledTimes(1)
  },
}

export const DefaultLight = inLight(Default)
export const EscapeDismissesLight = inLight(EscapeDismisses)
