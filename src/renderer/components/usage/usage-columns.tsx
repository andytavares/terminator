import React from 'react'
import {
  Chip,
  RelativeTime,
  ShareBar,
  Sparkline,
  type ChipTone,
  type DataTableColumn,
} from '@terminator/extension-ui'
import type { UsageState } from '../../../shared/usage/usage-state'
import {
  STATE_ORDER,
  VIA,
  formatActive,
  stateLabel,
  viaShares,
  type Period,
  type StatedRow,
} from './usage-model'

const STATE_TONE: Record<UsageState, ChipTone> = {
  used: 'good',
  'not-used-in-period': 'waiting',
  'never-used': 'bad',
  new: 'neutral',
  gone: 'neutral',
  'extension-off': 'neutral',
}

export function StateChip({ state, period }: { state: UsageState; period: Period }): JSX.Element {
  return <Chip tone={STATE_TONE[state]}>{stateLabel(state, period)}</Chip>
}

function Reached({ row }: { row: StatedRow['row'] }): JSX.Element {
  const shares = viaShares(row.byVia)
  if (shares.length > 0) return <ShareBar label={`How ${row.label} was reached`} shares={shares} />
  return <span className="usage__dim">{row.byVia.shown ? VIA.shown.label : '—'}</span>
}

function LastUsed({ row }: { row: StatedRow['row'] }): JSX.Element {
  return row.lastUsedAt ? (
    <RelativeTime value={row.lastUsedAt} />
  ) : (
    <span className="usage__dim">Never</span>
  )
}

function identityColumns(period: Period): DataTableColumn<StatedRow>[] {
  return [
    {
      id: 'feature',
      header: 'Feature',
      sortValue: ({ row }) => row.label,
      render: ({ row }) => (
        <>
          <span className="usage__name">{row.label}</span>{' '}
          <span className="usage__id">{row.id}</span>
        </>
      ),
    },
    {
      id: 'state',
      header: 'State',
      sortValue: ({ state }) => STATE_ORDER.indexOf(state),
      render: ({ state }) => <StateChip state={state} period={period} />,
    },
    {
      id: 'uses',
      header: 'Uses',
      align: 'end',
      sortValue: ({ row }) => row.usesInPeriod,
      render: ({ row }) => row.usesInPeriod.toLocaleString(),
    },
  ]
}

function dailyColumn(period: Period): DataTableColumn<StatedRow> {
  return {
    id: 'daily',
    header: period === 'all' ? 'Daily, 30 days' : `Daily, ${period} days`,
    render: ({ row }) => (
      <span className="usage__spark">
        <Sparkline values={row.daily} size="sm" />
      </span>
    ),
  }
}

function measureColumns(period: Period): DataTableColumn<StatedRow>[] {
  return [
    dailyColumn(period),
    { id: 'via', header: 'How it was reached', render: ({ row }) => <Reached row={row} /> },
    {
      id: 'active',
      header: 'Active time',
      align: 'end',
      sortValue: ({ row }) => row.activeMs,
      render: ({ row }) => formatActive(row.activeMs),
    },
    {
      id: 'failures',
      header: 'Failures',
      align: 'end',
      sortValue: ({ row }) => row.failures,
      render: ({ row }) => row.failures,
    },
    {
      id: 'last',
      header: 'Last used',
      sortValue: ({ row }) => row.lastUsedAt,
      render: ({ row }) => <LastUsed row={row} />,
    },
  ]
}

export function featureColumns(period: Period): DataTableColumn<StatedRow>[] {
  return [...identityColumns(period), ...measureColumns(period)]
}
