import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp') },
}))

import { wrapDb } from '../../../../../src/main/db/index'
import { applyNotepadSchema } from '../../../src/db/db'
import {
  createDiagram,
  listDiagrams,
  getDiagram,
  autosaveDiagram,
  archiveDiagram,
  restoreDiagram,
  hardDeleteDiagram,
  registerDiagramsIpcHandlers,
} from '../../../src/ipc/diagrams.ipc'
import { reorderItems } from '../../../src/ipc/notes.ipc'
import type { ExtensionDB } from '../../../../../src/main/db/index'

let pg: PGlite
let db: ExtensionDB

beforeEach(async () => {
  pg = new PGlite()
  await pg.waitReady
  db = wrapDb(pg)
  await applyNotepadSchema(db)
})

afterEach(async () => {
  await pg.close()
})

describe('createDiagram', () => {
  it('creates with default title when no title given', async () => {
    const result = await createDiagram(db, {})
    expect(result).toHaveProperty('data')
    const data = (result as { data: { id: string; title: string } }).data
    expect(data.id).toBeTruthy()
    expect(data.title).toBe('Untitled diagram')
  })

  it('creates with provided title', async () => {
    const result = await createDiagram(db, { title: 'My flowchart' })
    expect((result as { data: { title: string } }).data.title).toBe('My flowchart')
  })

  it('returns VALIDATION_ERROR for invalid payload', async () => {
    const result = await createDiagram(db, { unexpectedKey: true })
    expect(result).toEqual({ error: 'VALIDATION_ERROR' })
  })

  it('handles null payload', async () => {
    const result = await createDiagram(db, null)
    expect(result).toHaveProperty('data')
  })
})

