import { z } from 'zod'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { parseFrontMatter, stringifyFrontMatter } from './front-matter'
import { noPayload, type ExtensionDB, type ExtensionAPI } from '@terminator/extension-sdk'
import { createIpcRegistrar } from './register'
import { reconcileTags } from './notes.ipc'

// ──────────────────────────────────────────────────────────────
// Pure utilities
// ──────────────────────────────────────────────────────────────

/** @internal */
export function toSlug(title: string, uuid: string): string {
  const uuid8 = uuid.replace(/-/g, '').slice(0, 8)
  const slugBase = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
  return `${slugBase}-${uuid8}`
}

// ──────────────────────────────────────────────────────────────
// Export
// ──────────────────────────────────────────────────────────────

const exportSchema = z.object({
  folder: z.string(),
  scope: z.enum(['all', 'note', 'tag']).optional(),
  noteId: z.string().optional(),
  tagId: z.string().optional(),
  includeFrontmatter: z.boolean().optional(),
  commentFormat: z.enum(['sidecar', 'inline', 'both', 'none']).optional(),
  overwriteById: z.boolean().optional(),
  includeDiagrams: z.boolean().optional(),
})

type NoteRow = {
  id: string
  title: string
  body: string
  created_at: string
  updated_at: string
  archived_at: string | null
  tags: string | null
}

type DiagramRow = {
  id: string
  title: string
  scene_json: string
  created_at: string
  updated_at: string
}

function buildExistingIdMap(folder: string): Map<string, string> {
  const map = new Map<string, string>() // id → filename
  const files = fs.existsSync(folder) ? fs.readdirSync(folder) : []
  for (const file of files) {
    if (!file.endsWith('.md')) continue
    try {
      const content = fs.readFileSync(path.join(folder, file), 'utf-8')
      const { data } = parseFrontMatter(content)
      if (typeof data.id === 'string') map.set(data.id, file)
    } catch {
      // skip unparseable files
    }
  }
  return map
}

type CommentFormat = NonNullable<z.infer<typeof exportSchema>['commentFormat']>

interface ExportedComment {
  id: string
  body: string
  quote: string | null
  status: string
  createdAt: string
  replies: { id: string; body: string; createdAt: string }[]
}

type CommentRow = {
  id: string
  parent_id: string | null
  body: string
  quote: string | null
  status: string
  created_at: string
}

/** A note's comment threads, each with its replies, oldest first. */
async function noteComments(db: ExtensionDB, noteId: string): Promise<ExportedComment[]> {
  const rows = await db.query<CommentRow>(
    `SELECT id, parent_id, body, quote, status, created_at FROM comments WHERE note_id=? ORDER BY created_at`,
    [noteId]
  )
  const repliesTo = (parentId: string) =>
    rows
      .filter((r) => r.parent_id === parentId)
      .map((r) => ({ id: r.id, body: r.body, createdAt: r.created_at }))
  return rows
    .filter((r) => r.parent_id === null)
    .map((r) => ({ ...rowFields(r), replies: repliesTo(r.id) }))
}

function rowFields(r: CommentRow): Omit<ExportedComment, 'replies'> {
  return { id: r.id, body: r.body, quote: r.quote, status: r.status, createdAt: r.created_at }
}

/** An HTML comment cannot contain "--", so a body that does is kept readable without it. */
function htmlComment(text: string): string {
  return `<!-- ${text.replace(/--/g, '- -')} -->`
}

/** The markdown with the comments appended as HTML comments, for the inline formats. */
function withInlineComments(
  markdown: string,
  comments: ExportedComment[],
  format: CommentFormat
): string {
  if (comments.length === 0 || (format !== 'inline' && format !== 'both')) return markdown
  const lines = comments.flatMap((c) => [
    htmlComment(`comment on "${c.quote ?? ''}": ${c.body}`),
    ...c.replies.map((r) => htmlComment(`reply: ${r.body}`)),
  ])
  return `${markdown.trimEnd()}\n\n${lines.join('\n')}\n`
}

