import React, { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { Checkbox } from '../src/Checkbox'
import { inLight } from './in-light'

function ControlledCheckbox({ initial }: { initial: boolean }): JSX.Element {
  const [checked, setChecked] = useState(initial)
  return <Checkbox checked={checked} label="Tests pass" onChange={setChecked} />
}

const meta = {
  title: 'Components/Checkbox',
  component: Checkbox,
  args: { checked: true, label: 'Tests pass' },
} satisfies Meta<typeof Checkbox>

export default meta
type Story = StoryObj<typeof meta>

export const Ticked: Story = {
  play: async ({ canvasElement }) => {
    const box = within(canvasElement).getByRole('checkbox', { name: 'Tests pass' })
    const outer = box.getBoundingClientRect()
    const tick = box.querySelector('svg')!.getBoundingClientRect()
    // The tick sits inside the box; an unsized icon spills out of it.
    await expect(tick.width).toBeLessThanOrEqual(outer.width)
    await expect(tick.height).toBeLessThanOrEqual(outer.height)
  },
}
export const TickedLight = inLight(Ticked)

export const Empty: Story = { args: { checked: false } }
export const EmptyLight = inLight(Empty)

export const PressToTick: Story = {
  render: () => <ControlledCheckbox initial={false} />,
  play: async ({ canvasElement }) => {
    const box = within(canvasElement).getByRole('checkbox', { name: 'Tests pass' })
    await userEvent.click(box)
    await expect(box).toHaveAttribute('aria-checked', 'true')
  },
}
