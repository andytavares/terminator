import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ipcMain } from 'electron'
import { dispatchChannel, type ChannelSpec, type ExtensionAPI } from '@terminator/extension-sdk'
import { partialFake } from '../../../../../tests/support/fakes'
import { makeTempDir } from '../../../../../tests/support/temp-dir'

const showOpenDialog = vi
  .fn()
  .mockResolvedValue({ canceled: false, filePaths: ['/tmp/export-test'] })

// Adapter: registerHandler forwards to the electron ipcMain mocks so existing
// capture/assert code (ipcMain.handle calls, removeHandler assertions) still works.
const mockApi = partialFake<ExtensionAPI>({
  dialog: partialFake<ExtensionAPI['dialog']>({ showOpenDialog }),
  ipc: partialFake<ExtensionAPI['ipc']>({
    registerHandler: (spec: ChannelSpec) => {
      vi.mocked(ipcMain.handle)(spec.channel, (_e, payload: unknown) =>
        dispatchChannel(spec, payload)
      )
      return { dispose: () => vi.mocked(ipcMain.removeHandler)(spec.channel) }
    },
  }),
})
import * as fs from 'node:fs'
import * as path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp') },
}))

import { wrapDb } from '../../../../../src/main/db/index'
import { applyNotepadSchema } from '../../../src/db/db'
import {
  toSlug,
  exportNotes,
  importNotes,
  registerExportIpcHandlers,
} from '../../../src/ipc/export.ipc'
import type { ExtensionDB } from '@terminator/extension-sdk'

let db: ExtensionDB
let exportDir: string
let noteId: string

beforeEach(async () => {
  db = wrapDb(new DatabaseSync(':memory:'))
  await applyNotepadSchema(db)
})

beforeEach(async () => {
  exportDir = makeTempDir('notepad-export-dest-')

  noteId = '00000000-0000-0000-0000-000000000001'
  const now = new Date().toISOString()
  await db.run(
    'INSERT INTO notes (id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    [noteId, 'My Test Note', '# Hello\n\nThis is the note body.', now, now]
  )
})

afterEach(async () => {
  fs.rmSync(exportDir, { recursive: true, force: true })
})

async function insertDiagram(title: string, scene: { elements: unknown[] }): Promise<void> {
  const now = new Date().toISOString()
  const sceneJson = JSON.stringify({ ...scene, appState: { zoom: 1 } })
  await db.run(
    'INSERT INTO diagrams (id, title, scene_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ['dddddddd-0000-0000-0000-000000000001', title, sceneJson, now, now]
  )
}

function readJsonFile(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, 'utf-8'))
}

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

describe('exportNotes', exportNotesTests)
describe('importNotes', importNotesTests)
describe('exportNotes with comments', exportNotesWithCommentsTests)
describe('exportNotes with includeDiagrams', exportNotesIncludeDiagramsTests)
describe('registerExportIpcHandlers', registerExportIpcHandlersTests)

function exportNotesTests() {
  describe('writing files', exportNotesWritingFilesTests)
  describe('re-exporting', exportNotesReExportingTests)
  describe('scope', exportNotesScopeTests)
  describe('edge cases', exportNotesEdgeCasesTests)
}

function exportNotesWritingFilesTests() {
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
}

function exportNotesReExportingTests() {
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
}

function exportNotesScopeTests() {
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
}

function exportNotesEdgeCasesTests() {
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
}

function importNotesTests() {
  describe('creating notes', importNotesCreatingNotesTests)
  describe('updating notes', importNotesUpdatingNotesTests)
  describe('tags', importNotesTagsTests)
  describe('re-importing tags', importNotesReImportingTagsTests)
  describe('skipping files', importNotesSkippingFilesTests)
  describe('non-markdown files', importNotesNonMarkdownFilesTests)
  describe('defaults', importNotesDefaultsTests)
}

