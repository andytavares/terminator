import type { UsageFeatureRow, UsageReport } from '../../../shared/usage/usage-types'
import { usageState, type UsageState } from '../../../shared/usage/usage-state'
import type { Via } from '../../../shared/schemas/usage.schema'
import { formatNumber } from '../../home/insights'
import type { ShareTone } from '@terminator/extension-ui'

export type Period = '7' | '30' | '90' | 'all'

export const PERIOD_OPTIONS: readonly { value: Period; label: string }[] = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: 'all', label: 'All time' },
]

const DAY_MS = 86_400_000

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** The first local day ('YYYY-MM-DD') of the period ending today; null for all time. */
export function periodStart(period: Period, now: Date): string | null {
  if (period === 'all') return null
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (Number(period) - 1))
  return `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`
}

/** "2 Nov 2026" for a 'YYYY-MM-DD' day. */
export function formatDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(year, month - 1, date).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/** "38 h 10 m", "6 m", or "—" for none. */
export function formatActive(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes === 0) return '—'
  return minutes < 60 ? `${minutes} m` : `${Math.floor(minutes / 60)} h ${pad(minutes % 60)} m`
}

/** The big number of the Active time card: hours, or minutes below one hour. */
export function activeCardValue(ms: number): { value: string; unit: string } {
  return ms < DAY_MS / 24
    ? { value: String(Math.round(ms / 60_000)), unit: 'm' }
    : { value: formatNumber(ms / (DAY_MS / 24)), unit: 'h' }
}

/** "in 30 days", "in all time": the qualifier after a measure. */
export const periodWords = (period: Period): string =>
  period === 'all' ? 'in all time' : `in ${period} days`

export interface StatedRow {
  row: UsageFeatureRow
  state: UsageState
}

export interface ExtensionInfo {
  name: string
  enabled: boolean
}

export function statedRows(
  report: UsageReport,
  extensions: ReadonlyMap<string, ExtensionInfo>,
  start: string | null
): StatedRow[] {
  const extensionEnabled = (source: string): boolean | undefined => extensions.get(source)?.enabled
  return report.features.map((row) => ({
    row,
    state: usageState(row, { periodStart: start, extensionEnabled }),
  }))
}

export function stateLabel(state: UsageState, period: Period): string {
  const labels: Record<UsageState, string> = {
    used: 'Used',
    'not-used-in-period': period === 'all' ? 'Not used in period' : `Not used in ${period} days`,
    'never-used': 'Never used',
    new: 'New',
    gone: 'Gone',
    'extension-off': 'Extension off',
  }
  return labels[state]
}

export const STATE_ORDER: readonly UsageState[] = [
  'used',
  'not-used-in-period',
  'never-used',
  'new',
  'gone',
  'extension-off',
]

/** A feature of the app as it is now: not gone, and not switched off with its extension. */
export const isCurrent = ({ state }: StatedRow): boolean =>
  state !== 'gone' && state !== 'extension-off'

export const VIA: Record<Via, { label: string; tone: ShareTone }> = {
  click: { label: 'Click', tone: 'accent' },
  palette: { label: 'Palette', tone: 'info' },
  shortcut: { label: 'Shortcut', tone: 'good' },
  menu: { label: 'Menu', tone: 'warning' },
  remote: { label: 'Remote', tone: 'neutral' },
  app: { label: 'App', tone: 'neutral' },
  shown: { label: 'Shown', tone: 'neutral' },
}

/** The parts of a feature's uses by path, biggest first; a screen merely shown is not a path. */
export function viaShares(
  byVia: UsageFeatureRow['byVia']
): { label: string; value: number; tone: ShareTone }[] {
  return (Object.entries(byVia) as [Via, number][])
    .filter(([via, count]) => via !== 'shown' && count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([via, count]) => ({ ...VIA[via], value: count }))
}

export interface SourceGroup {
  source: string
  name: string
  rows: StatedRow[]
  used: number
  total: number
  uses: number
}

/** Rows by source: Core first, then extensions by name. Groups are drawn from `all`, so their
 * counts stay put while a state filter narrows `shown`. */
export function groupBySource(
  all: readonly StatedRow[],
  shown: readonly StatedRow[],
  extensions: ReadonlyMap<string, ExtensionInfo>
): SourceGroup[] {
  const nameOf = (source: string): string =>
    source === 'core' ? 'Core' : (extensions.get(source)?.name ?? source)
  const groups = [...new Set(shown.map((entry) => entry.row.source))].map((source) => {
    const members = all.filter((entry) => entry.row.source === source)
    return {
      source,
      name: nameOf(source),
      rows: shown.filter((entry) => entry.row.source === source),
      used: members.filter((entry) => entry.state === 'used').length,
      total: members.length,
      uses: members.reduce((sum, entry) => sum + entry.row.usesInPeriod, 0),
    }
  })
  const rank = (group: SourceGroup): number => (group.source === 'core' ? 0 : 1)
  return groups.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
}
