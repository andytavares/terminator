import React from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { MetricCard } from '../src/MetricCard'
import { Sparkline } from '../src/Sparkline'
import { inLight } from './in-light'

const meta = {
  title: 'Components/MetricCard',
  component: MetricCard,
  args: {
    question: 'Time in review',
    qualifier: 'median',
    value: '4.2',
    unit: 'h',
    sub: 'down 12% from last week',
  },
  decorators: [
    (Story) => (
      <div style={{ width: 280 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MetricCard>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('4.2')).toBeTruthy()
  },
}
export const DefaultLight = inLight(Default)

export const WithSparkline: Story = {
  render: (args) => (
    <MetricCard {...args}>
      <Sparkline values={[34, 30, 36, 22, 26, 18, 24, 14, 10]} />
    </MetricCard>
  ),
}
export const WithSparklineLight = inLight(WithSparkline)