function importNotesCreatingNotesTests() {
  it('creates a note for each .md file with frontmatter id', async () => {
    const importDir = makeTempDir('notepad-import-src-')
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
}

function importNotesUpdatingNotesTests() {
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
}

function importNotesTagsTests() {
  it('creates note with tags and links note_tags rows', async () => {
    const importDir = makeTempDir('notepad-import-tags-')
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
}

function importNotesReImportingTagsTests() {
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
}

function importNotesSkippingFilesTests() {
  it('skips files with no frontmatter id gracefully', async () => {
    const importDir = makeTempDir('notepad-import-bad-')
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

  it('handles import folder that does not exist', async () => {
    const result = await importNotes(db, { folder: '/tmp/nonexistent-folder-xyz-12345' })
    const data = (result as { data: { imported: number; skipped: number } }).data
    expect(data.imported).toBe(0)
    expect(data.skipped).toBe(0)
  })
}

function importNotesNonMarkdownFilesTests() {
  it('skips non-.md files in import folder', async () => {
    const importDir = makeTempDir('notepad-import-nonmd-')
    fs.writeFileSync(path.join(importDir, 'readme.txt'), 'not a markdown file')
    try {
      const result = await importNotes(db, { folder: importDir })
      const data = (result as { data: { imported: number } }).data
      expect(data.imported).toBe(0)
    } finally {
      fs.rmSync(importDir, { recursive: true, force: true })
    }
  })
}

function importNotesDefaultsTests() {
  it('imports note with missing title and non-array tags (uses defaults)', async () => {
    const importDir = makeTempDir('notepad-import-defaults-')
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
}

function exportNotesIncludeDiagramsTests() {
  describe('exporting diagrams', exportNotesIncludeDiagramsExportingDiagramsTests)
  describe('not exporting diagrams', exportNotesIncludeDiagramsNotExportingDiagramsTests)
}

function exportNotesIncludeDiagramsExportingDiagramsTests() {
  it('exports diagrams as .excalidraw files in a diagrams/ subfolder', async () => {
    await insertDiagram('My Diagram', { elements: [{ type: 'rectangle', id: 'el1' }] })

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
    const content = readJsonFile(path.join(diagramsFolder, files[0])) as {
      type: string
      elements: unknown[]
    }
    expect(content.type).toBe('excalidraw')
    expect(content.elements).toHaveLength(1)
  })
}

function exportNotesIncludeDiagramsNotExportingDiagramsTests() {
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
}

function registerExportIpcHandlersTests() {
  describe('picking a folder', registerExportIpcHandlersPickingFolderTests)
  describe('running', registerExportIpcHandlersRunningTests)
  describe('registration', registerExportIpcHandlersRegistrationTests)
}

function registerExportIpcHandlersPickingFolderTests() {
  it('dispatches pickFolder through the dialog, including the cancel path', async () => {
    vi.mocked(ipcMain.handle).mockClear()
    const dispose = registerExportIpcHandlers(mockApi, db)
    const get = (ch: string) =>
      vi.mocked(ipcMain.handle).mock.calls.find(([c]) => c === ch)![1] as (
        e: unknown,
        payload?: unknown
      ) => Promise<unknown>

    const picked = (await get('terminator.notepad:export.pickFolder')({})) as { data: unknown }
    expect(picked).toEqual({ data: '/tmp/export-test' })

    showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    const cancelled = (await get('terminator.notepad:export.pickFolder')({})) as { data: unknown }
    expect(cancelled).toEqual({ data: null })
    dispose()
  })
}

function registerExportIpcHandlersRunningTests() {
  it('dispatches export.run and import.run to their functions', async () => {
    vi.mocked(ipcMain.handle).mockClear()
    const dispose = registerExportIpcHandlers(mockApi, db)
    const get = (ch: string) =>
      vi.mocked(ipcMain.handle).mock.calls.find(([c]) => c === ch)![1] as (
        e: unknown,
        payload?: unknown
      ) => Promise<unknown>

    const exported = (await get('terminator.notepad:export.run')({}, {})) as { error?: string }
    expect(exported).toHaveProperty('error')
    const imported = (await get('terminator.notepad:import.run')({}, {})) as { error?: string }
    expect(imported).toHaveProperty('error')
    dispose()
  })
}

function registerExportIpcHandlersRegistrationTests() {
  it('returns a dispose function', () => {
    const dispose = registerExportIpcHandlers(mockApi, db)
    expect(typeof dispose).toBe('function')
    dispose()
  })

  it('registers IPC channels on setup', () => {
    vi.mocked(ipcMain.handle).mockClear()
    const dispose = registerExportIpcHandlers(mockApi, db)
    expect(ipcMain.handle).toHaveBeenCalledWith(
      'terminator.notepad:export.run',
      expect.any(Function)
    )
    dispose()
  })
}

const exportedMarkdown = () =>
  fs.readFileSync(path.join(exportDir, `${toSlug('My Test Note', noteId)}.md`), 'utf-8')
const sidecarPath = () => path.join(exportDir, `${toSlug('My Test Note', noteId)}.comments.json`)

function exportNotesWithCommentsTests() {
  beforeEach(async () => {
    const now = new Date().toISOString()
    await db.run(
      `INSERT INTO comments (id, note_id, parent_id, body, status, start_offset, end_offset, quote, created_at, updated_at)
       VALUES ('c1', ?, NULL, 'Say more', 'open', 9, 13, 'This', ?, ?),
              ('c2', ?, 'c1', 'Will do', 'open', NULL, NULL, NULL, ?, ?)`,
      [noteId, now, now, noteId, now, now]
    )
  })
  describe('one format', exportNotesSingleCommentFormatTests)
  describe('both or none', exportNotesBothOrNoCommentsTests)
}

function exportNotesSingleCommentFormatTests() {
  it("writes a note's comments to a JSON file beside it for the sidecar format", async () => {
    await exportNotes(db, { folder: exportDir, commentFormat: 'sidecar' })

    const comments = JSON.parse(fs.readFileSync(sidecarPath(), 'utf-8'))
    expect(comments).toMatchObject([
      { id: 'c1', body: 'Say more', quote: 'This', status: 'open', replies: [{ body: 'Will do' }] },
    ])
    expect(exportedMarkdown()).not.toContain('Say more')
  })

  it('appends the comments to the markdown as HTML comments for the inline format', async () => {
    await exportNotes(db, { folder: exportDir, commentFormat: 'inline' })

    expect(exportedMarkdown()).toContain('<!-- comment on "This": Say more -->')
    expect(exportedMarkdown()).toContain('<!-- reply: Will do -->')
    expect(fs.existsSync(sidecarPath())).toBe(false)
  })
}

function exportNotesBothOrNoCommentsTests() {
  it('writes both for the both format, and neither for none', async () => {
    await exportNotes(db, { folder: exportDir, commentFormat: 'both' })
    expect(fs.existsSync(sidecarPath())).toBe(true)
    expect(exportedMarkdown()).toContain('Say more')

    fs.rmSync(sidecarPath())
    await exportNotes(db, { folder: exportDir, commentFormat: 'none' })
    expect(fs.existsSync(sidecarPath())).toBe(false)
    expect(exportedMarkdown()).not.toContain('Say more')
  })
}
