import { z } from 'zod'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { parseFrontMatter, stringifyFrontMatter } from './front-matter'
import { randomUUID } from '../db/db'
import { noPayload, type ExtensionDB, type ExtensionAPI } from '@terminator/extension-sdk'
import { createIpcRegistrar } from './register'

// ──────────────────────────────────────────────────────────────
// Pure utilities
// ──────────────────────────────────────────────────────────────

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

/** Where and how the notes of one export are written. */
interface NoteFileTarget {
  folder: string
  existingMap: Map<string, string>
  includeFrontmatter: boolean
  overwriteById: boolean
}

type ExportArgs = z.infer<typeof exportSchema>

export async function exportNotes(
  db: ExtensionDB,
  args: ExportArgs
): Promise<{ data: { exported: number; diagrams: number } } | { error: string }> {
  const { scope = 'all', includeFrontmatter = true, overwriteById = true } = args
  const resolvedFolder = args.folder.replace(/^~(?=$|\/)/, os.homedir())

  const notes = await queryExportedNotes(db, args)

  const existingMap = buildExistingIdMap(resolvedFolder)
  fs.mkdirSync(resolvedFolder, { recursive: true })
  const target = { folder: resolvedFolder, existingMap, includeFrontmatter, overwriteById }
  for (const note of notes) writeNoteFile(note, target)

  const diagramsExported =
    args.includeDiagrams && scope === 'all' ? await exportDiagrams(db, resolvedFolder) : 0

  return { data: { exported: notes.length, diagrams: diagramsExported } }
}

/** The notes the export's scope selects: all of them, one note, or one tag's notes. */
async function queryExportedNotes(db: ExtensionDB, args: ExportArgs): Promise<NoteRow[]> {
  const { scope = 'all', noteId, tagId } = args
  let querySql = `SELECT n.id, n.title, n.body, n.created_at, n.updated_at, n.archived_at,
                         GROUP_CONCAT(t.name, ',') AS tags
                  FROM notes n
                  LEFT JOIN note_tags nt ON nt.note_id = n.id
                  LEFT JOIN tags t ON t.id = nt.tag_id`

  const params: unknown[] = []

  if (scope === 'note' && noteId) {
    querySql += ' WHERE n.id = ?'
    params.push(noteId)
  } else if (scope === 'tag' && tagId) {
    querySql += ' WHERE n.id IN (SELECT note_id FROM note_tags WHERE tag_id = ?)'
    params.push(tagId)
  }

  querySql +=
    ' GROUP BY n.id, n.title, n.body, n.created_at, n.updated_at, n.archived_at ORDER BY n.updated_at DESC'

  return db.query<NoteRow>(querySql, params)
}

function writeNoteFile(note: NoteRow, target: NoteFileTarget): void {
  const tags = note.tags ? note.tags.split(',').filter(Boolean) : []
  const slug = toSlug(note.title, note.id)
  const existingFilename = target.overwriteById ? target.existingMap.get(note.id) : undefined
  const filename = existingFilename ?? `${slug}.md`

  let fileContent: string
  if (target.includeFrontmatter) {
    const frontmatter = {
      id: note.id,
      title: note.title,
      tags,
      created: note.created_at,
      updated: note.updated_at,
    }
    fileContent = stringifyFrontMatter(note.body, frontmatter)
  } else {
    fileContent = note.body
  }

  fs.writeFileSync(path.join(target.folder, filename), fileContent, 'utf-8')
}

/** Writes every unarchived diagram as an .excalidraw file; returns how many. */
async function exportDiagrams(db: ExtensionDB, folder: string): Promise<number> {
  const diagrams = await db.query<DiagramRow>(
    `SELECT id, title, scene_json, created_at, updated_at FROM diagrams WHERE archived_at IS NULL ORDER BY updated_at DESC`
  )
  const diagramsFolder = path.join(folder, 'diagrams')
  fs.mkdirSync(diagramsFolder, { recursive: true })
  for (const d of diagrams) {
    fs.writeFileSync(
      path.join(diagramsFolder, `${toSlug(d.title, d.id)}.excalidraw`),
      JSON.stringify(excalidrawFileOf(d), null, 2),
      'utf-8'
    )
  }
  return diagrams.length
}

function excalidrawFileOf(d: DiagramRow) {
  let sceneData: Record<string, unknown> = {}
  try {
    sceneData = JSON.parse(d.scene_json || '{}') as Record<string, unknown>
  } catch {
    // use empty scene
  }
  return {
    type: 'excalidraw',
    version: 2,
    source: 'terminator-notepad',
    elements: (sceneData.elements as unknown[]) ?? [],
    appState: (sceneData.appState as Record<string, unknown>) ?? {},
    files: {},
  }
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
    await tx.run('DELETE FROM note_tags WHERE note_id=?', [note.id])
    await linkImportedTags(tx, note)
  })
}

async function insertImportedNote(db: ExtensionDB, note: ImportedNote): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.run(
      'INSERT INTO notes (id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [note.id, note.title, note.body, note.createdAt, note.updatedAt]
    )
    await linkImportedTags(tx, note)
  })
}

type ImportTransaction = Parameters<Parameters<ExtensionDB['transaction']>[0]>[0]

/** Tags the note with each named tag, creating the tags that do not exist yet. */
async function linkImportedTags(tx: ImportTransaction, note: ImportedNote): Promise<void> {
  for (const tagName of note.tags) {
    const normalized = tagName.toLowerCase().trim()
    if (!normalized) continue
    let tagRow = await tx.get<{ id: string }>('SELECT id FROM tags WHERE name=?', [normalized])
    if (!tagRow) {
      const tagId = randomUUID()
      await tx.run('INSERT INTO tags (id, name) VALUES (?, ?)', [tagId, normalized])
      tagRow = { id: tagId }
    }
    await tx.run('INSERT INTO note_tags (note_id, tag_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [
      note.id,
      tagRow.id,
    ])
  }
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
