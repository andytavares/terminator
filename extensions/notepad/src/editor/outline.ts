// The document's heading structure, for the sidebar outline.
//
// This is a line scan rather than a markdown parse: it runs on every keystroke
// while a note is open, and re-parsing the whole document to find its headings
// would be paying for the entire grammar to answer a question about six line
// shapes. The rules it implements are CommonMark's ATX headings and fenced code
// blocks (https://spec.commonmark.org/0.31.2/#atx-headings), which is the same
// subset the live preview renders — so the outline can never list a heading the
// editor does not show as one.

export interface OutlineHeading {
  /** Offset of the heading's line start, so a jump lands on the heading itself. */
  from: number
  /** 1–6, from the number of leading hashes. */
  level: number
  /** The heading text, with the opening and closing hash sequences removed. */
  text: string
}

/** 0–3 leading spaces (4 would be an indented code block), then 1–6 hashes. */
const ATX_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/
/** A closing hash sequence is decoration: it must be preceded by whitespace. */
const CLOSING_SEQUENCE = /(?:^|[ \t]+)#+[ \t]*$/
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/

export function parseOutline(body: string): OutlineHeading[] {
  const headings: OutlineHeading[] = []
  let openFence: string | null = null
  let offset = 0

  for (const line of body.split('\n')) {
    if (openFence !== null) {
      if (closesFence(line, openFence)) openFence = null
    } else {
      openFence = fenceOpenedBy(line)
      const heading = openFence === null ? headingAt(line, offset) : null
      if (heading) headings.push(heading)
    }
    offset += line.length + 1
  }

  return headings
}

function closesFence(line: string, openFence: string): boolean {
  const close = FENCE_CLOSE.exec(line)
  return !!close && close[1][0] === openFence[0] && close[1].length >= openFence.length
}

/** The fence a line opens, or null when it opens none. */
function fenceOpenedBy(line: string): string | null {
  const fence = FENCE_OPEN.exec(line)
  if (!fence) return null
  // An info string may not contain a backtick when the fence is backticks,
  // which is what keeps inline code (`` `x` ``) from opening a block.
  if (fence[1][0] === '`' && fence[2].includes('`')) return null
  return fence[1]
}

function headingAt(line: string, offset: number): OutlineHeading | null {
  const heading = ATX_HEADING.exec(line)
  if (!heading) return null
  const text = (heading[2] ?? '').replace(CLOSING_SEQUENCE, '').trim()
  // A heading with no text has nothing to offer an outline reader.
  if (!text) return null
  return { from: offset, level: heading[1].length, text }
}
