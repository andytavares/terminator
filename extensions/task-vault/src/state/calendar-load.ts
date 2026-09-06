/**
 * What a calendar day is carrying.
 *
 * Pure, and kept out of the component so it can be tested without a DOM — the
 * cell used to say only its own date, which the grid already shows, so a month
 * of dots could not be read without clicking into every day.
 */

/** Statuses that still want something from you. */
const UNFINISHED = new Set(['open', 'in-progress', 'in-review', 'blocked'])

/**
 * What a day is carrying, for the cell's accessible name and tooltip.
 *
 * The cell used to say only its own date, which a calendar grid already shows —
 * so a month of dots could not be read without clicking into every day.
 */
export function dayLoadLabel(dateStr: string, rows: { status: string }[]): string {
  if (rows.length === 0) return `${dateStr} · nothing`
  const open = rows.filter((r) => UNFINISHED.has(r.status)).length
  if (open === 0) return `${dateStr} · ${rows.length} done`
  return `${dateStr} · ${open} of ${rows.length} still open`
}

/** A past day still holding unfinished work. */
export function isOverdue(dateStr: string, rows: { status: string }[], todayStr: string): boolean {
  return dateStr < todayStr && rows.some((r) => UNFINISHED.has(r.status))
}

/** The seven days of the week containing `dateStr`, Sunday first. */
export function weekOf(dateStr: string): string[] {
  const [y, m, d] = dateStr.split('-').map(Number)
  const anchor = new Date(y, m - 1, d)
  const start = new Date(anchor)
  start.setDate(anchor.getDate() - anchor.getDay())
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(start)
    day.setDate(start.getDate() + i)
    return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
  })
}

/**
 * "Sat 5" — enough to recognise the row without repeating the year.
 *
 * Composed rather than asking Intl for both fields at once: en-US orders that
 * combination as "5 Sat", which reads as a quantity before it reads as a date.
 */
export function shortDay(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const weekday = new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short' })
  return `${weekday} ${d}`
}
