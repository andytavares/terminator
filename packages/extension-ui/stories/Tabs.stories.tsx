import React, { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { Button } from '../src/Button'
import { Tab, TabList, TabPanel, Tabs, TabsRoot, type TabItem } from '../src/Tabs'
import { inLight } from './in-light'

const TABS: TabItem[] = [
  { id: 'files', label: 'Files', panel: <p>Seven files changed.</p> },
  { id: 'checks', label: 'Checks', panel: <p>All checks passed.</p> },
  { id: 'notes', label: 'Notes', panel: <p>No notes.</p>, disabled: true },
  { id: 'history', label: 'History', panel: <p>Three commits.</p> },
]

function ControlledTabs({
  tabs,
  initial,
}: {
  tabs: TabItem[]
  initial: string
}): React.JSX.Element {
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
  render: () => <ControlledTabs tabs={TABS} initial="files" />,
} satisfies Meta<typeof Tabs>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const SecondSelected: Story = {
  render: () => <ControlledTabs tabs={TABS} initial="checks" />,
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

/** The parts: the list shares a toolbar row, a notice sits between it and the panel. */
function InToolbar({ initial }: { initial: string }): React.JSX.Element {
  const [selectedId, setSelectedId] = useState(initial)
  return (
    <TabsRoot selectedId={selectedId} onSelect={setSelectedId}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <TabList label="Dashboard sections">
          <Tab id="needs" accessibleName="Needs you, 3">
            Needs you<span className="tmui-tabs__count">3</span>
          </Tab>
          <Tab id="mine" accessibleName="My PRs, 1">
            My PRs<span className="tmui-tabs__count">1</span>
          </Tab>
          <Tab id="involved" accessibleName="Involved, 50+">
            Involved<span className="tmui-tabs__count">50+</span>
          </Tab>
        </TabList>
        <span style={{ flex: 1 }} />
        <Button size="sm">Refresh</Button>
      </div>
      <p>Updated 2 minutes ago.</p>
      <TabPanel id="needs">Three pull requests need your review.</TabPanel>
      <TabPanel id="mine">One of yours is open.</TabPanel>
      <TabPanel id="involved">At least fifty mention you.</TabPanel>
    </TabsRoot>
  )
}

function Vertical(): React.JSX.Element {
  const [selectedId, setSelectedId] = useState('setup')
  return (
    <TabsRoot selectedId={selectedId} onSelect={setSelectedId}>
      <div style={{ width: 220 }}>
        <TabList label="Pull request chapters" orientation="vertical">
          <Tab id="setup">Setup</Tab>
          <Tab id="api">API changes</Tab>
          <Tab id="tests">Tests</Tab>
        </TabList>
      </div>
    </TabsRoot>
  )
}

export const PartsInToolbar: Story = {
  render: () => <InToolbar initial="needs" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    canvas.getByRole('tab', { name: 'Needs you, 3' }).focus()
    await userEvent.keyboard('{End}')
    await expect(canvas.getByRole('tab', { name: 'Involved, 50+' })).toHaveFocus()
    await expect(canvas.getByRole('tabpanel')).toHaveTextContent('At least fifty mention you.')
  },
}

export const PartsVertical: Story = {
  render: () => <Vertical />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    canvas.getByRole('tab', { name: 'Setup' }).focus()
    await userEvent.keyboard('{ArrowDown}')
    await expect(canvas.getByRole('tab', { name: 'API changes' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  },
}

export const DefaultLight = inLight(Default)
export const SecondSelectedLight = inLight(SecondSelected)
export const WithDisabledTabLight = inLight(WithDisabledTab)
export const PartsInToolbarLight = inLight(PartsInToolbar)
export const PartsVerticalLight = inLight(PartsVertical)
