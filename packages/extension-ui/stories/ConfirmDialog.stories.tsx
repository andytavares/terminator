import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { ConfirmDialog } from '../src/ConfirmDialog'
import { inLight } from './in-light'

const meta = {
  title: 'Components/ConfirmDialog',
  component: ConfirmDialog,
  args: {
    title: 'Discard changes?',
    description: 'The edits in this note are not saved anywhere else.',
    confirmLabel: 'Discard',
    onConfirm: fn(),
    onClose: fn(),
  },
} satisfies Meta<typeof ConfirmDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Destructive: Story = { args: { danger: true } }
export const WithoutDescription: Story = { args: { description: undefined } }

export const ConfirmRuns: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Discard' }))
    await expect(args.onConfirm).toHaveBeenCalledTimes(1)
  },
}

export const CancelClosesWithoutConfirming: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Cancel' }))
    await expect(args.onClose).toHaveBeenCalledTimes(1)
    await expect(args.onConfirm).not.toHaveBeenCalled()
  },
}

export const DefaultLight = inLight(Default)
export const DestructiveLight = inLight(Destructive)
export const WithoutDescriptionLight = inLight(WithoutDescription)
