import matter from 'gray-matter'
import type { Task, Event, Note, TaskStatus } from './types'

const STATUS_MAP: Record<string, TaskStatus> = {
  ' ': 'open',
  x: 'done',
  X: 'done',
  '>': 'migrated',
  '-': 'cancelled',
  '/': 'in-progress',
}

const TASK_RE = /^- \[([^\]])\] (.*)$/
const SUBTASK_RE = /^ {2,}- \[([^\]])\] (.*)$/
const EVENT_RE = /^o (?:(\d{2}:\d{2}) )?(.+)$/
const NOTE_RE = /^\* (.+)$/
const TAG_PROJECT = /@(\S+)/g
const TAG_CONTEXT = /\+(\S+)/g
const TAG_AREA = /#(\S+)/g
const TAG_META = /\b([a-z][a-z0-9_-]*):([\S]+)/g
const TERMINATOR_LINK_RE =
  /terminator:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi

export interface ParseResult {
  tasks: Task[]
  events: Event[]
  notes: Note[]
  frontmatter?: Record<string, unknown>
}

export function parseFile(content: string, filePath: string): ParseResult {
  let body = content
  let frontmatter: Record<string, unknown> | undefined

  try {
    const parsed = matter(content)
    body = parsed.content
    if (parsed.data && Object.keys(parsed.data).length > 0) {
      frontmatter = parsed.data as Record<string, unknown>
    }
  } catch {
    // malformed frontmatter — parse body as-is
  }

  const tasks: Task[] = []
  const events: Event[] = []
  const notes: Note[] = []

  const lines = body.split('\n')
  let lineOffset = 0

  // Calculate line offset caused by frontmatter block
  if (frontmatter !== undefined) {
    const rawLines = content.split('\n')
    const bodyLines = body.split('\n')
    lineOffset = rawLines.length - bodyLines.length
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNum = i + 1 + lineOffset

    const taskMatch = TASK_RE.exec(line)
    if (taskMatch) {
      const marker = taskMatch[1]
      const rawText = taskMatch[2]
      const status: TaskStatus = STATUS_MAP[marker] ?? 'open'
      const { text, project, context, area, dueDate, metadata, terminatorLinks } =
        extractTags(rawText)
      tasks.push({
        id: `${filePath}:${lineNum}`,
        filePath,
        line: lineNum,
        status,
        text,
        project,
        context,
        area,
        dueDate,
        metadata,
        terminatorLinks,
      })
      continue
    }

    const subtaskMatch = SUBTASK_RE.exec(line)
    if (subtaskMatch && tasks.length > 0) {
      const marker = subtaskMatch[1]
      const rawText = subtaskMatch[2]
      const status: TaskStatus = STATUS_MAP[marker] ?? 'open'
      const { text, project, context, area, dueDate, metadata, terminatorLinks } =
        extractTags(rawText)
      const subtask: Task = {
        id: `${filePath}:${lineNum}`,
        filePath,
        line: lineNum,
        status,
        text,
        project,
        context,
        area,
        dueDate,
        metadata,
        terminatorLinks,
      }
      const lastTask = tasks[tasks.length - 1]
      if (!lastTask.subtasks) lastTask.subtasks = []
      lastTask.subtasks.push(subtask)
      continue
    }

    const eventMatch = EVENT_RE.exec(line)
    if (eventMatch) {
      events.push({ time: eventMatch[1] ?? undefined, text: eventMatch[2] })
      continue
    }

    const noteMatch = NOTE_RE.exec(line)
    if (noteMatch) {
      notes.push({ text: noteMatch[1] })
    }
  }

  return { tasks, events, notes, frontmatter }
}

function extractTags(raw: string): {
  text: string
  project?: string
  context?: string
  area?: string
  dueDate?: string
  metadata: Record<string, string>
  terminatorLinks: string[]
} {
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

  let text = raw

  // Extract +project (first occurrence)
  TAG_PROJECT.lastIndex = 0
  const projMatch = TAG_PROJECT.exec(raw)
  if (projMatch) project = projMatch[1]

  // Extract @context (first occurrence)
  TAG_CONTEXT.lastIndex = 0
  const ctxMatch = TAG_CONTEXT.exec(raw)
  if (ctxMatch) context = ctxMatch[1]

  // Extract #area (first occurrence)
  TAG_AREA.lastIndex = 0
  const areaMatch = TAG_AREA.exec(raw)
  if (areaMatch) area = areaMatch[1]

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
  text = text
    .replace(/@\S+/g, '')
    .replace(/\+\S+/g, '')
    .replace(/#\S+/g, '')
    .replace(/\b[a-z][a-z0-9_-]*:[\S]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return { text, project, context, area, dueDate, metadata, terminatorLinks }
}

export function validateCaptureText(text: string): boolean {
  return text.trim().length > 0
}

export function suggestDestination(
  text: string,
  index: { tasks: { filePath: string; area?: string; project?: string }[] }
): { tags: { project?: string; context?: string; area?: string }; destination?: string } {
  const tags: { project?: string; context?: string; area?: string } = {}

  // @ = project, + = context, # = area
  TAG_PROJECT.lastIndex = 0
  const proj = TAG_PROJECT.exec(text)
  if (proj) tags.project = proj[1]

  TAG_CONTEXT.lastIndex = 0
  const ctx = TAG_CONTEXT.exec(text)
  if (ctx) tags.context = ctx[1]

  TAG_AREA.lastIndex = 0
  const areaTag = TAG_AREA.exec(text)
  if (areaTag) tags.area = areaTag[1]

  let destination: string | undefined
  if (tags.area) {
    const match = index.tasks.find((t) => t.area === tags.area)
    if (match) destination = match.filePath
  }

  return { tags, destination }
}