/** Writes the comments to `<note>.comments.json` beside the note, for the sidecar formats. */
function writeSidecar(markdownPath: string, comments: ExportedComment[], format: CommentFormat) {
  if (comments.length === 0 || (format !== 'sidecar' && format !== 'both')) return
  const sidecarPath = markdownPath.replace(/\.md$/, '.comments.json')
  fs.writeFileSync(sidecarPath, JSON.stringify(comments, null, 2), 'utf-8')
}

type ExportArgs = z.infer<typeof exportSchema>

/** Where and how each note is written. */
interface NoteExport {
  folder: string
  existing: Map<string, string>
  overwriteById: boolean
  includeFrontmatter: boolean
  commentFormat: CommentFormat
}

/** The notes in the export's scope, newest first, each with its tags joined by commas. */
function scopedNotesQuery({ scope = 'all', noteId, tagId }: ExportArgs): {
  sql: string
  params: unknown[]
} {
  const select = `SELECT n.id, n.title, n.body, n.created_at, n.updated_at, n.archived_at,
                         GROUP_CONCAT(t.name, ',') AS tags
                  FROM notes n
                  LEFT JOIN note_tags nt ON nt.note_id = n.id
                  LEFT JOIN tags t ON t.id = nt.tag_id`
  const group =
    ' GROUP BY n.id, n.title, n.body, n.created_at, n.updated_at, n.archived_at ORDER BY n.updated_at DESC'
  if (scope === 'note' && noteId)
    return { sql: `${select} WHERE n.id = ?${group}`, params: [noteId] }
  if (scope === 'tag' && tagId) {
    const where = ' WHERE n.id IN (SELECT note_id FROM note_tags WHERE tag_id = ?)'
    return { sql: `${select}${where}${group}`, params: [tagId] }
  }
  return { sql: `${select}${group}`, params: [] }
}

function noteMarkdown(note: NoteRow, includeFrontmatter: boolean): string {
  if (!includeFrontmatter) return note.body
  const tags = note.tags ? note.tags.split(',').filter(Boolean) : []
  return stringifyFrontMatter(note.body, {
    id: note.id,
    title: note.title,
    tags,
    created: note.created_at,
    updated: note.updated_at,
  })
}

/** Writes one note, and its comments in the format asked for. */
async function exportNote(db: ExtensionDB, note: NoteRow, to: NoteExport): Promise<void> {
  const existingFilename = to.overwriteById ? to.existing.get(note.id) : undefined
  const filename = existingFilename ?? `${toSlug(note.title, note.id)}.md`
  const comments = to.commentFormat === 'none' ? [] : await noteComments(db, note.id)
  const markdownPath = path.join(to.folder, filename)
  const markdown = noteMarkdown(note, to.includeFrontmatter)
  fs.writeFileSync(markdownPath, withInlineComments(markdown, comments, to.commentFormat), 'utf-8')
  writeSidecar(markdownPath, comments, to.commentFormat)
}

/** A diagram as an .excalidraw file (https://docs.excalidraw.com/docs/codebase/json-schema). */
function excalidrawFile(sceneJson: string): Record<string, unknown> {
  let scene: Record<string, unknown> = {}
  try {
    scene = JSON.parse(sceneJson || '{}') as Record<string, unknown>
  } catch {
    // An unreadable scene exports as an empty one.
  }
  return {
    type: 'excalidraw',
    version: 2,
    source: 'terminator-notepad',
    elements: (scene.elements as unknown[]) ?? [],
    appState: (scene.appState as Record<string, unknown>) ?? {},
    files: {},
  }
}

/** Writes every active diagram into `diagrams/` under the folder; answers how many. */
async function exportDiagrams(db: ExtensionDB, folder: string): Promise<number> {
  const diagrams = await db.query<DiagramRow>(
    `SELECT id, title, scene_json, created_at, updated_at FROM diagrams WHERE archived_at IS NULL ORDER BY updated_at DESC`
  )
  const diagramsFolder = path.join(folder, 'diagrams')
  fs.mkdirSync(diagramsFolder, { recursive: true })
  for (const d of diagrams) {
    const file = path.join(diagramsFolder, `${toSlug(d.title, d.id)}.excalidraw`)
    fs.writeFileSync(file, JSON.stringify(excalidrawFile(d.scene_json), null, 2), 'utf-8')
  }
  return diagrams.length
}

