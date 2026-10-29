import React, { useEffect, useMemo, useState } from 'react'
import { ChartLine, ChevronDown } from 'lucide-react'
import {
  DataTable,
  EmptyState,
  SegmentedControl,
  type DataTableGroup,
} from '@terminator/extension-ui'
import type { UsageState } from '../../../shared/usage/usage-state'
import type { UsageReport } from '../../../shared/usage/usage-types'
import { DropdownMenu, RadioChoices } from '../sidebar/menu'
import { useExtensionRegistry } from '../../extensions/registry'
import { UsageCards } from './UsageCards'
import { UsageDrawer } from './UsageDrawer'
import { featureColumns } from './usage-columns'
import {
  PERIOD_OPTIONS,
  STATE_ORDER,
  VIA,
  formatDay,
  groupBySource,
  periodStart,
  stateLabel,
  statedRows,
  type ExtensionInfo,
  type Period,
  type StatedRow,
} from './usage-model'
import '../sidebar/SidebarMenu.css'
import '../screen-chrome.css'
import './UsageScreen.css'

const ALL_PARTS = 'all'

/** The report for the period, and the installed extensions; reloaded when the period changes. */
function useUsageData(start: string | null): {
  report: UsageReport | null
  extensions: ReadonlyMap<string, ExtensionInfo>
} {
  const [report, setReport] = useState<UsageReport | null>(null)
  const [extensions, setExtensions] = useState<ReadonlyMap<string, ExtensionInfo>>(new Map())
  useEffect(() => {
    let current = true
    void Promise.all([
      window.electronAPI.usage.report({ from: start }),
      window.electronAPI.extension.list(),
    ]).then(([reply, { extensions: installed }]) => {
      if (!current || !('data' in reply)) return
      setReport(reply.data)
      setExtensions(
        new Map(installed.map((e) => [e.id, { name: e.name, enabled: e.status !== 'disabled' }]))
      )
    })
    return () => {
      current = false
    }
  }, [start])
  return { report, extensions }
}

function PathLegend(): React.JSX.Element {
  return (
    <ul className="usage__legend" aria-label="Paths">
      {(['click', 'palette', 'shortcut', 'menu'] as const).map((via) => (
        <li key={via}>
          <i className={`usage__swatch tmui-share-bar__part--${VIA[via].tone}`} />
          {VIA[via].label}
        </li>
      ))}
    </ul>
  )
}

interface StateChipsProps {
  rows: StatedRow[]
  period: Period
  chosen: UsageState | null
  onChoose: (state: UsageState | null) => void
}

function StateChips({ rows, period, chosen, onChoose }: StateChipsProps): React.JSX.Element {
  const choices: [UsageState | null, string, number][] = [
    [null, 'All', rows.length],
    ...STATE_ORDER.map((state): [UsageState, string, number] => [
      state,
      stateLabel(state, period),
      rows.filter((entry) => entry.state === state).length,
    ]),
  ]
  return (
    <div className="usage__chips">
      {choices.map(([state, label, count]) => (
        <button
          key={label}
          type="button"
          className="usage__chip"
          aria-pressed={chosen === state}
          onClick={() => onChoose(state)}
        >
          {label} <span className="usage__chip-count">{count}</span>
        </button>
      ))}
      <PathLegend />
    </div>
  )
}

function tableGroups(
  rows: StatedRow[],
  shown: StatedRow[],
  extensions: ReadonlyMap<string, ExtensionInfo>
): DataTableGroup<StatedRow>[] {
  return groupBySource(rows, shown, extensions).map((group) => ({
    id: group.source,
    summary: (
      <>
        <b>{group.name}</b> · {group.used} of {group.total} used · {group.uses.toLocaleString()}{' '}
        uses
      </>
    ),
    rows: group.rows,
  }))
}

interface UsageBodyProps {
  rows: StatedRow[]
  extensions: ReadonlyMap<string, ExtensionInfo>
  period: Period
  start: string | null
}

