import React from 'react'
import { X } from 'lucide-react'
import { Drawer, IconButton, RelativeTime } from '@terminator/extension-ui'
import {
  VIA,
  formatActive,
  formatDay,
  periodWords,
  viaShares,
  type ExtensionInfo,
  type Period,
  type StatedRow,
} from './usage-model'
import { StateChip } from './usage-columns'

interface UsageDrawerProps {
  entry: StatedRow
  /** Every row on the screen, to find the controls inside a surface. */
  rows: readonly StatedRow[]
  period: Period
  extensions: ReadonlyMap<string, ExtensionInfo>
  onDismiss: () => void
}

function DailyBars({ daily, label }: { daily: readonly number[]; label: string }): JSX.Element {
  const highest = Math.max(1, ...daily)
  return (
    <div className="usage-drawer__bars" role="img" aria-label={label}>
      {daily.map((count, day) => (
        <span
          key={day}
          className="usage-drawer__bar"
          style={{ height: `${(count / highest) * 100}%` }}
        />
      ))}
    </div>
  )
}

/** The controls of a surface: the features of its part whose ids sit under the surface's id. */
function controlsInside(entry: StatedRow, rows: readonly StatedRow[]): StatedRow[] {
  if (entry.row.kind !== 'surface') return []
  return rows
    .filter(
      ({ row }) =>
        row.kind === 'control' &&
        row.source === entry.row.source &&
        row.id.startsWith(`${entry.row.id}.`)
    )
    .sort((a, b) => b.row.usesInPeriod - a.row.usesInPeriod)
}

function controlReading({ row }: StatedRow): string {
  if (row.usesAllTime === 0) return 'Never used'
  return row.usesInPeriod === 0 ? 'Not used' : String(row.usesInPeriod)
}

function Facts({ entry, period }: Pick<UsageDrawerProps, 'entry' | 'period'>): JSX.Element {
  const { row, state } = entry
  return (
    <dl className="usage-drawer__facts">
      <dt>State</dt>
      <dd>
        <StateChip state={state} period={period} />
      </dd>
      <dt>Uses</dt>
      <dd>{`${row.usesInPeriod} ${periodWords(period)} · ${row.usesAllTime} all time`}</dd>
      <dt>Active time</dt>
      <dd>{row.activeMs > 0 ? `${formatActive(row.activeMs)} ${periodWords(period)}` : '—'}</dd>
      <dt>Failures</dt>
      <dd>{row.failures}</dd>
      <dt>Last used</dt>
      <dd>{row.lastUsedAt ? <RelativeTime value={row.lastUsedAt} /> : 'Never'}</dd>
      <dt>Added</dt>
      <dd>{formatDay(row.firstDeclared)}</dd>
    </dl>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="usage-drawer__section">
      <h3 className="usage-drawer__heading">{title}</h3>
      {children}
    </section>
  )
}

function ReachedRows({ row }: { row: StatedRow['row'] }): JSX.Element {
  return (
    <ul className="usage-drawer__rows">
      {viaShares(row.byVia).map((share) => (
        <li key={share.label}>
          <span>{share.label}</span>
          <span>{share.value}</span>
        </li>
      ))}
      {row.byVia.shown ? (
        <li>
          <span>{VIA.shown.label}</span>
          <span>{row.byVia.shown}</span>
        </li>
      ) : null}
    </ul>
  )
}

function InsideRows({ controls }: { controls: readonly StatedRow[] }): JSX.Element {
  return (
    <ul className="usage-drawer__rows">
      {controls.map((control) => (
        <li key={control.row.id}>
          <span>{control.row.label}</span>
          <span>{controlReading(control)}</span>
        </li>
      ))}
    </ul>
  )
}

const partName = (source: string, extensions: UsageDrawerProps['extensions']): string =>
  source === 'core' ? 'Core' : (extensions.get(source)?.name ?? source)

function DrawerHead({ title, sub, onClose }: { title: string; sub: string; onClose: () => void }) {
  return (
    <header className="usage-drawer__head">
      <div>
        <h2 className="usage-drawer__title">{title}</h2>
        <div className="usage-drawer__sub">{sub}</div>
      </div>
      <IconButton icon={X} label="Close" onClick={onClose} />
    </header>
  )
}

export function UsageDrawer(props: UsageDrawerProps): JSX.Element {
  const { entry, rows, period, extensions, onDismiss } = props
  const { row } = entry
  const inside = controlsInside(entry, rows)
  return (
    <Drawer label={row.label} onDismiss={onDismiss}>
      <div className="usage-drawer">
        <DrawerHead
          title={row.label}
          sub={`${partName(row.source, extensions)} · ${row.kind} · ${row.id}`}
          onClose={onDismiss}
        />
        <Facts entry={entry} period={period} />
        <Section title="Uses a day">
          <DailyBars daily={row.daily} label={`${row.label}, uses a day`} />
        </Section>
        <Section title="How it was reached">
          <ReachedRows row={row} />
        </Section>
        {inside.length > 0 && (
          <Section title={`Inside ${row.label}`}>
            <InsideRows controls={inside} />
          </Section>
        )}
      </div>
    </Drawer>
  )
}
