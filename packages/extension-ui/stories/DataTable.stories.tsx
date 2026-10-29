import React from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { DataTable, type DataTableColumn } from '../src/DataTable'
import { inLight } from './in-light'

interface Feature {
  name: string
  uses: number
}

const COLUMNS: DataTableColumn<Feature>[] = [
  { id: 'name', header: 'Feature', sortValue: (row) => row.name, render: (row) => row.name },
  {
    id: 'uses',
    header: 'Uses',
    align: 'end',
    sortValue: (row) => row.uses,
    render: (row) => row.uses,
  },
]

const meta = {
  title: 'Components/DataTable',
  component: DataTable<Feature>,
  args: {
    label: 'Features',
    columns: COLUMNS,
    rowKey: (row: Feature) => row.name,
    defaultSort: { columnId: 'uses', direction: 'descending' },
    groups: [
      {
        id: 'core',
        summary: 'Core · 2 of 3 used',
        rows: [
          { name: 'Home', uses: 412 },
          { name: 'Overview', uses: 0 },
          { name: 'Start work', uses: 96 },
        ],
      },
      { id: 'notepad', summary: 'Notepad · 1 of 1 used', rows: [{ name: 'Notes', uses: 88 }] },
    ],
  },
  decorators: [
    (Story) => (
      <div style={{ width: 420 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DataTable<Feature>>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const table = within(canvasElement)
    await userEvent.click(table.getByRole('button', { name: /Feature/ }))
    await expect(table.getByRole('columnheader', { name: /Feature/ })).toHaveAttribute(
      'aria-sort',
      'ascending'
    )
  },
}
export const DefaultLight = inLight(Default)

export const Clickable: Story = {
  args: { onRowClick: () => {}, selectedKey: 'Notes' },
}
export const ClickableLight = inLight(Clickable)
