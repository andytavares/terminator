import React from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { Check, Trash2 } from 'lucide-react'
import { Button, type ButtonVariant } from '../src/Button'
import { inLight } from './in-light'

const meta = {
  title: 'Components/Button',
  component: Button,
  args: { children: 'Save brief', onClick: fn() },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

const VARIANTS: ButtonVariant[] = ['primary', 'secondary', 'ghost', 'danger']

export const Primary: Story = { args: { variant: 'primary' } }
export const Secondary: Story = { args: { variant: 'secondary' } }
export const Ghost: Story = { args: { variant: 'ghost' } }
export const Danger: Story = { args: { variant: 'danger', children: 'Delete note' } }
export const Small: Story = { args: { variant: 'secondary', size: 'sm' } }
export const WithIcon: Story = { args: { variant: 'primary', icon: Check, children: 'Done' } }
export const DangerWithIcon: Story = {
  args: { variant: 'danger', icon: Trash2, children: 'Delete note' },
}

export const Disabled: Story = {
  args: { variant: 'primary', disabled: true },
  play: async ({ canvasElement, args }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Save brief' })
    await userEvent.click(button)
    await expect(button).toBeDisabled()
    await expect(args.onClick).not.toHaveBeenCalled()
  },
}

export const Pressed: Story = {
  args: { variant: 'primary' },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Save brief' }))
    await expect(args.onClick).toHaveBeenCalledTimes(1)
  },
}

export const EveryVariantAndSize: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 'var(--tm-space-3)' }}>
      {(['md', 'sm'] as const).map((size) => (
        <div key={size} style={{ display: 'flex', gap: 'var(--tm-space-3)' }}>
          {VARIANTS.map((variant) => (
            <React.Fragment key={variant}>
              <Button variant={variant} size={size}>
                {variant}
              </Button>
              <Button variant={variant} size={size} disabled>
                {variant}
              </Button>
            </React.Fragment>
          ))}
        </div>
      ))}
    </div>
  ),
}

export const PrimaryLight = inLight(Primary)
export const SecondaryLight = inLight(Secondary)
export const GhostLight = inLight(Ghost)
export const DangerLight = inLight(Danger)
export const SmallLight = inLight(Small)
export const WithIconLight = inLight(WithIcon)
export const DisabledLight = inLight(Disabled)
export const EveryVariantAndSizeLight = inLight(EveryVariantAndSize)
