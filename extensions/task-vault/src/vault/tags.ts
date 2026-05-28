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

export function extractTags(raw: string): ExtractedTags {
  const metadata: Record<string, string> = {}
  let project: string | undefined
  let context: string | undefined
  let area: string | undefined
  let dueDate: string | undefined
  const terminatorLinks: string[] = []

  // Extract terminator:<uuid> links
  TERMINATOR_LINK_RE.lastIndex = 0
  let tlMatch: RegExpExecArray | null
  while ((tlMatch = TERMINATOR_LINK_RE.exec(raw)) !== null) {
    terminatorLinks.push(tlMatch[1].toLowerCase())
  }

  // Extract @project (first occurrence)
  TAG_PROJECT.lastIndex = 0
  const projMatch = TAG_PROJECT.exec(raw)
  if (projMatch) project = toDisplayName(projMatch[1])

  // Extract +context (first occurrence)
  TAG_CONTEXT.lastIndex = 0
  const ctxMatch = TAG_CONTEXT.exec(raw)
  if (ctxMatch) context = toDisplayName(ctxMatch[1])

  // Extract #area (first occurrence)
  TAG_AREA.lastIndex = 0
  const areaMatch = TAG_AREA.exec(raw)
  if (areaMatch) area = toDisplayName(areaMatch[1])

  // Extract key:value metadata (including due:)
  TAG_META.lastIndex = 0
  let metaMatch: RegExpExecArray | null
  while ((metaMatch = TAG_META.exec(raw)) !== null) {
    const key = metaMatch[1]
    const value = metaMatch[2]
    if (key === 'due') {
      dueDate = value
    } else if (key !== 'terminator') {
      metadata[key] = value
    }
  }

  // Strip tags from text
  const text = raw
    .replace(/@\S+/g, '')
    .replace(/\+\S+/g, '')
    .replace(/#\S+/g, '')
    .replace(/\b[a-z][a-z0-9_-]*:[\S]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return { text, project, context, area, dueDate, metadata, terminatorLinks }
}
