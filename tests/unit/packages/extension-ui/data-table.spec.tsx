import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { DataTable, type DataTableColumn } from '../../../../packages/extension-ui/src/DataTable'
import { ShareBar } from '../../../../packages/extension-ui/src/ShareBar'

interface Fruit {
  name: string
  count: number | null
}

const COLUMNS: DataTableColumn<Fruit>[] = [
  { id: 'name', header: 'Name', sortValue: (r) => r.name, render: (r) => r.name },
  {
    id: 'count',
    header: 'Count',
    align: 'end',
    sortValue: (r) => r.count,
    render: (r) => r.count ?? '—',
  },
  { id: 'note', header: 'Note', render: () => 'ok' },
]

const GROUPS = [
  {
    id: 'a',
    summary: 'Orchard · 2 of 3',
    rows: [
      { name: 'Fig', count: 3 },
      { name: 'Apple', count: 9 },
      { name: 'Plum', count: null },
    ],
  },
  { id: 'b', rows: [{ name: 'Lime', count: 1 }] },
]

const rowNames = (): string[] =>
  screen
    .getAllByRole('row')
    .slice(1)
    .filter((row) => !row.textContent?.includes('·'))
    .map((row) => within(row).getAllByRole('cell')[0].textContent ?? '')

describe('DataTable', () => {
  it('shows a heading row for a group with a summary and none for a group without', () => {
    render(<DataTable label="Fruit" columns={COLUMNS} groups={GROUPS} rowKey={(r) => r.name} />)
    expect(screen.getByRole('rowheader', { name: 'Orchard · 2 of 3' })).toBeTruthy()
    expect(screen.getAllByRole('rowheader')).toHaveLength(1)
  })

  it('orders rows inside each group by the default sort, keeping empty values last', () => {
    render(
      <DataTable
        label="Fruit"
        columns={COLUMNS}
        groups={GROUPS}
        rowKey={(r) => r.name}
        defaultSort={{ columnId: 'count', direction: 'descending' }}
      />
    )
    expect(rowNames()).toEqual(['Apple', 'Fig', 'Plum', 'Lime'])
    expect(screen.getByRole('columnheader', { name: /Count/ }).getAttribute('aria-sort')).toBe(
      'descending'
    )
  })
})

describe('DataTable — sorting', () => {
  it('sorts by a pressed header, then flips; a column without a sort has no button', () => {
    render(<DataTable label="Fruit" columns={COLUMNS} groups={GROUPS} rowKey={(r) => r.name} />)
    fireEvent.click(screen.getByRole('button', { name: /Name/ }))
    expect(rowNames()).toEqual(['Apple', 'Fig', 'Plum', 'Lime'])
    fireEvent.click(screen.getByRole('button', { name: /Name/ }))
    expect(rowNames()).toEqual(['Plum', 'Fig', 'Apple', 'Lime'])
    expect(screen.getByRole('columnheader', { name: /Name/ }).getAttribute('aria-sort')).toBe(
      'descending'
    )
    expect(screen.getByRole('columnheader', { name: /Count/ }).getAttribute('aria-sort')).toBe(
      'none'
    )
    expect(screen.queryByRole('button', { name: 'Note' })).toBeNull()
  })
})

describe('DataTable — rows', () => {
  it('opens a row on click, Enter and Space, and the rows take focus', () => {
    const onRowClick = vi.fn()
    render(
      <DataTable
        label="Fruit"
        columns={COLUMNS}
        groups={GROUPS}
        rowKey={(r) => r.name}
        onRowClick={onRowClick}
        selectedKey="Fig"
      />
    )
    const fig = screen.getByRole('row', { name: /Fig/ })
    expect(fig.tabIndex).toBe(0)
    expect(fig.getAttribute('aria-selected')).toBe('true')
    fireEvent.click(fig)
    fireEvent.keyDown(fig, { key: 'Enter' })
    fireEvent.keyDown(fig, { key: ' ' })
    fireEvent.keyDown(fig, { key: 'a' })
    expect(onRowClick).toHaveBeenCalledTimes(3)
    expect(onRowClick).toHaveBeenCalledWith({ name: 'Fig', count: 3 })
  })

  it('leaves rows out of the tab order without a row handler', () => {
    render(<DataTable label="Fruit" columns={COLUMNS} groups={GROUPS} rowKey={(r) => r.name} />)
    expect(screen.getByRole('row', { name: /Fig/ }).hasAttribute('tabindex')).toBe(false)
  })
})

describe('ShareBar', () => {
  it('names the bar and each share for assistive technology', () => {
    render(
      <ShareBar
        label="How Notes was reached"
        shares={[
          { label: 'Click', value: 64, tone: 'accent' },
          { label: 'Menu', value: 0, tone: 'warning' },
          { label: 'Palette', value: 24, tone: 'info' },
        ]}
      />
    )
    expect(
      screen.getByRole('img', { name: 'How Notes was reached: Click 64, Palette 24' })
    ).toBeTruthy()
  })
})

describe('ShareBar — sizes', () => {
  it('sizes each part by its part of the total and leaves out zero parts', () => {
    const { container } = render(
      <ShareBar
        label="x"
        shares={[
          { label: 'Click', value: 3, tone: 'accent' },
          { label: 'Menu', value: 0, tone: 'warning' },
          { label: 'Palette', value: 1, tone: 'info' },
        ]}
      />
    )
    const widths = Array.from(container.querySelectorAll<HTMLElement>('span > span')).map(
      (part) => part.style.width
    )
    expect(widths).toEqual(['75%', '25%'])
  })

  it('draws nothing when nothing was counted', () => {
    const { container } = render(
      <ShareBar label="x" shares={[{ label: 'Click', value: 0, tone: 'accent' }]} />
    )
    expect(container.firstChild).toBeNull()
  })
})
