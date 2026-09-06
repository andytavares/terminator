/**
 * The first prose line of a markdown brief.
 *
 * Card descriptions were rendering their source verbatim, so the literal string
 * `# Summary` appeared as the description on every card on the board and again
 * in the drawer's Scope field. Rendering the markdown on a 200px card would
 * trade one problem for another, so the card takes the first line that is
 * actually prose.
 */

const SKIPPABLE = [
  /^#{1,6}\s/, // headings — "# Summary"
  /^[-*+]\s*$/, // an empty list bullet
  /^\s*$/, // blank
  /^\|/, // table row
  /^>\s*$/, // empty quote
  /^(-{3,}|\*{3,}|_{3,})$/, // rule
]

export function firstProseLine(markdown: string | null | undefined): string {
  if (!markdown) return ''
  let inFence = false
  for (const raw of markdown.split('\n')) {
    const line = raw.trim()
    // The whole fenced block is skipped, not just its delimiters: code is not
    // prose, and the first line inside one would otherwise become the summary.
    if (line.startsWith('```')) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    if (SKIPPABLE.some((re) => re.test(line))) continue
    return stripInline(line)
  }
  return ''
}

/**
 * Inline markers, removed rather than rendered. A card shows one line of plain
 * text; leaving `**bold**` in it is the same defect as leaving `# Summary`.
 */
function stripInline(line: string): string {
  return line
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // images → alt text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links → text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|\s)_([^_]+)_(?=\s|$)/g, '$1$2')
    .replace(/(^|\s)\*([^*]+)\*(?=\s|$)/g, '$1$2')
    .replace(/^[-*+]\s+/, '') // leading bullet
    .replace(/^>\s+/, '') // leading quote
    .trim()
}
