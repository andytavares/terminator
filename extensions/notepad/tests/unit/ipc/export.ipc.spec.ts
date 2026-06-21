import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ipcMain } from 'electron'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { PGlite } from '@electric-sql/pglite'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp') },
  dialog: {
    showOpenDialog: vi.fn().mockResolvedValue({ canceled: false, filePaths: ['/tmp/export-test'] }),
  },
}))

import { wrapDb } from '../../../../../src/main/db/index'
import { applyNotepadSchema } from '../../../src/db/db'
import {
  toSlug,
  exportNotes,
  importNotes,
  registerExportIpcHandlers,
} from '../../../src/ipc/export.ipc'
import type { ExtensionDB } from '../../../../../src/main/db/index'

let pg: PGlite
let db: ExtensionDB
let exportDir: string
let noteId: string

beforeEach(async () => {
  pg = new PGlite()
  await pg.waitReady
  db = wrapDb(pg)
  await applyNotepadSchema(db)
  exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-export-dest-'))

  noteId = '00000000-0000-0000-0000-000000000001'
  const now = new Date().toISOString()
  await db.run(
    'INSERT INTO notes (id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    [noteId, 'My Test Note', '# Hello\n\nThis is the note body.', now, now]
  )
})

afterEach(async () => {
  await pg.close()
  fs.rmSync(exportDir, { recursive: true, force: true })
})

describe('toSlug', () => {
  it('converts title to kebab-case with uuid8 suffix', () => {
    const slug = toSlug('My Test Note', '00000000-1234-5678-abcd-ef0123456789')
    expect(slug).toMatch(/^my-test-note-00000000$/)
  })

  it('strips special characters from title', () => {
    const slug = toSlug('Hello, World! (2026)', 'aabbccdd-0000-0000-0000-000000000000')
    expect(slug).toBe('hello-world-2026-aabbccdd')
  })

  it('truncates long titles', () => {
    const long = 'a'.repeat(100)
    const slug = toSlug(long, 'aabbccdd-0000-0000-0000-000000000000')
    expect(slug.length).toBeLessThanOrEqual(60)
  })
})

describe('exportNotes', () => {
  it('writes a .md file with YAML frontmatter for each note', async () => {
    const result = await exportNotes(db, { folder: exportDir, scope: 'all' })
    expect((result as { data: { exported: number } }).data.exported).toBe(1)

    const files = fs.readdirSync(exportDir).filter((f) => f.endsWith('.md'))
    expect(files).toHaveLength(1)

    const content = fs.readFileSync(path.join(exportDir, files[0]), 'utf-8')
    expect(content).toContain('---')
    expect(content).toContain(`id: ${noteId}`)
    expect(content).toContain('title:')
    expect(content).toContain('# Hello')
  })

  it('re-export overwrites existing file by id (idempotent)', async () => {
    await exportNotes(db, { folder: exportDir, scope: 'all' })
    const filesBefore = fs.readdirSync(exportDir).filter((f) => f.endsWith('.md'))

    await db.run('UPDATE notes SET body=?, updated_at=? WHERE id=?', [
      '# Updated\n\nNew content.',
      new Date().toISOString(),
      noteId,
    ])

    await exportNotes(db, { folder: exportDir, scope: 'all' })
    const filesAfter = fs.readdirSync(exportDir).filter((f) => f.endsWith('.md'))

    expect(filesAfter).toHaveLength(filesBefore.length)

    const content = fs.readFileSync(path.join(exportDir, filesAfter[0]), 'utf-8')
    expect(content).toContain('# Updated')
  })

  it('exports only the current note when scope is "note"', async () => {
    const now = new Date().toISOString()
    await db.run(
      'INSERT INTO notes (id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ['00000000-0000-0000-0000-000000000002', 'Second Note', 'body', now, now]
    )

    const result = await exportNotes(db, { folder: exportDir, scope: 'note', noteId })
    expect((result as { data: { exported: number } }).data.exported).toBe(1)

    const files = fs.readdirSync(exportDir).filter((f) => f.endsWith('.md'))
    expect(files).toHaveLength(1)
  })

  it('exports notes filtered by tag scope', async () => {
    const tagId = 'tag-00000000-0000-0000-0000-000000000001'
    await db.run('INSERT INTO tags (id, name) VALUES (?, ?)', [tagId, 'work'])
    await db.run('INSERT INTO note_tags (note_id, tag_id) VALUES (?, ?)', [noteId, tagId])

    const result = await exportNotes(db, { folder: exportDir, scope: 'tag', tagId })
    expect((result as { data: { exported: number } }).data.exported).toBe(1)
  })

  it('exports note with no tags', async () => {
    const result = await exportNotes(db, { folder: exportDir, scope: 'all' })
    expect((result as { data: { exported: number } }).data.exported).toBe(1)
  })

  it('creates target folder when it does not exist', async () => {
    const newDir = path.join(exportDir, 'subdir')
    const result = await exportNotes(db, { folder: newDir, scope: 'all' })
    expect((result as { data: { exported: number } }).data.exported).toBe(1)
    expect(fs.existsSync(newDir)).toBe(true)
  })

  it('returns error on validation failure', async () => {
    const result = await exportNotes(db, { folder: 123 as unknown as string })
    expect(result).toHaveProperty('error')
  })
})

