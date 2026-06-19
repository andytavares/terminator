import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ipcMain } from 'electron'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp') },
  dialog: {
    showOpenDialog: vi.fn().mockResolvedValue({ canceled: false, filePaths: ['/tmp/export-test'] }),
  },
}))

import { initDb, closeDb, getDb } from '../../../src/db/db'
import {
  toSlug,
  exportNotes,
  importNotes,
  registerExportIpcHandlers,
} from '../../../src/ipc/export.ipc'

let tmpDir: string
let exportDir: string
let noteId: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-export-test-'))
  exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-export-dest-'))
  initDb(tmpDir)

  const db = getDb()
  const now = new Date().toISOString()
  noteId = '00000000-0000-0000-0000-000000000001'
  db.prepare(
    'INSERT INTO notes (id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).run(noteId, 'My Test Note', '# Hello\n\nThis is the note body.', now, now)
})

afterEach(() => {
  closeDb()
  fs.rmSync(tmpDir, { recursive: true, force: true })
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
    const result = await exportNotes({ folder: exportDir, scope: 'all' })
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
    await exportNotes({ folder: exportDir, scope: 'all' })
    const filesBefore = fs.readdirSync(exportDir).filter((f) => f.endsWith('.md'))

    // Update the note body
    const db = getDb()
    db.prepare('UPDATE notes SET body=?, updated_at=? WHERE id=?').run(
      '# Updated\n\nNew content.',
      new Date().toISOString(),
      noteId
    )

    await exportNotes({ folder: exportDir, scope: 'all' })
    const filesAfter = fs.readdirSync(exportDir).filter((f) => f.endsWith('.md'))

    // Should not create duplicate files
    expect(filesAfter).toHaveLength(filesBefore.length)

    const content = fs.readFileSync(path.join(exportDir, filesAfter[0]), 'utf-8')
    expect(content).toContain('# Updated')
  })

  it('exports only the current note when scope is "note"', async () => {
    // Add a second note
    const db = getDb()
    const now = new Date().toISOString()
    db.prepare(
      'INSERT INTO notes (id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run('00000000-0000-0000-0000-000000000002', 'Second Note', 'body', now, now)

    const result = await exportNotes({ folder: exportDir, scope: 'note', noteId })
    expect((result as { data: { exported: number } }).data.exported).toBe(1)

    const files = fs.readdirSync(exportDir).filter((f) => f.endsWith('.md'))
    expect(files).toHaveLength(1)
  })

  it('exports notes filtered by tag scope', async () => {
    const db = getDb()
    const tagId = 'tag-00000000-0000-0000-0000-000000000001'
    db.prepare('INSERT INTO tags (id, name) VALUES (?, ?)').run(tagId, 'work')
    db.prepare('INSERT INTO note_tags (note_id, tag_id) VALUES (?, ?)').run(noteId, tagId)

    const result = await exportNotes({ folder: exportDir, scope: 'tag', tagId })
    expect((result as { data: { exported: number } }).data.exported).toBe(1)
  })

  it('exports note with no tags (null tags row)', async () => {
    const result = await exportNotes({ folder: exportDir, scope: 'all' })
    expect((result as { data: { exported: number } }).data.exported).toBe(1)
  })

  it('re-exports to a non-existent target folder (creates it)', async () => {
    const newDir = path.join(exportDir, 'subdir')
    const result = await exportNotes({ folder: newDir, scope: 'all' })
    expect((result as { data: { exported: number } }).data.exported).toBe(1)
    expect(fs.existsSync(newDir)).toBe(true)
  })

  it('returns error on validation failure', async () => {
    const result = await exportNotes({ folder: 123 as unknown as string })
    expect(result).toHaveProperty('error')
  })
})

