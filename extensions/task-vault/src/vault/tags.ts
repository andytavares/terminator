export function toDisplayName(slug: string): string {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

const TAG_PROJECT = /@(\S+)/g
const TAG_CONTEXT = /\+(\S+)/g
const TAG_AREA = /#(\S+)/g
const TAG_META = /\b([a-z][a-z0-9_-]*):([\S]+)/g
const TERMINATOR_LINK_RE =
  /terminator:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi

export interface ExtractedTags {
  text: string
  project?: string
  context?: string
  area?: string
  dueDate?: string
  metadata: Record<string, string>
  terminatorLinks: string[]
}

/** The display name of a tag pattern's first match in `raw`, if any. */
function firstTag(pattern: RegExp, raw: string): string | undefined {
  pattern.lastIndex = 0
  const match = pattern.exec(raw)
  return match ? toDisplayName(match[1]) : undefined
}

/** Every terminator:<uuid> link in `raw`, lower-cased. */
function terminatorLinksIn(raw: string): string[] {
  const links: string[] = []
  TERMINATOR_LINK_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = TERMINATOR_LINK_RE.exec(raw)) !== null) links.push(match[1].toLowerCase())
  return links
}

/** key:value pairs in `raw`: `due:` becomes the due date, `terminator:` is skipped. */
function metaTagsIn(raw: string): { dueDate?: string; metadata: Record<string, string> } {
  const metadata: Record<string, string> = {}
  let dueDate: string | undefined
  TAG_META.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = TAG_META.exec(raw)) !== null) {
    const [, key, value] = match
    if (key === 'due') dueDate = value
    else if (key !== 'terminator') metadata[key] = value
  }
  return { dueDate, metadata }
}

/** The text with every tag removed and whitespace collapsed. */
function stripTags(raw: string): string {
  return raw
    .replace(/@\S+/g, '')
    .replace(/\+\S+/g, '')
    .replace(/#\S+/g, '')
    .replace(/\b[a-z][a-z0-9_-]*:[\S]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function extractTags(raw: string): ExtractedTags {
  const terminatorLinks = terminatorLinksIn(raw)
  const project = firstTag(TAG_PROJECT, raw)
  const context = firstTag(TAG_CONTEXT, raw)
  const area = firstTag(TAG_AREA, raw)
  const { dueDate, metadata } = metaTagsIn(raw)
  return { text: stripTags(raw), project, context, area, dueDate, metadata, terminatorLinks }
}
