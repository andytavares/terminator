import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { FileText } from 'lucide-react'
import { EmptyState } from '../src/EmptyState'
import { inLight } from './in-light'

const meta = {
  title: 'Components/EmptyState',
  component: EmptyState,
  args: {
    heading: 'No notes yet',
    description: 'Capture your first note from anywhere in Terminator, even mid-command.',
    actions: [{ label: 'New note', tone: 'primary', onSelect: fn() }],
  },
} satisfies Meta<typeof EmptyState>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const WithIcon: Story = { args: { icon: FileText } }
export const WithHint: Story = { args: { icon: FileText, hint: 'Press ⌘N to start one.' } }

export const TwoActions: Story = {
  args: {
    actions: [
      { label: 'New note', tone: 'primary', onSelect: fn() },
      { label: 'Import notes', onSelect: fn() },
    ],
  },
}

export const ActionRuns: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'New note' }))
    await expect(args.actions[0].onSelect).toHaveBeenCalledTimes(1)
  },
}

export const DefaultLight = inLight(Default)
export const WithIconLight = inLight(WithIcon)
export const WithHintLight = inLight(WithHint)
export const TwoActionsLight = inLight(TwoActions)
