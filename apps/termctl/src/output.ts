export type Row = Record<string, unknown>

/** The text to print for a tool's result: a table for a list of records, else indented JSON.
 * Most list tools wrap their rows in a one-field object, such as `{ workspaces: [...] }`. */
export function formatResult(text: string, options: { json: boolean }): string {
  if (options.json) return `${text}\n`
  const value = parsedOrUndefined(text)
  if (value === undefined) return `${text}\n`
  const rows = unwrapped(value)
  if (isRowList(rows)) return table(rows)
  return `${JSON.stringify(value, null, 2)}\n`
}

/** The records of a list tool's result; none when the result is not a list of records. */
export function resultRows(text: string): Row[] {
  const rows = unwrapped(parsedOrUndefined(text))
  return isRowList(rows) ? rows : []
}

function parsedOrUndefined(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function unwrapped(value: unknown): unknown {
  return isRow(value) && Object.keys(value).length === 1 ? Object.values(value)[0] : value
}

function isRowList(value: unknown): value is Row[] {
  return Array.isArray(value) && value.length > 0 && value.every(isRow)
}

function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isScalar(value: unknown): boolean {
  return value === null || typeof value !== 'object'
}

export function table(rows: Row[]): string {
  const columns = [
    ...new Set(rows.flatMap((row) => Object.keys(row).filter((key) => isScalar(row[key])))),
  ]
  const cells = rows.map((row) => columns.map((column) => cellText(row[column])))
  const widths = columns.map((column, index) =>
    Math.max(column.length, ...cells.map((line) => line[index].length))
  )
  const lines = [columns, ...cells].map((line) =>
    line
      .map((cell, index) => cell.padEnd(widths[index]))
      .join('  ')
      .trimEnd()
  )
  return `${lines.join('\n')}\n`
}

function cellText(value: unknown): string {
  return value === null || value === undefined || !isScalar(value) ? '' : String(value)
}
