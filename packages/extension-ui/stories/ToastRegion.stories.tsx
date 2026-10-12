import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { ToastRegion, type ToastItem } from '../src/Toast'
import { inLight } from './in-light'

// Zero keeps each toast up; the default timers would dismiss them mid-test.
const toasts: ToastItem[] = [
  { id: 'info', tone: 'info', message: 'Brief saved.', duration: 0 },
  { id: 'success', tone: 'success', message: 'Pushed 3 commits.', duration: 0 },
  { id: 'warning', tone: 'warning', message: 'The branch is behind main.', duration: 0 },
  { id: 'error', tone: 'error', message: 'Push failed: permission denied.', duration: 0 },
]

const meta = {
  title: 'Components/ToastRegion',
  component: ToastRegion,
  args: { toasts, onDismiss: fn() },
} satisfies Meta<typeof ToastRegion>

export default meta
type Story = StoryObj<typeof meta>

export const EveryTone: Story = {}

export const WithAction: Story = {
  args: {
    toasts: [
      {
        id: 'undo',
        message: 'Note deleted.',
        duration: 0,
        action: { label: 'Undo', onSelect: fn() },
      },
    ],
  },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Undo' }))
    await expect(args.toasts[0].action?.onSelect).toHaveBeenCalledTimes(1)
  },
}

export const DismissReportsWhichToast: Story = {
  play: async ({ canvasElement, args }) => {
    const first = within(canvasElement).getAllByRole('button', { name: 'Dismiss' })[0]
    await userEvent.click(first)
    await expect(args.onDismiss).toHaveBeenCalledWith('info')
  },
}

export const Empty: Story = { args: { toasts: [] } }

export const EveryToneLight = inLight(EveryTone)
export const WithActionLight = inLight(WithAction)
