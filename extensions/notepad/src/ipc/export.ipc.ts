import { ipcMain, dialog } from 'electron'
import { z } from 'zod'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import matter from 'gray-matter'
import { getDb, randomUUID, insertFts } from '../db/db'

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
})

interface NoteRow {
  id: string
  title: string
  body: string
  created_at: string
  updated_at: string
  archived_at: string | null
  rowid: number
  tags: string | null
}

function buildExistingIdMap(folder: string): Map<string, string> {
  const map = new Map<string, string>() // id → filename
  const files = fs.existsSync(folder) ? fs.readdirSync(folder) : []
  for (const file of files) {
    if (!file.endsWith('.md')) continue
    try {
      const content = fs.readFileSync(path.join(folder, file), 'utf-8')
      const { data } = matter(content)
      if (typeof data.id === 'string') map.set(data.id, file)
    } catch {
      // skip unparseable files
    }
  }
  return map
}

export async function exportNotes(
  payload: unknown
): Promise<{ data: { exported: number } } | { error: string }> {
  const parsed = exportSchema.safeParse(payload)
  if (!parsed.success) return { error: 'VALIDATION_ERROR' }

  const {
    folder,
    scope = 'all',
    noteId,
    tagId,
    includeFrontmatter = true,
    overwriteById = true,
  } = parsed.data
  const resolvedFolder = folder.replace(/^~(?=$|\/)/, os.homedir())

  const db = getDb()
  let query = `SELECT n.id, n.title, n.body, n.created_at, n.updated_at, n.archived_at, n.rowid,
                      GROUP_CONCAT(t.name, ',') AS tags
               FROM notes n
               LEFT JOIN note_tags nt ON nt.note_id = n.id
               LEFT JOIN tags t ON t.id = nt.tag_id`

  const params: unknown[] = []

  if (scope === 'note' && noteId) {
    query += ' WHERE n.id = ?'
    params.push(noteId)
  } else if (scope === 'tag' && tagId) {
    query += ' WHERE n.id IN (SELECT note_id FROM note_tags WHERE tag_id = ?)'
    params.push(tagId)
  }

  query += ' GROUP BY n.id ORDER BY n.updated_at DESC'

  const notes = db.prepare(query).all(...params) as NoteRow[]

  // Build map of existing files by id for idempotent re-export
  const existingMap = buildExistingIdMap(resolvedFolder)

  fs.mkdirSync(resolvedFolder, { recursive: true })

  for (const note of notes) {
    const tags = note.tags ? note.tags.split(',').filter(Boolean) : []
    const slug = toSlug(note.title, note.id)
    const existingFilename = overwriteById ? existingMap.get(note.id) : undefined
    const filename = existingFilename ?? `${slug}.md`

    let fileContent: string
    if (includeFrontmatter) {
      const frontmatter = {
        id: note.id,
        title: note.title,
        tags,
        created: note.created_at,
        updated: note.updated_at,
      }
      fileContent = matter.stringify(note.body, frontmatter)
    } else {
      fileContent = note.body
    }

    fs.writeFileSync(path.join(resolvedFolder, filename), fileContent, 'utf-8')
  }

  return { data: { exported: notes.length } }
}

// ──────────────────────────────────────────────────────────────
// Import
// ──────────────────────────────────────────────────────────────

const importSchema = z.object({ folder: z.string() })

export async function importNotes(
  payload: unknown
): Promise<{ data: { imported: number; updated: number; skipped: number } } | { error: string }> {
  const parsed = importSchema.safeParse(payload)
  if (!parsed.success) return { error: 'VALIDATION_ERROR' }

  const { folder } = parsed.data
  const db = getDb()
  let imported = 0
  let updated = 0
  let skipped = 0

  const files = fs.existsSync(folder) ? fs.readdirSync(folder).filter((f) => f.endsWith('.md')) : []

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(folder, file), 'utf-8')
      const { data: fm, content: body } = matter(content)

      if (typeof fm.id !== 'string') {
        skipped++
        continue
      }

      const id = fm.id
      const title = typeof fm.title === 'string' ? fm.title : 'Imported note'
      const tags: string[] = Array.isArray(fm.tags) ? fm.tags : []
      const now = new Date().toISOString()
      const createdAt = typeof fm.created === 'string' ? fm.created : now
      const updatedAt = now

      const existing = db.prepare('SELECT rowid FROM notes WHERE id=?').get(id) as
        | { rowid: number }
        | undefined

      if (existing) {
        db.transaction(() => {
          db.prepare('UPDATE notes SET title=?, body=?, updated_at=? WHERE id=?').run(
            title,
            body.trim(),
            updatedAt,
            id
          )
          insertFts(db, existing.rowid, title, body.trim(), tags.join(','))
          db.prepare('DELETE FROM note_tags WHERE note_id=?').run(id)
          for (const tagName of tags) {
            const normalized = tagName.toLowerCase().trim()
            if (!normalized) continue
            let tagRow = db.prepare('SELECT id FROM tags WHERE name=?').get(normalized) as
              | { id: string }
              | undefined
            if (!tagRow) {
              const tagId = randomUUID()
              db.prepare('INSERT INTO tags (id, name) VALUES (?, ?)').run(tagId, normalized)
              tagRow = { id: tagId }
            }
            db.prepare('INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)').run(
              id,
              tagRow.id
            )
          }
        })()
        updated++
      } else {
        const newId = id
        db.transaction(() => {
          db.prepare(
            'INSERT INTO notes (id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
          ).run(newId, title, body.trim(), createdAt, updatedAt)

          for (const tagName of tags) {
            const normalized = tagName.toLowerCase().trim()
            if (!normalized) continue
            let tagRow = db.prepare('SELECT id FROM tags WHERE name=?').get(normalized) as
              | { id: string }
              | undefined
            if (!tagRow) {
              const tagId = randomUUID()
              db.prepare('INSERT INTO tags (id, name) VALUES (?, ?)').run(tagId, normalized)
              tagRow = { id: tagId }
            }
            db.prepare('INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)').run(
              newId,
              tagRow.id
            )
          }

          const noteRow = db.prepare('SELECT rowid FROM notes WHERE id=?').get(newId) as {
            rowid: number
          }
          insertFts(db, noteRow.rowid, title, body.trim(), tags.join(','))
        })()
        imported++
      }
    } catch {
      skipped++
    }
  }

  return { data: { imported, updated, skipped } }
}

// ──────────────────────────────────────────────────────────────
// IPC Registration
// ──────────────────────────────────────────────────────────────

export function registerExportIpcHandlers(): () => void {
  ipcMain.handle('terminator.notepad:export.pickFolder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled) return { data: null }
    return { data: result.filePaths[0] }
  })

  ipcMain.handle('terminator.notepad:export.run', (_evt, payload: unknown) => exportNotes(payload))

  ipcMain.handle('terminator.notepad:import.run', (_evt, payload: unknown) => importNotes(payload))

  return () => {
    ipcMain.removeHandler('terminator.notepad:export.pickFolder')
    ipcMain.removeHandler('terminator.notepad:export.run')
    ipcMain.removeHandler('terminator.notepad:import.run')
  }
}