/** The cards, state chips and the table, for the rows of one part. */
function UsageBody({ rows, extensions, period, start }: UsageBodyProps): React.JSX.Element {
  const [state, setState] = useState<UsageState | null>(null)
  const [opened, setOpened] = useState<StatedRow | null>(null)
  const shown = rows.filter((entry) => state === null || entry.state === state)
  const columns = useMemo(() => featureColumns(period), [period])
  return (
    <>
      <UsageCards rows={rows} period={period} start={start} />
      <StateChips rows={rows} period={period} chosen={state} onChoose={setState} />
      <DataTable
        label="Feature usage"
        columns={columns}
        groups={tableGroups(rows, shown, extensions)}
        rowKey={({ row }) => row.id}
        defaultSort={{ columnId: 'uses', direction: 'descending' }}
        onRowClick={setOpened}
        selectedKey={opened?.row.id}
      />
      {opened && (
        <UsageDrawer
          entry={opened}
          rows={rows}
          period={period}
          extensions={extensions}
          onDismiss={() => setOpened(null)}
        />
      )}
    </>
  )
}

interface PartMenuProps {
  rows: StatedRow[]
  extensions: ReadonlyMap<string, ExtensionInfo>
  part: string
  onPick: (part: string) => void
}

/** All parts, Core, and each extension that has a feature. */
function PartMenu({ rows, extensions, part, onPick }: PartMenuProps): React.JSX.Element {
  const sources = [...new Set(rows.map((entry) => entry.row.source))]
  const choices: [string, string][] = [
    [ALL_PARTS, 'All parts'],
    ...sources.map((source): [string, string] => [
      source,
      source === 'core' ? 'Core' : (extensions.get(source)?.name ?? source),
    ]),
  ]
  return (
    <DropdownMenu
      label={choices.find(([source]) => source === part)?.[1] ?? 'All parts'}
      icon={<ChevronDown aria-hidden="true" />}
      panelLabel="Part of the app"
    >
      {(close) => (
        <RadioChoices
          choices={choices}
          current={part}
          onPick={(source) => {
            onPick(source)
            close()
          }}
        />
      )}
    </DropdownMenu>
  )
}

interface UsageHeaderProps {
  countingSince: string | null | undefined
  period: Period
  onPeriod: (period: Period) => void
  menu: React.ReactNode
}

function UsageHeader({
  countingSince,
  period,
  onPeriod,
  menu,
}: UsageHeaderProps): React.JSX.Element {
  return (
    <div className="wall__bar">
      <h2 className="wall__title">Usage</h2>
      {countingSince && (
        <span className="wall__meta">Counted on this Mac since {formatDay(countingSince)}</span>
      )}
      <SegmentedControl
        label="Period"
        size="sm"
        options={PERIOD_OPTIONS}
        value={period}
        onChange={onPeriod}
      />
      {menu}
    </div>
  )
}

function NothingCounted(): React.JSX.Element {
  return (
    <EmptyState
      icon={ChartLine}
      heading="Nothing counted yet"
      description="Uses are counted from today. Open a screen or run an action, then come back."
      actions={[
        {
          label: 'Go to Home',
          onSelect: () => useExtensionRegistry.getState().setActiveGlobalTab('core.home'),
        },
      ]}
    />
  )
}

/** How much each feature of the app is used: a summary, then every feature by part of the app. */
export function UsageScreen(): React.JSX.Element {
  const [period, setPeriod] = useState<Period>('30')
  const [part, setPart] = useState(ALL_PARTS)
  // Read on every render, not memoized: a screen left open past midnight moves to the new day.
  const start = periodStart(period, new Date())
  const { report, extensions } = useUsageData(start)
  const rows = useMemo(
    () => (report ? statedRows(report, extensions, start) : []),
    [report, extensions, start]
  )
  const inPart = rows.filter((entry) => part === ALL_PARTS || entry.row.source === part)
  const nothingCounted = report !== null && report.features.every((f) => f.usesAllTime === 0)
  return (
    <div className="wall usage">
      <UsageHeader
        countingSince={report?.countingSince}
        period={period}
        onPeriod={setPeriod}
        menu={<PartMenu rows={rows} extensions={extensions} part={part} onPick={setPart} />}
      />
      <div className="usage__body">
        {nothingCounted && <NothingCounted />}
        {report && !nothingCounted && (
          <UsageBody rows={inPart} extensions={extensions} period={period} start={start} />
        )}
      </div>
    </div>
  )
}
