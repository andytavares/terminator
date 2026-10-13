// Atlassian Document Format → markdown.
//
// Jira Cloud REST v3 returns descriptions and comments as ADF, a JSON
// document. Everything downstream of a provider — the drawer, the agent
// context, the search snippet — expects markdown, because Linear supplies
// markdown and there is exactly one renderer.
//
// Written here rather than taken as a dependency: `adf-to-md` is maintained by
// one person, which the constitution forbids adopting, and Atlassian's own
// transformer is a slice of the Atlaskit editor. The node set below is the one
// FR-014 names and no more — this is not an ADF implementation, and it is not
// meant to become one.
//
// Pure: no I/O, no state, total over its input. Anything it does not
// understand degrades to that node's text content, which is visible and
// bounded. Throwing would mean one unexpected node makes an issue unreadable.

interface AdfNode {
  type?: string
  text?: string
  attrs?: Record<string, unknown>
  marks?: AdfMark[]
  content?: AdfNode[]
}

interface AdfMark {
  type?: string
  attrs?: Record<string, unknown>
}

function isNode(value: unknown): value is AdfNode {
  return typeof value === 'object' && value !== null
}

function childrenOf(node: AdfNode): AdfNode[] {
  return Array.isArray(node.content) ? node.content.filter(isNode) : []
}

function attr(node: AdfNode, name: string): unknown {
  return node.attrs === undefined ? undefined : node.attrs[name]
}

function renderLink(value: string, mark: AdfMark): string {
  const href = mark.attrs?.href
  return typeof href === 'string' ? `[${value}](${href})` : value
}

const MARK_RENDERERS = new Map<string, (value: string, mark: AdfMark) => string>([
  ['strong', (value) => `**${value}**`],
  ['em', (value) => `_${value}_`],
  ['code', (value) => `\`${value}\``],
  ['strike', (value) => `~~${value}~~`],
  ['link', renderLink],
])

/** Marks applied innermost-first so `[`fn`](href)` comes out in that order. */
function applyMarks(value: string, marks: AdfMark[] | undefined): string {
  if (!Array.isArray(marks)) return value
  return marks.reduce((out, mark) => {
    const render = isNode(mark) ? MARK_RENDERERS.get(mark.type ?? '') : undefined
    return render === undefined ? out : render(out, mark)
  }, value)
}

/** Everything that can appear inside a paragraph, cell, heading or task item. */
function renderAdfInline(nodes: AdfNode[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
          return applyMarks(typeof node.text === 'string' ? node.text : '', node.marks)
        case 'hardBreak':
          return '\n'
        case 'mention':
        case 'emoji': {
          // Both carry their display form in attrs; without this a mention
          // vanishes and a sentence loses its subject.
          const shown = attr(node, 'text')
          return typeof shown === 'string' ? shown : ''
        }
        case 'inlineCard': {
          const url = attr(node, 'url')
          return typeof url === 'string' ? url : ''
        }
        default:
          return renderAdfInline(childrenOf(node))
      }
    })
    .join('')
}

function renderListItems(node: AdfNode, depth: number, ordered: boolean): string {
  const indent = '  '.repeat(depth)
  return (
    childrenOf(node)
      .map((item) => renderListItemBody(childrenOf(item), depth + 1))
      // Dropped before numbering, or an empty item leaves a bare "- " on its own
      // line and shifts every number after it.
      .filter((body) => body.length > 0)
      .map((body, index) => {
        const marker = ordered ? `${index + 1}. ` : '- '
        const [first, ...rest] = body.split('\n')
        // Continuation lines already carry their own indentation from the
        // nested render; only the marker line needs this level's.
        return [`${indent}${marker}${first ?? ''}`, ...rest].join('\n')
      })
      .join('\n')
  )
}

const NESTED_LIST_TYPES = new Set(['bulletList', 'orderedList', 'taskList'])

/**
 * A list item's own blocks.
 *
 * Separate from renderBlocks because a nested list hangs directly off its
 * parent item — a blank line between them makes markdown treat the list as
 * loose and renders a paragraph gap the source never had.
 */