/** @internal */
export async function exportNotes(
  db: ExtensionDB,
  args: ExportArgs
): Promise<{ data: { exported: number; diagrams: number } } | { error: string }> {
  const folder = args.folder.replace(/^~(?=$|\/)/, os.homedir())
  const { sql, params } = scopedNotesQuery(args)
  const notes = await db.query<NoteRow>(sql, params)
  const to: NoteExport = {
    folder,
    existing: buildExistingIdMap(folder),
    overwriteById: args.overwriteById ?? true,
    includeFrontmatter: args.includeFrontmatter ?? true,
    commentFormat: args.commentFormat ?? 'none',
  }
  fs.mkdirSync(folder, { recursive: true })
  for (const note of notes) await exportNote(db, note, to)

  const withDiagrams = args.includeDiagrams === true && (args.scope ?? 'all') === 'all'
  const diagrams = withDiagrams ? await exportDiagrams(db, folder) : 0
  return { data: { exported: notes.length, diagrams } }
}

// ──────────────────────────────────────────────────────────────
// Import
// ──────────────────────────────────────────────────────────────

const importSchema = z.object({ folder: z.string() })

type ImportOutcome = 'imported' | 'updated' | 'skipped'

/** A note read back from an exported file's front matter and body. */
interface ImportedNote {
  id: string
  title: string
  body: string
  tags: string[]
  createdAt: string
  updatedAt: string
}

/** @internal */
export async function importNotes(
  db: ExtensionDB,
  args: z.infer<typeof importSchema>
): Promise<{ data: { imported: number; updated: number; skipped: number } } | { error: string }> {
  const { folder } = args
  const counts: Record<ImportOutcome, number> = { imported: 0, updated: 0, skipped: 0 }

  const files = fs.existsSync(folder) ? fs.readdirSync(folder).filter((f) => f.endsWith('.md')) : []

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(folder, file), 'utf-8')
      counts[await importNoteFile(db, content)]++
    } catch {
      counts.skipped++
    }
  }

  return { data: counts }
}

async function importNoteFile(db: ExtensionDB, content: string): Promise<ImportOutcome> {
  const note = parseImportedNote(content)
  if (!note) return 'skipped'

  const existing = await db.get<{ id: string }>('SELECT id FROM notes WHERE id=?', [note.id])
  if (existing) {
    await updateImportedNote(db, note)
    return 'updated'
  }
  await insertImportedNote(db, note)
  return 'imported'
}

/** The note an exported file holds, or null when its front matter carries no id. */
function parseImportedNote(content: string): ImportedNote | null {
  const { data: fm, content: body } = parseFrontMatter(content)
  if (typeof fm.id !== 'string') return null

  const now = new Date().toISOString()
  return {
    id: fm.id,
    title: typeof fm.title === 'string' ? fm.title : 'Imported note',
    body: body.trim(),
    tags: Array.isArray(fm.tags) ? fm.tags : [],
    createdAt: typeof fm.created === 'string' ? fm.created : now,
    updatedAt: now,
  }
}

async function updateImportedNote(db: ExtensionDB, note: ImportedNote): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.run('UPDATE notes SET title=?, body=?, updated_at=? WHERE id=?', [
      note.title,
      note.body,
      note.updatedAt,
      note.id,
    ])
    await reconcileTags(tx, note.id, note.tags)
  })
}

async function insertImportedNote(db: ExtensionDB, note: ImportedNote): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.run(
      'INSERT INTO notes (id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [note.id, note.title, note.body, note.createdAt, note.updatedAt]
    )
    await reconcileTags(tx, note.id, note.tags)
  })
}

// ──────────────────────────────────────────────────────────────
// IPC Registration
// ──────────────────────────────────────────────────────────────

export function registerExportIpcHandlers(api: ExtensionAPI, db: ExtensionDB): () => void {
  const { handle, cleanup } = createIpcRegistrar(api)
  handle('terminator.notepad:export.pickFolder', noPayload, async () => {
    const result = await api.dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled) return { data: null }
    return { data: result.filePaths[0] }
  })

  handle('terminator.notepad:export.run', exportSchema, (args) => exportNotes(db, args))

  handle('terminator.notepad:import.run', importSchema, (args) => importNotes(db, args))

  return cleanup
}
