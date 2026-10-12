import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { List, X } from 'lucide-react'
import { IconButton } from '../src/IconButton'
import { inLight } from './in-light'

const meta = {
  title: 'Components/IconButton',
  component: IconButton,
  args: { icon: List, label: 'List view', onClick: fn() },
} satisfies Meta<typeof IconButton>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Pressed: Story = { args: { pressed: true } }
export const NotPressed: Story = { args: { pressed: false } }

export const NamedForAssistiveTechnology: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'List view' }))
    await expect(args.onClick).toHaveBeenCalledTimes(1)
  },
}

export const Small: Story = { args: { size: 'sm', icon: X, label: 'Remove tag' } }
export const Disabled: Story = {
  args: { disabled: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: 'List view' })).toBeDisabled()
  },
}

export const DefaultLight = inLight(Default)
export const PressedLight = inLight(Pressed)
export const NotPressedLight = inLight(NotPressed)
export const SmallLight = inLight(Small)
export const DisabledLight = inLight(Disabled)