describe('importNotes', () => {
  it('creates a note for each .md file with frontmatter id', async () => {
    // Create an import source folder with a markdown file
    const importDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-import-src-'))
    const frontmatter = `---\nid: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee\ntitle: Imported Note\ntags: []\ncreated: 2026-01-01T00:00:00Z\nupdated: 2026-01-02T00:00:00Z\n---\n\n# Imported\n\nHello from import.`
    fs.writeFileSync(path.join(importDir, 'imported-note-aaaaaaaa.md'), frontmatter)

    try {
      const result = await importNotes({ folder: importDir })
      expect((result as { data: { imported: number; updated: number } }).data.imported).toBe(1)

      const db = getDb()
      const row = db
        .prepare('SELECT id, title FROM notes WHERE id=?')
        .get('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee') as { id: string; title: string } | undefined
      expect(row?.title).toBe('Imported Note')
    } finally {
      fs.rmSync(importDir, { recursive: true, force: true })
    }
  })

  it('updates an existing note when frontmatter id matches', async () => {
    // First export, then re-import with modified content
    await exportNotes({ folder: exportDir, scope: 'all' })

    // Modify the exported file
    const files = fs.readdirSync(exportDir).filter((f) => f.endsWith('.md'))
    const filePath = path.join(exportDir, files[0])
    const content = fs.readFileSync(filePath, 'utf-8')
    fs.writeFileSync(filePath, content.replace('Hello', 'Updated via import'))

    const result = await importNotes({ folder: exportDir })
    expect((result as { data: { imported: number; updated: number } }).data.updated).toBe(1)

    const db = getDb()
    const row = db.prepare('SELECT body FROM notes WHERE id=?').get(noteId) as
      | { body: string }
      | undefined
    expect(row?.body).toContain('Updated via import')
  })

  it('creates note with tags and links note_tags rows', async () => {
    const importDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-import-tags-'))
    const content = `---\nid: cccccccc-dddd-eeee-ffff-000000000001\ntitle: Tagged Note\ntags:\n  - work\n  - project\n---\n\nBody.`
    fs.writeFileSync(path.join(importDir, 'tagged-note.md'), content)
    try {
      const result = await importNotes({ folder: importDir })
      expect((result as { data: { imported: number } }).data.imported).toBe(1)
      const db = getDb()
      const tagRows = db
        .prepare(
          `SELECT t.name FROM tags t JOIN note_tags nt ON nt.tag_id = t.id WHERE nt.note_id = ?`
        )
        .all('cccccccc-dddd-eeee-ffff-000000000001') as { name: string }[]
      const tagNames = tagRows.map((r) => r.name).sort()
      expect(tagNames).toEqual(['project', 'work'])
    } finally {
      fs.rmSync(importDir, { recursive: true, force: true })
    }
  })

  it('updates existing note tags on re-import', async () => {
    // Export the existing note (no tags), then re-import with tags
    await exportNotes({ folder: exportDir, scope: 'all' })
    const files = fs.readdirSync(exportDir).filter((f) => f.endsWith('.md'))
    const filePath = path.join(exportDir, files[0])
    // Rewrite the frontmatter to include a tag
    const updatedContent = `---\nid: ${noteId}\ntitle: My Test Note\ntags:\n  - updated-tag\n---\n\n# Hello\n\nUpdated.`
    fs.writeFileSync(filePath, updatedContent)
    const result = await importNotes({ folder: exportDir })
    expect((result as { data: { updated: number } }).data.updated).toBe(1)
    const db = getDb()
    const tagRows = db
      .prepare(
        `SELECT t.name FROM tags t JOIN note_tags nt ON nt.tag_id = t.id WHERE nt.note_id = ?`
      )
      .all(noteId) as { name: string }[]
    expect(tagRows.map((r) => r.name)).toContain('updated-tag')
  })

  it('skips files with no frontmatter id gracefully', async () => {
    const importDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-import-bad-'))
    fs.writeFileSync(
      path.join(importDir, 'no-frontmatter.md'),
      '# Just a heading\n\nNo frontmatter here.'
    )

    try {
      const result = await importNotes({ folder: importDir })
      const data = (result as { data: { imported: number; skipped: number } }).data
      expect(data.imported).toBe(0)
      expect(data.skipped).toBe(1)
    } finally {
      fs.rmSync(importDir, { recursive: true, force: true })
    }
  })

  it('returns error on validation failure', async () => {
    const result = await importNotes({ folder: 123 as unknown as string })
    expect(result).toHaveProperty('error')
  })

  it('handles import folder that does not exist', async () => {
    const result = await importNotes({ folder: '/tmp/nonexistent-folder-xyz-12345' })
    const data = (result as { data: { imported: number; skipped: number } }).data
    expect(data.imported).toBe(0)
    expect(data.skipped).toBe(0)
  })

  it('skips non-.md files in import folder', async () => {
    const importDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-import-nonmd-'))
    fs.writeFileSync(path.join(importDir, 'readme.txt'), 'not a markdown file')
    try {
      const result = await importNotes({ folder: importDir })
      const data = (result as { data: { imported: number } }).data
      expect(data.imported).toBe(0)
    } finally {
      fs.rmSync(importDir, { recursive: true, force: true })
    }
  })

  it('imports note with missing title and non-array tags (uses defaults)', async () => {
    const importDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-import-defaults-'))
    const content = `---\nid: bbbbbbbb-cccc-dddd-eeee-ffffffffffff\n---\n\nBody text.`
    fs.writeFileSync(path.join(importDir, 'no-title.md'), content)
    try {
      const result = await importNotes({ folder: importDir })
      const data = (result as { data: { imported: number } }).data
      expect(data.imported).toBe(1)
      const row = getDb()
        .prepare('SELECT title FROM notes WHERE id=?')
        .get('bbbbbbbb-cccc-dddd-eeee-ffffffffffff') as { title: string } | undefined
      expect(row?.title).toBe('Imported note')
    } finally {
      fs.rmSync(importDir, { recursive: true, force: true })
    }
  })
})

describe('registerExportIpcHandlers', () => {
  it('returns a dispose function', () => {
    const dispose = registerExportIpcHandlers()
    expect(typeof dispose).toBe('function')
    dispose()
  })
})

describe('IPC reject — DB not initialized', () => {
  function getHandler(channel: string) {
    let handler: ((event: unknown, payload: unknown) => Promise<unknown>) | undefined
    vi.mocked(ipcMain.handle).mockImplementation((ch, fn) => {
      if (ch === channel) handler = fn as typeof handler
    })
    registerExportIpcHandlers()
    vi.mocked(ipcMain.handle).mockReset()
    if (!handler) throw new Error(`Handler for ${channel} not registered`)
    return handler
  }

  it('rejects from export.run when getDb throws so renderer catch fires', async () => {
    closeDb()
    const handler = getHandler('terminator.notepad:export.run')
    await expect(handler({}, { folder: '/tmp/export-test' })).rejects.toThrow(
      'NotepadDB not initialized'
    )
  })
})
