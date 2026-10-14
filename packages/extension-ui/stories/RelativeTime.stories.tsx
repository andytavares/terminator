import React from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { RelativeTime } from '../src/RelativeTime'
import { inLight } from './in-light'

const NOW = Date.UTC(2026, 9, 12, 12, 0, 0)
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const meta = {
  title: 'Components/RelativeTime',
  component: RelativeTime,
  args: { value: NOW - 5 * MINUTE, now: NOW },
} satisfies Meta<typeof RelativeTime>

export default meta
type Story = StoryObj<typeof meta>

export const MinutesAgo: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('5 minutes ago')).toBeInTheDocument()
  },
}

export const HoursAgo: Story = { args: { value: NOW - 3 * HOUR } }
export const Yesterday: Story = { args: { value: NOW - DAY } }
export const InTheFuture: Story = { args: { value: NOW + 2 * HOUR } }

export const EveryUnit: Story = {
  render: () => (
    <ul style={{ margin: 0, paddingLeft: 'var(--tm-space-4)' }}>
      {[30 * 1000, 5 * MINUTE, 3 * HOUR, 3 * DAY, 14 * DAY, 90 * DAY, 800 * DAY].map((age) => (
        <li key={age}>
          <RelativeTime value={NOW - age} now={NOW} />
        </li>
      ))}
    </ul>
  ),
}

export const MinutesAgoLight = inLight(MinutesAgo)
export const InTheFutureLight = inLight(InTheFuture)
export const EveryUnitLight = inLight(EveryUnit)
