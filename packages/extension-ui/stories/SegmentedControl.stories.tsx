import React, { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { SegmentedControl, type SegmentedOption } from '../src/SegmentedControl'
import { inLight } from './in-light'

const KINDS: SegmentedOption<string>[] = [
  { value: 'note', label: 'Note' },
  { value: 'diagram', label: 'Diagram' },
  { value: 'folder', label: 'Folder' },
]

const WITH_DISABLED: SegmentedOption<string>[] = [
  { value: '30d', label: '30 days' },
  { value: 'all', label: 'All time' },
  { value: 'year', label: 'This year', disabled: true },
]

function ControlledSegmentedControl({
  options,
  initial,
  size,
}: {
  options: SegmentedOption<string>[]
  initial: string
  size?: 'sm' | 'md'
}): React.JSX.Element {
  const [value, setValue] = useState(initial)
  return (
    <SegmentedControl
      label="Kind"
      options={options}
      value={value}
      onChange={setValue}
      size={size}
    />
  )
}

const meta = {
  title: 'Components/SegmentedControl',
  component: SegmentedControl,
  args: { label: 'Kind', options: KINDS, value: 'note', onChange: () => {} },
  render: () => <ControlledSegmentedControl options={KINDS} initial="note" />,
} satisfies Meta<typeof SegmentedControl>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const DefaultLight = inLight(Default)

export const Small: Story = {
  render: () => <ControlledSegmentedControl options={KINDS} initial="diagram" size="sm" />,
}
export const SmallLight = inLight(Small)

export const WithDisabledOption: Story = {
  render: () => <ControlledSegmentedControl options={WITH_DISABLED} initial="30d" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('radio', { name: 'This year' })).toBeDisabled()
  },
}
export const WithDisabledOptionLight = inLight(WithDisabledOption)

export const ArrowKeysMoveTheChoice: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    canvas.getByRole('radio', { name: 'Note' }).focus()
    await userEvent.keyboard('{ArrowRight}')
    await expect(canvas.getByRole('radio', { name: 'Diagram' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    await expect(canvas.getByRole('radio', { name: 'Diagram' })).toHaveFocus()
  },
}
