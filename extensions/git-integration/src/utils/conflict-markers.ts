/** A `<<<<<<<`, `=======` or `>>>>>>>` line, with its newline. */
const CONFLICT_MARKER_RE = new RegExp('^(<{7}.*|={7}|>{7}.*)\\n?', 'gm')

/** The text without its conflict marker lines. */
export function stripConflictMarkers(text: string): string {
  return text.replace(CONFLICT_MARKER_RE, '')
}
