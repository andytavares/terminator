/** The last row of a terminal screen with anything on it, as a one-line summary of where it got to. */
export function latestLineOf(rows: readonly string[]): string {
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i].trim()
    if (row !== '') return row
  }
  return ''
}
