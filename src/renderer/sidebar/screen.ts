const BORDER_ONLY = /^[\u2500-\u257F\s]*$/

/**
 * The last line of output on a terminal screen, as a one-line summary of where it got to.
 *
 * Read from above the cursor: the cursor's own row is usually the shell prompt
 * or an input box, which says where the terminal is rather than what it did.
 * A screen with nothing above the cursor falls back to its last non-empty row.
 * A row drawn only in box-drawing characters is an input box's border, not output.
 */
export function latestLineOf(rows: readonly string[], cursorY: number = rows.length): string {
  const lastBefore = (end: number): string => {
    for (let i = Math.min(end, rows.length) - 1; i >= 0; i--) {
      const row = rows[i].trim()
      if (row !== '' && !BORDER_ONLY.test(row)) return row
    }
    return ''
  }
  return lastBefore(cursorY) || lastBefore(rows.length)
}