describe('importNotes', () => {
  it('creates a note for each .md file with frontmatter id', async () => {
    const importDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-import-src-'))
    const frontmatter = `---\nid: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee\ntitle: Imported Note\ntags: []\ncreated: 2026-01-01T00:00:00Z\nupdated: 2026-01-02T00:00:00Z\n---\n\n# Imported\n\nHello from import.`
    fs.writeFileSync(path.join(importDir, 'imported-note-aaaaaaaa.md'), frontmatter)

    try {
      const result = await importNotes(db, { folder: importDir })
      expect((result as { data: { imported: number } }).data.imported).toBe(1)

      const row = await db.get<{ id: string; title: string }>(
        'SELECT id, title FROM notes WHERE id=?',
        ['aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee']
      )
      expect(row?.title).toBe('Imported Note')
    } finally {
      fs.rmSync(importDir, { recursive: true, force: true })
    }
  })

  it('updates an existing note when frontmatter id matches', async () => {
    await exportNotes(db, { folder: exportDir, scope: 'all' })

    const files = fs.readdirSync(exportDir).filter((f) => f.endsWith('.md'))
    const filePath = path.join(exportDir, files[0])
    const content = fs.readFileSync(filePath, 'utf-8')
    fs.writeFileSync(filePath, content.replace('Hello', 'Updated via import'))

    const result = await importNotes(db, { folder: exportDir })
    expect((result as { data: { updated: number } }).data.updated).toBe(1)

    const row = await db.get<{ body: string }>('SELECT body FROM notes WHERE id=?', [noteId])
    expect(row?.body).toContain('Updated via import')
  })

  it('creates note with tags and links note_tags rows', async () => {
    const importDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-import-tags-'))
    const fc = `---\nid: cccccccc-dddd-eeee-ffff-000000000001\ntitle: Tagged Note\ntags:\n  - work\n  - project\n---\n\nBody.`
    fs.writeFileSync(path.join(importDir, 'tagged-note.md'), fc)
    try {
      const result = await importNotes(db, { folder: importDir })
      expect((result as { data: { imported: number } }).data.imported).toBe(1)
      const tagRows = await db.query<{ name: string }>(
        `SELECT t.name FROM tags t JOIN note_tags nt ON nt.tag_id = t.id WHERE nt.note_id = ?`,
        ['cccccccc-dddd-eeee-ffff-000000000001']
      )
      const tagNames = tagRows.map((r) => r.name).sort()
      expect(tagNames).toEqual(['project', 'work'])
    } finally {
      fs.rmSync(importDir, { recursive: true, force: true })
    }
  })

  it('updates existing note tags on re-import', async () => {
    await exportNotes(db, { folder: exportDir, scope: 'all' })
    const files = fs.readdirSync(exportDir).filter((f) => f.endsWith('.md'))
    const filePath = path.join(exportDir, files[0])
    const updatedContent = `---\nid: ${noteId}\ntitle: My Test Note\ntags:\n  - updated-tag\n---\n\n# Hello\n\nUpdated.`
    fs.writeFileSync(filePath, updatedContent)
    const result = await importNotes(db, { folder: exportDir })
    expect((result as { data: { updated: number } }).data.updated).toBe(1)
    const tagRows = await db.query<{ name: string }>(
      `SELECT t.name FROM tags t JOIN note_tags nt ON nt.tag_id = t.id WHERE nt.note_id = ?`,
      [noteId]
    )
    expect(tagRows.map((r) => r.name)).toContain('updated-tag')
  })

  it('skips files with no frontmatter id gracefully', async () => {
    const importDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-import-bad-'))
    fs.writeFileSync(
      path.join(importDir, 'no-frontmatter.md'),
      '# Just a heading\n\nNo frontmatter here.'
    )
    try {
      const result = await importNotes(db, { folder: importDir })
      const data = (result as { data: { imported: number; skipped: number } }).data
      expect(data.imported).toBe(0)
      expect(data.skipped).toBe(1)
    } finally {
      fs.rmSync(importDir, { recursive: true, force: true })
    }
  })

  it('returns error on validation failure', async () => {
    const result = await importNotes(db, { folder: 123 as unknown as string })
    expect(result).toHaveProperty('error')
  })

  it('handles import folder that does not exist', async () => {
    const result = await importNotes(db, { folder: '/tmp/nonexistent-folder-xyz-12345' })
    const data = (result as { data: { imported: number; skipped: number } }).data
    expect(data.imported).toBe(0)
    expect(data.skipped).toBe(0)
  })

  it('skips non-.md files in import folder', async () => {
    const importDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-import-nonmd-'))
    fs.writeFileSync(path.join(importDir, 'readme.txt'), 'not a markdown file')
    try {
      const result = await importNotes(db, { folder: importDir })
      const data = (result as { data: { imported: number } }).data
      expect(data.imported).toBe(0)
    } finally {
      fs.rmSync(importDir, { recursive: true, force: true })
    }
  })

  it('imports note with missing title and non-array tags (uses defaults)', async () => {
    const importDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-import-defaults-'))
    const fc = `---\nid: bbbbbbbb-cccc-dddd-eeee-ffffffffffff\n---\n\nBody text.`
    fs.writeFileSync(path.join(importDir, 'no-title.md'), fc)
    try {
      const result = await importNotes(db, { folder: importDir })
      const data = (result as { data: { imported: number } }).data
      expect(data.imported).toBe(1)
      const row = await db.get<{ title: string }>('SELECT title FROM notes WHERE id=?', [
        'bbbbbbbb-cccc-dddd-eeee-ffffffffffff',
      ])
      expect(row?.title).toBe('Imported note')
    } finally {
      fs.rmSync(importDir, { recursive: true, force: true })
    }
  })
})

