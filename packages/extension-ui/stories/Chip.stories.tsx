import React from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { Check, GitPullRequest } from 'lucide-react'
import { Chip } from '../src/Chip'
import { inLight } from './in-light'

const meta = {
  title: 'Components/Chip',
  component: Chip,
  args: { children: '3 files' },
} satisfies Meta<typeof Chip>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('3 files')).toBeTruthy()
  },
}
export const DefaultLight = inLight(Default)

export const EveryTone: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 8 }}>
      <Chip>Neutral</Chip>
      <Chip tone="good" icon={<Check />}>
        Checks passing
      </Chip>
      <Chip tone="bad">Failed</Chip>
      <Chip tone="waiting" icon={<GitPullRequest />}>
        Needs review
      </Chip>
    </div>
  ),
}
export const EveryToneLight = inLight(EveryTone)