function renderListItemBody(nodes: AdfNode[], depth: number): string {
  const parts = nodes
    .map((node) => ({ type: node.type, text: renderBlock(node, depth) }))
    .filter((part) => part.text !== '')
  return parts.reduce((acc, part, index) => {
    if (index === 0) return part.text
    return acc + (NESTED_LIST_TYPES.has(part.type ?? '') ? '\n' : '\n\n') + part.text
  }, '')
}

function renderTaskItems(node: AdfNode, depth: number): string {
  const indent = '  '.repeat(depth)
  return childrenOf(node)
    .map((item) => {
      const done = attr(item, 'state') === 'DONE'
      return `${indent}- [${done ? 'x' : ' '}] ${renderAdfInline(childrenOf(item))}`
    })
    .join('\n')
}

function renderTable(node: AdfNode): string {
  const rows = childrenOf(node).filter((row) => row.type === 'tableRow')
  if (rows.length === 0) return ''
  const cells = rows.map((row) =>
    childrenOf(row).map((cell) => renderBlocks(childrenOf(cell), 0).replace(/\n+/g, ' ').trim())
  )
  const lines = [`| ${cells[0].join(' | ')} |`]
  // A header separator is only correct when the first row is actually a
  // header; ADF says so per cell, and a table without one is still a table.
  const firstRowIsHeader = childrenOf(rows[0]).every((cell) => cell.type === 'tableHeader')
  if (firstRowIsHeader) lines.push(`| ${cells[0].map(() => '---').join(' | ')} |`)
  for (const row of cells.slice(1)) lines.push(`| ${row.join(' | ')} |`)
  return lines.join('\n')
}

function renderHeading(node: AdfNode): string {
  const rawLevel = attr(node, 'level')
  const level = typeof rawLevel === 'number' ? Math.min(Math.max(rawLevel, 1), 6) : 1
  return `${'#'.repeat(level)} ${renderAdfInline(childrenOf(node))}`
}

function renderBlockquote(node: AdfNode, depth: number): string {
  return renderBlocks(childrenOf(node), depth)
    .split('\n')
    .map((line) => (line.length === 0 ? '>' : `> ${line}`))
    .join('\n')
}

function renderCodeBlock(node: AdfNode): string {
  const language = attr(node, 'language')
  const fence = typeof language === 'string' && language.length > 0 ? `\`\`\`${language}` : '```'
  return `${fence}\n${renderAdfInline(childrenOf(node))}\n\`\`\``
}

const renderAsInline = (node: AdfNode): string => renderAdfInline([node])

const BLOCK_RENDERERS = new Map<string, (node: AdfNode, depth: number) => string>([
  ['paragraph', (node) => renderAdfInline(childrenOf(node))],
  ['heading', renderHeading],
  ['bulletList', (node, depth) => renderListItems(node, depth, false)],
  ['orderedList', (node, depth) => renderListItems(node, depth, true)],
  ['taskList', renderTaskItems],
  ['table', renderTable],
  ['blockquote', renderBlockquote],
  ['codeBlock', renderCodeBlock],
  ['rule', () => '---'],
  ['text', renderAsInline],
  ['mention', renderAsInline],
  ['emoji', renderAsInline],
  ['inlineCard', renderAsInline],
  ['hardBreak', renderAsInline],
])

function renderBlock(node: AdfNode, depth: number): string {
  const render = BLOCK_RENDERERS.get(node.type ?? '')
  // Unmapped: render what it contains. A panel keeps its notice, a media
  // node with nothing readable in it contributes nothing.
  return render === undefined ? renderBlocks(childrenOf(node), depth) : render(node, depth)
}

function renderBlocks(nodes: AdfNode[], depth: number): string {
  const rendered = nodes.map((node) => renderBlock(node, depth)).filter((block) => block !== '')
  // Lists are already newline-joined internally; blocks are separated by a
  // blank line, which is what makes them separate blocks in markdown.
  return rendered.join('\n\n')
}

/**
 * Convert an ADF document to markdown. Accepts a plain string unchanged, since
 * some Jira fields are text rather than ADF, and never throws.
 */
export function adfToMarkdown(document: unknown): string {
  if (typeof document === 'string') return document
  if (!isNode(document)) return ''
  return renderBlocks(childrenOf(document), 0).trim()
}
