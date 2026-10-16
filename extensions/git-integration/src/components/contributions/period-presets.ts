// The period picker's presets, as local calendar dates on plain `Date`: the view has no
// Temporal (ADR 108). Every range is inclusive and ends at `today`.

export type PeriodPreset = 'week' | 'month' | 'year' | 'last30'

export interface PeriodRange {
  /** Local `YYYY-MM-DD`, inclusive on both ends. */
  from: string
  to: string
}

export type PeriodSelection =
  | { kind: 'preset'; preset: PeriodPreset }
  | (PeriodRange & {
      kind: 'custom'
    })

/** The picker's choices, first one on the button before any choice (the design's default). */
export const PERIOD_PRESETS: ReadonlyArray<{ preset: PeriodPreset; label: string }> = [
  { preset: 'year', label: 'This year' },
  { preset: 'week', label: 'This week' },
  { preset: 'month', label: 'This month' },
  { preset: 'last30', label: 'Last 30 days' },
]

/** A local date as `YYYY-MM-DD` (not `toISOString`, which is UTC). */
function localDateString(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function shiftedBy(today: Date, days: number): Date {
  const date = new Date(today)
  date.setDate(date.getDate() - days)
  return date
}

/** The inclusive local range a preset covers, ending today; weeks start Monday. */
export function periodRange(preset: PeriodPreset, today: Date): PeriodRange {
  const to = localDateString(today)
  if (preset === 'year') return { from: `${today.getFullYear()}-01-01`, to }
  if (preset === 'month') return { from: `${localDateString(today).slice(0, 7)}-01`, to }
  if (preset === 'last30') return { from: localDateString(shiftedBy(today, 29)), to }
  const mondayOffset = (today.getDay() + 6) % 7
  return { from: localDateString(shiftedBy(today, mondayOffset)), to }
}

/** The button text: the preset's label, or "Oct 1 – Oct 16" for a custom range. */
export function periodLabel(selection: PeriodSelection): string {
  if (selection.kind === 'preset') {
    const found = PERIOD_PRESETS.find((p) => p.preset === selection.preset)
    return found?.label ?? ''
  }
  return `${shortDate(selection.from, Number(selection.to.slice(0, 4)))} – ${shortDate(selection.to)}`
}

/** "Oct 1"; a year before the range's end year stays ("Dec 3, 2025"). */
function shortDate(date: string, endYear?: number): string {
  const [year, month, day] = date.split('-').map(Number)
  const monthName = new Date(year, month - 1, day).toLocaleString('en-US', { month: 'short' })
  return endYear !== undefined && year !== endYear
    ? `${monthName} ${day}, ${year}`
    : `${monthName} ${day}`
}

/** The range the custom picker's dates give, or null when they cannot be one. */
export function customRange(from: string, to: string, today: Date): PeriodRange | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null
  if (from > to || to > localDateString(today)) return null
  return { from, to }
}
