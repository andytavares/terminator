import type { ChoiceOption, ChoicePrompt } from '../../shared/types/index'

/** A select option as Claude Code draws it: an optional ❯ cursor, then "N. label". */
const OPTION = /^(❯\s*)?(\d+)\.\s+(.+)$/
/** Rows of a boxed prompt carry box-drawing edges; they are chrome, not text. */
const EDGES = /^[\s│┃]+|[\s│┃]+$/g
/** A wrapped label continues deeper than the option's own number. */
const CONTINUATION_INDENT = 5
/** Lines a prompt may draw beneath its options, such as "Esc to cancel". */
const MAX_FOOTER_LINES = 2

const clean = (row: string): string => row.replace(EDGES, '')
const indentOf = (row: string): number => row.replace(/^[│┃]/, ' ').search(/\S/)

type PromptLine = { text: string; option: RegExpExecArray | null }

/** The last row with anything on it, or -1 when the screen is blank. */
function lastFilledRow(rows: readonly string[], from: number): number {
  let row = from
  while (row >= 0 && clean(rows[row]) === '') row--
  return row
}

/** The last option row, allowing a short footer beneath it; -1 when there is none. */
function lastOptionRow(rows: readonly string[], last: number): number {
  for (let i = last; i >= Math.max(0, last - MAX_FOOTER_LINES); i--) {
    if (OPTION.test(clean(rows[i]))) return i
  }
  return -1
}

/**
 * The option rows and their wrapped continuations, read upwards from `end`, and
 * the row of the first option.
 */
function optionLines(rows: readonly string[], end: number): { lines: PromptLine[]; start: number } {
  const lines: PromptLine[] = []
  let start = end
  for (let i = end; i >= 0; i--) {
    const text = clean(rows[i])
    const option = OPTION.exec(text)
    if (option) {
      lines.unshift({ text, option })
      start = i
    } else if (text !== '' && indentOf(rows[i]) >= CONTINUATION_INDENT) {
      lines.unshift({ text, option: null })
    } else break
  }
  // Continuation rows above the first option belong to no option.
  while (lines.length > 0 && lines[0].option === null) lines.shift()
  return { lines, start }
}

/** The options numbered 1 to n under exactly one ❯ cursor, or null when they are not a prompt. */
function promptOptions(lines: PromptLine[]): ChoiceOption[] | null {
  const options: ChoiceOption[] = []
  let cursors = 0
  for (const line of lines) {
    if (line.option === null) {
      options[options.length - 1].label += ` ${line.text}`
      continue
    }
    if (line.option[1] !== undefined) cursors++
    options.push({ number: Number(line.option[2]), label: line.option[3].trim() })
  }
  if (options.length < 2 || cursors !== 1) return null
  return options.some((o, i) => o.number !== i + 1) ? null : options
}

/**
 * The numbered choice an agent is waiting on, read off its screen.
 *
 * Only a prompt that is the last thing on screen counts — a question that has
 * scrolled up under newer output has been answered. It must show exactly one
 * ❯ cursor, which is what separates a select prompt from a numbered list in
 * ordinary output, and number its options 1 to n.
 */
export function parseChoicePrompt(rows: readonly string[]): ChoicePrompt | null {
  const last = lastFilledRow(rows, rows.length - 1)
  if (last < 0) return null
  const end = lastOptionRow(rows, last)
  if (end === -1) return null
  const { lines, start } = optionLines(rows, end)
  const options = promptOptions(lines)
  if (options === null) return null
  const question = lastFilledRow(rows, start - 1)
  if (question < 0) return null
  return { question: clean(rows[question]), options }
}

/** Whether two prompts offer the same options in the same order; the question may be reworded. */
export function samePrompt(a: ChoicePrompt | null, b: ChoicePrompt | null): boolean {
  if (a === null || b === null || a.options.length !== b.options.length) return false
  return a.options.every(
    (o, i) => o.number === b.options[i].number && o.label === b.options[i].label
  )
}
