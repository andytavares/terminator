import React from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { StatusDot, type StatusTone } from '../src/StatusDot'
import { inLight } from './in-light'

const TONES: StatusTone[] = ['waiting', 'working', 'good', 'bad', 'muted']

const meta = {
  title: 'Components/StatusDot',
  component: StatusDot,
  args: { tone: 'waiting', label: 'Waiting for you' },
} satisfies Meta<typeof StatusDot>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('img', { name: 'Waiting for you' })).toBeTruthy()
  },
}
export const DefaultLight = inLight(Default)

export const EveryTone: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 12 }}>
      {TONES.map((tone) => (
        <StatusDot key={tone} tone={tone} label={tone} />
      ))}
    </div>
  ),
}
export const EveryToneLight = inLight(EveryTone)

export const WithRing: Story = { args: { tone: 'working', pulse: true, label: 'Working' } }
export const WithRingLight = inLight(WithRing)
