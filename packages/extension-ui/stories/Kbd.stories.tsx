import React from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { Kbd } from '../src/Kbd'
import { inLight } from './in-light'

const meta = {
  title: 'Components/Kbd',
  component: Kbd,
  args: { children: '⌘P' },
} satisfies Meta<typeof Kbd>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('⌘P').tagName).toBe('KBD')
  },
}
export const DefaultLight = inLight(Default)

export const BesideALabel: Story = {
  render: () => (
    <span>
      Open Quick Actions <Kbd>⌘P</Kbd>
    </span>
  ),
}
