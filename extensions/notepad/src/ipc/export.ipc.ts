import { ipcMain, dialog } from 'electron'
import { z } from 'zod'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import matter from 'gray-matter'
import { randomUUID } from '../db/db'
import type { ExtensionDB } from '../../../../src/main/db/index'

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

interface NoteRow {
  id: string
  title: string
  body: string
  created_at: string
  updated_at: string
  archived_at: string | null
  tags: string | null
}

interface DiagramRow {
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
      const { data } = matter(content)
      if (typeof data.id === 'string') map.set(data.id, file)
    } catch {
      // skip unparseable files
    }
  }
  return map
}

export async function exportNotes(
  db: ExtensionDB,
  payload: unknown
): Promise<{ data: { exported: number; diagrams: number } } | { error: string }> {
  const parsed = exportSchema.safeParse(payload)
  if (!parsed.success) return { error: 'VALIDATION_ERROR' }

  const {
    folder,
    scope = 'all',
    noteId,
    tagId,
    includeFrontmatter = true,
    overwriteById = true,
    includeDiagrams = false,
  } = parsed.data
  const resolvedFolder = folder.replace(/^~(?=$|\/)/, os.homedir())

  // STRING_AGG is Postgres-specific (replaces SQLite GROUP_CONCAT); correct for PGlite.
  let querySql = `SELECT n.id, n.title, n.body, n.created_at, n.updated_at, n.archived_at,
                         STRING_AGG(t.name, ',') AS tags
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

  const notes = await db.query<NoteRow>(querySql, params)

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

  let diagramsExported = 0
  if (includeDiagrams && scope === 'all') {
    const diagrams = await db.query<DiagramRow>(
      `SELECT id, title, scene_json, created_at, updated_at FROM diagrams WHERE archived_at IS NULL ORDER BY updated_at DESC`
    )
    const diagramsFolder = path.join(resolvedFolder, 'diagrams')
    fs.mkdirSync(diagramsFolder, { recursive: true })
    for (const d of diagrams) {
      const slug = toSlug(d.title, d.id)
      let sceneData: Record<string, unknown> = {}
      try {
        sceneData = JSON.parse(d.scene_json || '{}') as Record<string, unknown>
      } catch {
        // use empty scene
      }
      const excalidrawFile = {
        type: 'excalidraw',
        version: 2,
        source: 'terminator-notepad',
        elements: (sceneData.elements as unknown[]) ?? [],
        appState: (sceneData.appState as Record<string, unknown>) ?? {},
        files: {},
      }
      fs.writeFileSync(
        path.join(diagramsFolder, `${slug}.excalidraw`),
        JSON.stringify(excalidrawFile, null, 2),
        'utf-8'
      )
      diagramsExported++
    }
  }

  return { data: { exported: notes.length, diagrams: diagramsExported } }
}

// ──────────────────────────────────────────────────────────────
// Import
// ──────────────────────────────────────────────────────────────

const importSchema = z.object({ folder: z.string() })

export async function importNotes(
  db: ExtensionDB,
  payload: unknown
): Promise<{ data: { imported: number; updated: number; skipped: number } } | { error: string }> {
  const parsed = importSchema.safeParse(payload)
  if (!parsed.success) return { error: 'VALIDATION_ERROR' }

  const { folder } = parsed.data
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

      const existing = await db.get<{ id: string }>('SELECT id FROM notes WHERE id=?', [id])

      if (existing) {
        await db.transaction(async (tx) => {
          await tx.run('UPDATE notes SET title=?, body=?, updated_at=? WHERE id=?', [
            title,
            body.trim(),
            updatedAt,
            id,
          ])
          await tx.run('DELETE FROM note_tags WHERE note_id=?', [id])
          for (const tagName of tags) {
            const normalized = tagName.toLowerCase().trim()
            if (!normalized) continue
            let tagRow = await tx.get<{ id: string }>('SELECT id FROM tags WHERE name=?', [
              normalized,
            ])
            if (!tagRow) {
              const tagId = randomUUID()
              await tx.run('INSERT INTO tags (id, name) VALUES (?, ?)', [tagId, normalized])
              tagRow = { id: tagId }
            }
            await tx.run(
              'INSERT INTO note_tags (note_id, tag_id) VALUES (?, ?) ON CONFLICT DO NOTHING',
              [id, tagRow.id]
            )
          }
        })
        updated++
      } else {
        await db.transaction(async (tx) => {
          await tx.run(
            'INSERT INTO notes (id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
            [id, title, body.trim(), createdAt, updatedAt]
          )
          for (const tagName of tags) {
            const normalized = tagName.toLowerCase().trim()
            if (!normalized) continue
            let tagRow = await tx.get<{ id: string }>('SELECT id FROM tags WHERE name=?', [
              normalized,
            ])
            if (!tagRow) {
              const tagId = randomUUID()
              await tx.run('INSERT INTO tags (id, name) VALUES (?, ?)', [tagId, normalized])
              tagRow = { id: tagId }
            }
            await tx.run(
              'INSERT INTO note_tags (note_id, tag_id) VALUES (?, ?) ON CONFLICT DO NOTHING',
              [id, tagRow.id]
            )
          }
        })
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

export function registerExportIpcHandlers(db: ExtensionDB): () => void {
  ipcMain.handle('terminator.notepad:export.pickFolder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled) return { data: null }
    return { data: result.filePaths[0] }
  })

  ipcMain.handle('terminator.notepad:export.run', (_evt, payload: unknown) =>
    exportNotes(db, payload)
  )

  ipcMain.handle('terminator.notepad:import.run', (_evt, payload: unknown) =>
    importNotes(db, payload)
  )

  return () => {
    ipcMain.removeHandler('terminator.notepad:export.pickFolder')
    ipcMain.removeHandler('terminator.notepad:export.run')
    ipcMain.removeHandler('terminator.notepad:import.run')
  }
}
