import React, { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { Tabs, type TabItem } from '../src/Tabs'
import { inLight } from './in-light'

const TABS: TabItem[] = [
  { id: 'files', label: 'Files', panel: <p>Seven files changed.</p> },
  { id: 'checks', label: 'Checks', panel: <p>All checks passed.</p> },
  { id: 'notes', label: 'Notes', panel: <p>No notes.</p>, disabled: true },
  { id: 'history', label: 'History', panel: <p>Three commits.</p> },
]

function Controlled({ tabs, initial }: { tabs: TabItem[]; initial: string }): JSX.Element {
  const [selectedId, setSelectedId] = useState(initial)
  return (
    <Tabs
      label="Pull request sections"
      tabs={tabs}
      selectedId={selectedId}
      onSelect={setSelectedId}
    />
  )
}

const meta = {
  title: 'Components/Tabs',
  component: Tabs,
  args: { label: 'Pull request sections', tabs: TABS, selectedId: 'files', onSelect: () => {} },
  render: () => <Controlled tabs={TABS} initial="files" />,
} satisfies Meta<typeof Tabs>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const SecondSelected: Story = {
  render: () => <Controlled tabs={TABS} initial="checks" />,
}

export const WithDisabledTab: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('tab', { name: 'Notes' })).toBeDisabled()
  },
}

export const ArrowKeysMoveSelection: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    canvas.getByRole('tab', { name: 'Files' }).focus()
    await userEvent.keyboard('{ArrowRight}')
    await expect(canvas.getByRole('tab', { name: 'Checks' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await expect(canvas.getByRole('tabpanel')).toHaveTextContent('All checks passed.')
    await userEvent.keyboard('{ArrowRight}')
    await expect(canvas.getByRole('tab', { name: 'History' })).toHaveFocus()
  },
}

export const DefaultLight = inLight(Default)
export const SecondSelectedLight = inLight(SecondSelected)
export const WithDisabledTabLight = inLight(WithDisabledTab)
