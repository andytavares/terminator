import React from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { Sparkline } from '../src/Sparkline'
import { inLight } from './in-light'

const meta = {
  title: 'Components/Sparkline',
  component: Sparkline,
  args: { values: [34, 30, 36, 22, 26, 18, 24, 14, 10], label: 'Merged per week' },
  decorators: [
    (Story) => (
      <div style={{ width: 240 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Sparkline>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('img', { name: 'Merged per week' })).toBeTruthy()
  },
}
export const DefaultLight = inLight(Default)

export const Small: Story = { args: { size: 'sm' } }
export const SmallLight = inLight(Small)

export const EveryTone: Story = {
  render: (args) => (
    <div style={{ display: 'grid', gap: 12 }}>
      <Sparkline {...args} tone="accent" />
      <Sparkline {...args} tone="info" />
      <Sparkline {...args} tone="warning" />
      <Sparkline {...args} tone="good" />
    </div>
  ),
}
export const EveryToneLight = inLight(EveryTone)