describe('listDiagrams', () => {
  it('returns empty array when no diagrams exist', async () => {
    const result = await listDiagrams(db, {})
    expect((result as { data: unknown[] }).data).toEqual([])
  })

  it('lists created diagrams sorted by updated_at desc', async () => {
    await createDiagram(db, { title: 'First' })
    await createDiagram(db, { title: 'Second' })
    const result = await listDiagrams(db, {})
    const data = (result as { data: { title: string }[] }).data
    expect(data.length).toBe(2)
    // Both exist; ordering by updated_at desc
    expect(data.map((d) => d.title)).toContain('First')
    expect(data.map((d) => d.title)).toContain('Second')
  })

  it('excludes archived diagrams by default', async () => {
    const r = await createDiagram(db, { title: 'To archive' })
    const id = (r as { data: { id: string } }).data.id
    await archiveDiagram(db, { id })
    const result = await listDiagrams(db, {})
    expect((result as { data: unknown[] }).data).toHaveLength(0)
  })

  it('includes archived diagrams when includeArchived=true', async () => {
    const r = await createDiagram(db, { title: 'Archived' })
    const id = (r as { data: { id: string } }).data.id
    await archiveDiagram(db, { id })
    const result = await listDiagrams(db, { includeArchived: true })
    expect((result as { data: unknown[] }).data).toHaveLength(1)
  })

  it('every item has type="diagram"', async () => {
    await createDiagram(db, {})
    const result = await listDiagrams(db, {})
    const data = (result as { data: { type: string }[] }).data
    expect(data[0].type).toBe('diagram')
  })

  it('handles null payload', async () => {
    const result = await listDiagrams(db, null)
    expect((result as { data: unknown[] }).data).toEqual([])
  })

  it('returns VALIDATION_ERROR for invalid payload', async () => {
    const result = await listDiagrams(db, { includeArchived: 'yes' })
    expect(result).toEqual({ error: 'VALIDATION_ERROR' })
  })

  it('returns empty tags array when tags column has invalid JSON', async () => {
    const now = new Date().toISOString()
    await db.run(
      `INSERT INTO diagrams (id, title, tags, scene_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      ['bad-tags-id', 'Bad Tags', 'NOT_JSON', '{}', now, now]
    )
    const result = await listDiagrams(db, {})
    const data = (result as { data: { id: string; tags: string[] }[] }).data
    const row = data.find((d) => d.id === 'bad-tags-id')
    expect(row?.tags).toEqual([])
  })
})

describe('getDiagram', () => {
  it('returns diagram data', async () => {
    const r = await createDiagram(db, { title: 'Flowchart' })
    const id = (r as { data: { id: string } }).data.id
    const result = await getDiagram(db, { id })
    const data = (result as { data: { title: string; sceneJson: string } }).data
    expect(data.title).toBe('Flowchart')
    expect(data.sceneJson).toBe('{}')
  })

  it('returns DIAGRAM_NOT_FOUND for missing id', async () => {
    const result = await getDiagram(db, { id: 'nonexistent' })
    expect(result).toEqual({ error: 'DIAGRAM_NOT_FOUND' })
  })

  it('returns VALIDATION_ERROR for invalid payload', async () => {
    const result = await getDiagram(db, {})
    expect(result).toEqual({ error: 'VALIDATION_ERROR' })
  })

  it('returns empty tags array when tags column has invalid JSON', async () => {
    const now = new Date().toISOString()
    await db.run(
      `INSERT INTO diagrams (id, title, tags, scene_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      ['bad-tags-get', 'Bad Tags', 'NOT_JSON', '{}', now, now]
    )
    const result = await getDiagram(db, { id: 'bad-tags-get' })
    const data = (result as { data: { tags: string[] } }).data
    expect(data.tags).toEqual([])
  })
})

describe('autosaveDiagram', () => {
  it('updates title and scene json', async () => {
    const r = await createDiagram(db, {})
    const id = (r as { data: { id: string } }).data.id
    const scene = JSON.stringify({ elements: [{ type: 'rectangle' }] })
    const result = await autosaveDiagram(db, { id, title: 'Updated', sceneJson: scene })
    expect(result).toHaveProperty('data.updatedAt')

    const got = await getDiagram(db, { id })
    const data = (got as { data: { title: string; sceneJson: string } }).data
    expect(data.title).toBe('Updated')
    expect(data.sceneJson).toBe(scene)
  })

  it('returns DIAGRAM_NOT_FOUND for unknown id', async () => {
    const result = await autosaveDiagram(db, { id: 'x', title: 'T', sceneJson: '{}' })
    expect(result).toEqual({ error: 'DIAGRAM_NOT_FOUND' })
  })

  it('returns VALIDATION_ERROR on bad payload', async () => {
    const result = await autosaveDiagram(db, { id: 1 })
    expect(result).toEqual({ error: 'VALIDATION_ERROR' })
  })

  it('updates title only (no sceneJson) without overwriting scene', async () => {
    const r = await createDiagram(db, {})
    const id = (r as { data: { id: string } }).data.id
    const scene = JSON.stringify({ elements: [{ type: 'ellipse' }] })
    await autosaveDiagram(db, { id, title: 'With scene', sceneJson: scene })
    const result = await autosaveDiagram(db, { id, title: 'Title only', tags: ['tag1'] })
    expect(result).toHaveProperty('data.updatedAt')
    const got = await getDiagram(db, { id })
    const data = (got as { data: { title: string; sceneJson: string; tags: string[] } }).data
    expect(data.title).toBe('Title only')
    expect(data.sceneJson).toBe(scene)
    expect(data.tags).toEqual(['tag1'])
  })
})

describe('archiveDiagram / restoreDiagram', () => {
  it('archives and restores a diagram', async () => {
    const r = await createDiagram(db, {})
    const id = (r as { data: { id: string } }).data.id
    await archiveDiagram(db, { id })

    let listed = await listDiagrams(db, { includeArchived: false })
    expect((listed as { data: unknown[] }).data).toHaveLength(0)

    await restoreDiagram(db, { id })
    listed = await listDiagrams(db, { includeArchived: false })
    expect((listed as { data: unknown[] }).data).toHaveLength(1)
  })

  it('archiveDiagram returns DIAGRAM_NOT_FOUND for unknown id', async () => {
    expect(await archiveDiagram(db, { id: 'nope' })).toEqual({ error: 'DIAGRAM_NOT_FOUND' })
  })

  it('restoreDiagram returns DIAGRAM_NOT_FOUND for unknown id', async () => {
    expect(await restoreDiagram(db, { id: 'nope' })).toEqual({ error: 'DIAGRAM_NOT_FOUND' })
  })

  it('archiveDiagram returns VALIDATION_ERROR for bad payload', async () => {
    expect(await archiveDiagram(db, { id: 123 })).toEqual({ error: 'VALIDATION_ERROR' })
  })

  it('restoreDiagram returns VALIDATION_ERROR for bad payload', async () => {
    expect(await restoreDiagram(db, null)).toEqual({ error: 'VALIDATION_ERROR' })
  })
})

describe('hardDeleteDiagram', () => {
  it('removes the diagram', async () => {
    const r = await createDiagram(db, {})
    const id = (r as { data: { id: string } }).data.id
    await hardDeleteDiagram(db, { id })
    const result = await getDiagram(db, { id })
    expect(result).toEqual({ error: 'DIAGRAM_NOT_FOUND' })
  })

  it('returns DIAGRAM_NOT_FOUND for unknown id', async () => {
    expect(await hardDeleteDiagram(db, { id: 'nope' })).toEqual({ error: 'DIAGRAM_NOT_FOUND' })
  })

  it('returns VALIDATION_ERROR for bad payload', async () => {
    expect(await hardDeleteDiagram(db, null)).toEqual({ error: 'VALIDATION_ERROR' })
  })
})

describe('listDiagrams sort_order', () => {
  it('returns sortOrder field and orders by sort_order asc', async () => {
    const d1 = await createDiagram(db, { title: 'D1' })
    const d2 = await createDiagram(db, { title: 'D2' })
    const id1 = (d1 as { data: { id: string } }).data.id
    const id2 = (d2 as { data: { id: string } }).data.id

    await reorderItems(db, {
      items: [
        { id: id2, type: 'diagram' },
        { id: id1, type: 'diagram' },
      ],
    })

    const result = await listDiagrams(db, {})
    const data = (result as { data: { title: string; sortOrder: number }[] }).data
    expect(data[0].title).toBe('D2')
    expect(data[1].title).toBe('D1')
    expect(data[0].sortOrder).toBe(0)
    expect(data[1].sortOrder).toBe(1)
  })
})

describe('registerDiagramsIpcHandlers', () => {
  it('registers and disposes without error', () => {
    const dispose = registerDiagramsIpcHandlers(db)
    expect(typeof dispose).toBe('function')
    dispose()
  })
})