describe('exportNotes with includeDiagrams', () => {
  it('exports diagrams as .excalidraw files in a diagrams/ subfolder', async () => {
    const now = new Date().toISOString()
    const diagramId = 'dddddddd-0000-0000-0000-000000000001'
    const sceneJson = JSON.stringify({
      elements: [{ type: 'rectangle', id: 'el1' }],
      appState: { zoom: 1 },
    })
    await db.run(
      'INSERT INTO diagrams (id, title, tags, scene_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [diagramId, 'My Diagram', '[]', sceneJson, now, now]
    )

    const result = await exportNotes(db, {
      folder: exportDir,
      scope: 'all',
      includeDiagrams: true,
    })
    const data = (result as { data: { exported: number; diagrams: number } }).data
    expect(data.diagrams).toBe(1)

    const diagramsFolder = path.join(exportDir, 'diagrams')
    const files = fs.readdirSync(diagramsFolder)
    expect(files.some((f) => f.endsWith('.excalidraw'))).toBe(true)

    const content = JSON.parse(fs.readFileSync(path.join(diagramsFolder, files[0]), 'utf-8')) as {
      type: string
      elements: unknown[]
    }
    expect(content.type).toBe('excalidraw')
    expect(content.elements).toHaveLength(1)
  })

  it('does not export diagrams when includeDiagrams is false', async () => {
    const result = await exportNotes(db, {
      folder: exportDir,
      scope: 'all',
      includeDiagrams: false,
    })
    const data = (result as { data: { diagrams: number } }).data
    expect(data.diagrams).toBe(0)
    expect(fs.existsSync(path.join(exportDir, 'diagrams'))).toBe(false)
  })

  it('does not export diagrams when scope is note', async () => {
    const result = await exportNotes(db, {
      folder: exportDir,
      scope: 'note',
      noteId,
      includeDiagrams: true,
    })
    const data = (result as { data: { diagrams: number } }).data
    expect(data.diagrams).toBe(0)
  })
})

describe('registerExportIpcHandlers', () => {
  it('returns a dispose function', () => {
    const dispose = registerExportIpcHandlers(db)
    expect(typeof dispose).toBe('function')
    dispose()
  })

  it('registers IPC channels on setup', () => {
    vi.mocked(ipcMain.handle).mockClear()
    const dispose = registerExportIpcHandlers(db)
    expect(ipcMain.handle).toHaveBeenCalledWith(
      'terminator.notepad:export.run',
      expect.any(Function)
    )
    dispose()
  })
})
