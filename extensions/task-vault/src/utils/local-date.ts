// The view's date helper. It stays on Date: the view has no Temporal (ADR 108).
export function localDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** The English name of a month, 0 for January. */
export function monthNameOf(month: number): string {
  return new Intl.DateTimeFormat('en-US', { month: 'long' }).format(new Date(2000, month, 1))
}

/** The English name of a weekday, 0 for Sunday: in full, or in three letters. */
export function weekdayName(day: number, width: 'long' | 'short' = 'long'): string {
  // 2000-01-02 was a Sunday.
  return new Intl.DateTimeFormat('en-US', { weekday: width }).format(new Date(2000, 0, 2 + day))
}
