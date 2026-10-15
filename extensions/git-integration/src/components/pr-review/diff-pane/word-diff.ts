import type { DiffLine } from '../../../schemas/git.schema'

export interface Span {
  text: string
  changed: boolean
}

const MAX_LINE_LENGTH = 1000
const MAX_TOKEN_PRODUCT = 250_000
const MIN_SHARED_FRACTION = 0.4
const TOKEN_PATTERN = /[A-Za-z0-9_]+|\s+|[^A-Za-z0-9_\s]/g

/** Identifier/number runs, whitespace runs and single punctuation characters; they join back to the input. */
export function tokenize(text: string): string[] {
  return text.match(TOKEN_PATTERN) ?? []
}

/** Marks which tokens of each side fall outside the longest common subsequence. */
function unmatchedTokens(oldTokens: string[], newTokens: string[]) {
  const rows = oldTokens.length + 1
  const cols = newTokens.length + 1
  const lengths = Array.from({ length: rows }, () => new Array<number>(cols).fill(0))
  for (let i = rows - 2; i >= 0; i--) {
    for (let j = cols - 2; j >= 0; j--) {
      lengths[i][j] =
        oldTokens[i] === newTokens[j]
          ? lengths[i + 1][j + 1] + 1
          : Math.max(lengths[i + 1][j], lengths[i][j + 1])
    }
  }
  const oldChanged = new Array<boolean>(oldTokens.length).fill(true)
  const newChanged = new Array<boolean>(newTokens.length).fill(true)
  let i = 0
  let j = 0
  while (i < oldTokens.length && j < newTokens.length) {
    if (oldTokens[i] === newTokens[j]) {
      oldChanged[i++] = false
      newChanged[j++] = false
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) i++
    else j++
  }
  return { oldChanged, newChanged }
}

function toSpans(tokens: string[], changed: boolean[]): Span[] {
  const spans: Span[] = []
  tokens.forEach((text, index) => {
    const last = spans[spans.length - 1]
    if (last && last.changed === changed[index]) last.text += text
    else spans.push({ text, changed: changed[index] })
  })
  return spans
}

function unchangedLength(tokens: string[], changed: boolean[]): number {
  return tokens.reduce((sum, token, index) => (changed[index] ? sum : sum + token.length), 0)
}

function wholeLine(oldText: string, newText: string) {
  return {
    old: [{ text: oldText, changed: false }],
    new: [{ text: newText, changed: false }],
  }
}

/** Word-level spans for a replaced line pair; whole-line spans when the lines are too long or too different. */
export function wordSpans(oldText: string, newText: string): { old: Span[]; new: Span[] } {
  if (oldText.length > MAX_LINE_LENGTH || newText.length > MAX_LINE_LENGTH) {
    return wholeLine(oldText, newText)
  }
  const oldTokens = tokenize(oldText)
  const newTokens = tokenize(newText)
  if (oldTokens.length * newTokens.length > MAX_TOKEN_PRODUCT) return wholeLine(oldText, newText)

  const { oldChanged, newChanged } = unmatchedTokens(oldTokens, newTokens)
  const longest = Math.max(oldText.length, newText.length)
  const shared = unchangedLength(oldTokens, oldChanged)
  if (longest > 0 && shared / longest < MIN_SHARED_FRACTION) return wholeLine(oldText, newText)

  return { old: toSpans(oldTokens, oldChanged), new: toSpans(newTokens, newChanged) }
}

/** Index of each removed line mapped to the added line that replaces it, run by run within a hunk. */
export function pairReplacedLines(lines: DiffLine[]): Map<number, number> {
  const pairs = new Map<number, number>()
  let index = 0
  while (index < lines.length) {
    const removedStart = index
    while (lines[index]?.type === 'remove') index++
    const addedStart = index
    while (lines[index]?.type === 'add') index++
    const count = Math.min(addedStart - removedStart, index - addedStart)
    for (let offset = 0; offset < count; offset++)
      pairs.set(removedStart + offset, addedStart + offset)
    if (index === removedStart) index++
  }
  return pairs
}

const HTML_UNIT = /<[^>]*>|&#?\w+;|[^<&]|&/g

/** Wraps the changed characters of highlighted HTML in `<span class>`; a mark never spans a tag. */
export function markChangedWords(html: string, spans: Span[], className: string): string {
  const changedAt = spans.flatMap((span) => new Array<boolean>(span.text.length).fill(span.changed))
  let position = 0
  let marking = false
  let marked = ''
  for (const unit of html.match(HTML_UNIT) ?? []) {
    const isTag = unit.startsWith('<')
    const wantMark = !isTag && changedAt[position] === true
    marked += markBoundary(marking, wantMark, className) + unit
    marking = wantMark
    if (!isTag) position++
  }
  return marking ? `${marked}</span>` : marked
}

/** The tag that opens or closes a mark when marking changes between two units, else nothing. */
function markBoundary(marking: boolean, wantMark: boolean, className: string): string {
  if (marking === wantMark) return ''
  return wantMark ? `<span class="${className}">` : '</span>'
}
