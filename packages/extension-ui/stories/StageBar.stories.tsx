import React from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { StageBar } from '../src/StageBar'
import { inLight } from './in-light'

const meta = {
  title: 'Components/StageBar',
  component: StageBar,
  args: { stage: 'in-review', caption: 'Waiting on your review' },
  decorators: [
    (Story) => (
      <div style={{ width: 360 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof StageBar>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const current = within(canvasElement).getByText('In review').closest('li')
    await expect(current?.getAttribute('aria-current')).toBe('step')
  },
}
export const DefaultLight = inLight(Default)

export const YourMove: Story = { args: { yourMove: true } }
export const YourMoveLight = inLight(YourMove)

export const Large: Story = { args: { size: 'large', caption: undefined } }
export const LargeLight = inLight(Large)
