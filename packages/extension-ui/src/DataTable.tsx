import React, { useState } from 'react'
import './desk.css'

export interface DataTableColumn<Row> {
  id: string
  header: string
  align?: 'start' | 'end'
  /** Makes the column sortable: the value rows are ordered by. `null` sorts last. */
  sortValue?: (row: Row) => number | string | null
  render: (row: Row) => React.ReactNode
}

export interface DataTableGroup<Row> {
  id: string
  /** A line above the group's rows. Without it the group has no heading row. */
  summary?: React.ReactNode
  rows: readonly Row[]
}

export interface DataTableSort {
  columnId: string
  direction: 'ascending' | 'descending'
}

export interface DataTableProps<Row> {
  /** Names the table for assistive technology. */
  label: string
  columns: readonly DataTableColumn<Row>[]
  groups: readonly DataTableGroup<Row>[]
  rowKey: (row: Row) => string
  /** The sort at first; rows are ordered within their own group. */
  defaultSort?: DataTableSort
  /** Makes rows buttons: a click, Enter or Space calls it. */
  onRowClick?: (row: Row) => void
  /** The row to mark as chosen. */
  selectedKey?: string | null
}

function compareValues(a: number | string, b: number | string): number {
  return typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b))
}

/** @internal */
export function sortRows<Row>(
  rows: readonly Row[],
  column: DataTableColumn<Row> | undefined,
  direction: DataTableSort['direction']
): Row[] {
  const sortValue = column?.sortValue
  if (!sortValue) return [...rows]
  const sign = direction === 'ascending' ? 1 : -1
  return [...rows].sort((rowA, rowB) => {
    const a = sortValue(rowA)
    const b = sortValue(rowB)
    // Empty values sit last in either direction.
    if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1
    return sign * compareValues(a, b)
  })
}

/** The sort after a press on a column header: first ascending, then flipping. */
function nextSort(current: DataTableSort | undefined, columnId: string): DataTableSort {
  const flips = current?.columnId === columnId && current.direction === 'ascending'
  return { columnId, direction: flips ? 'descending' : 'ascending' }
}

export function DataTable<Row>(props: DataTableProps<Row>): JSX.Element {
  const { label, columns, groups, rowKey, onRowClick, selectedKey } = props
  const [sort, setSort] = useState(props.defaultSort)
  const sortColumn = columns.find((column) => column.id === sort?.columnId)
  return (
    <table className="tmui-data-table" aria-label={label}>
      <HeaderRow
        columns={columns}
        sort={sort}
        onSort={(columnId) => setSort(nextSort(sort, columnId))}
      />
      {groups.map((group) => (
        <GroupRows
          key={group.id}
          group={group}
          columns={columns}
          rows={sortRows(group.rows, sortColumn, sort?.direction ?? 'ascending')}
          rowKey={rowKey}
          selectedKey={selectedKey}
          onRowClick={onRowClick}
        />
      ))}
    </table>
  )
}

interface HeaderRowProps<Row> {
  columns: readonly DataTableColumn<Row>[]
  sort: DataTableSort | undefined
  onSort: (columnId: string) => void
}

function HeaderRow<Row>({ columns, sort, onSort }: HeaderRowProps<Row>): JSX.Element {
  return (
    <thead>
      <tr>
        {columns.map((column) => (
          <HeaderCell
            key={column.id}
            column={column}
            direction={sort?.columnId === column.id ? sort.direction : undefined}
            onSort={() => onSort(column.id)}
          />
        ))}
      </tr>
    </thead>
  )
}

interface GroupRowsProps<Row> extends Pick<DataTableProps<Row>, 'columns' | 'rowKey'> {
  group: DataTableGroup<Row>
  /** The group's rows, already in order. */
  rows: readonly Row[]
  selectedKey: string | null | undefined
  onRowClick: ((row: Row) => void) | undefined
}

function GroupRows<Row>({
  group,
  columns,
  rows,
  rowKey,
  selectedKey,
  onRowClick,
}: GroupRowsProps<Row>): JSX.Element {
  return (
    <tbody>
      {group.summary !== undefined && (
        <tr className="tmui-data-table__group">
          <th scope="rowgroup" colSpan={columns.length}>
            {group.summary}
          </th>
        </tr>
      )}
      {rows.map((row) => (
        <BodyRow
          key={rowKey(row)}
          row={row}
          columns={columns}
          selected={selectedKey === rowKey(row)}
          onClick={onRowClick}
        />
      ))}
    </tbody>
  )
}

interface HeaderCellProps<Row> {
  column: DataTableColumn<Row>
  direction: DataTableSort['direction'] | undefined
  onSort: () => void
}

function HeaderCell<Row>({ column, direction, onSort }: HeaderCellProps<Row>): JSX.Element {
  const align = column.align === 'end' ? ' tmui-data-table__cell--end' : ''
  if (!column.sortValue) {
    return (
      <th scope="col" className={`tmui-data-table__head${align}`}>
        {column.header}
      </th>
    )
  }
  const arrow = direction === 'ascending' ? '↑' : direction === 'descending' ? '↓' : ''
  return (
    <th scope="col" className={`tmui-data-table__head${align}`} aria-sort={direction ?? 'none'}>
      <button type="button" className="tmui-data-table__sort" onClick={onSort}>
        {column.header}
        <span aria-hidden="true" className="tmui-data-table__arrow">
          {arrow}
        </span>
      </button>
    </th>
  )
}

interface BodyRowProps<Row> {
  row: Row
  columns: readonly DataTableColumn<Row>[]
  selected: boolean
  onClick: ((row: Row) => void) | undefined
}

function BodyRow<Row>({ row, columns, selected, onClick }: BodyRowProps<Row>): JSX.Element {
  const classes = ['tmui-data-table__row', selected && 'tmui-data-table__row--selected']
  return (
    <tr
      className={classes.filter(Boolean).join(' ')}
      tabIndex={onClick ? 0 : undefined}
      aria-selected={onClick ? selected : undefined}
      onClick={onClick && (() => onClick(row))}
      onKeyDown={
        onClick &&
        ((event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          onClick(row)
        })
      }
    >
      {columns.map((column) => (
        <td
          key={column.id}
          className={column.align === 'end' ? 'tmui-data-table__cell--end' : undefined}
        >
          {column.render(row)}
        </td>
      ))}
    </tr>
  )
}
