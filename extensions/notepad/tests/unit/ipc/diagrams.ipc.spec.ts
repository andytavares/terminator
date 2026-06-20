import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp') },
}))

import { initDb, closeDb, getDb } from '../../../src/db/db'
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

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-diagrams-test-'))
  initDb(tmpDir)
})

afterEach(() => {
  closeDb()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('createDiagram', () => {
  it('creates with default title when no title given', async () => {
    const result = await createDiagram({})
    expect(result).toHaveProperty('data')
    const data = (result as { data: { id: string; title: string } }).data
    expect(data.id).toBeTruthy()
    expect(data.title).toBe('Untitled diagram')
  })

  it('creates with provided title', async () => {
    const result = await createDiagram({ title: 'My flowchart' })
    expect((result as { data: { title: string } }).data.title).toBe('My flowchart')
  })

  it('returns VALIDATION_ERROR for invalid payload', async () => {
    const result = await createDiagram({ unexpectedKey: true })
    expect(result).toEqual({ error: 'VALIDATION_ERROR' })
  })

  it('handles null payload', async () => {
    const result = await createDiagram(null)
    expect(result).toHaveProperty('data')
  })
})

describe('listDiagrams', () => {
  it('returns empty array when no diagrams exist', async () => {
    const result = await listDiagrams({})
    expect((result as { data: unknown[] }).data).toEqual([])
  })

  it('lists created diagrams sorted by updated_at desc', async () => {
    await createDiagram({ title: 'First' })
    await createDiagram({ title: 'Second' })
    const result = await listDiagrams({})
    const data = (result as { data: { title: string }[] }).data
    expect(data.length).toBe(2)
    expect(data[0].title).toBe('Second')
  })

  it('excludes archived diagrams by default', async () => {
    const r = await createDiagram({ title: 'To archive' })
    const id = (r as { data: { id: string } }).data.id
    await archiveDiagram({ id })
    const result = await listDiagrams({})
    expect((result as { data: unknown[] }).data).toHaveLength(0)
  })

  it('includes archived diagrams when includeArchived=true', async () => {
    const r = await createDiagram({ title: 'Archived' })
    const id = (r as { data: { id: string } }).data.id
    await archiveDiagram({ id })
    const result = await listDiagrams({ includeArchived: true })
    expect((result as { data: unknown[] }).data).toHaveLength(1)
  })

  it('every item has type="diagram"', async () => {
    await createDiagram({})
    const result = await listDiagrams({})
    const data = (result as { data: { type: string }[] }).data
    expect(data[0].type).toBe('diagram')
  })

  it('handles null payload', async () => {
    const result = await listDiagrams(null)
    expect((result as { data: unknown[] }).data).toEqual([])
  })

  it('returns VALIDATION_ERROR for invalid payload', async () => {
    const result = await listDiagrams({ includeArchived: 'yes' })
    expect(result).toEqual({ error: 'VALIDATION_ERROR' })
  })

  it('returns empty tags array when tags column has invalid JSON', async () => {
    const db = getDb()
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO diagrams (id, title, tags, scene_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).run('bad-tags-id', 'Bad Tags', 'NOT_JSON', '{}', now, now)
    const result = await listDiagrams({})
    const data = (result as { data: { id: string; tags: string[] }[] }).data
    const row = data.find((d) => d.id === 'bad-tags-id')
    expect(row?.tags).toEqual([])
  })
})

describe('getDiagram', () => {
  it('returns diagram data', async () => {
    const r = await createDiagram({ title: 'Flowchart' })
    const id = (r as { data: { id: string } }).data.id
    const result = await getDiagram({ id })
    const data = (result as { data: { title: string; sceneJson: string } }).data
    expect(data.title).toBe('Flowchart')
    expect(data.sceneJson).toBe('{}')
  })

  it('returns DIAGRAM_NOT_FOUND for missing id', async () => {
    const result = await getDiagram({ id: 'nonexistent' })
    expect(result).toEqual({ error: 'DIAGRAM_NOT_FOUND' })
  })

  it('returns VALIDATION_ERROR for invalid payload', async () => {
    const result = await getDiagram({})
    expect(result).toEqual({ error: 'VALIDATION_ERROR' })
  })

  it('returns empty tags array when tags column has invalid JSON', async () => {
    const db = getDb()
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO diagrams (id, title, tags, scene_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).run('bad-tags-get', 'Bad Tags', 'NOT_JSON', '{}', now, now)
    const result = await getDiagram({ id: 'bad-tags-get' })
    const data = (result as { data: { tags: string[] } }).data
    expect(data.tags).toEqual([])
  })
})

describe('autosaveDiagram', () => {
  it('updates title and scene json', async () => {
    const r = await createDiagram({})
    const id = (r as { data: { id: string } }).data.id
    const scene = JSON.stringify({ elements: [{ type: 'rectangle' }] })
    const result = await autosaveDiagram({ id, title: 'Updated', sceneJson: scene })
    expect(result).toHaveProperty('data.updatedAt')

    const got = await getDiagram({ id })
    const data = (got as { data: { title: string; sceneJson: string } }).data
    expect(data.title).toBe('Updated')
    expect(data.sceneJson).toBe(scene)
  })

  it('returns DIAGRAM_NOT_FOUND for unknown id', async () => {
    const result = await autosaveDiagram({ id: 'x', title: 'T', sceneJson: '{}' })
    expect(result).toEqual({ error: 'DIAGRAM_NOT_FOUND' })
  })

  it('returns VALIDATION_ERROR on bad payload', async () => {
    const result = await autosaveDiagram({ id: 1 })
    expect(result).toEqual({ error: 'VALIDATION_ERROR' })
  })

  it('updates title only (no sceneJson) without overwriting scene', async () => {
    const r = await createDiagram({})
    const id = (r as { data: { id: string } }).data.id
    const scene = JSON.stringify({ elements: [{ type: 'ellipse' }] })
    await autosaveDiagram({ id, title: 'With scene', sceneJson: scene })
    const result = await autosaveDiagram({ id, title: 'Title only', tags: ['tag1'] })
    expect(result).toHaveProperty('data.updatedAt')
    const got = await getDiagram({ id })
    const data = (got as { data: { title: string; sceneJson: string; tags: string[] } }).data
    expect(data.title).toBe('Title only')
    expect(data.sceneJson).toBe(scene)
    expect(data.tags).toEqual(['tag1'])
  })
})

describe('archiveDiagram / restoreDiagram', () => {
  it('archives and restores a diagram', async () => {
    const r = await createDiagram({})
    const id = (r as { data: { id: string } }).data.id
    await archiveDiagram({ id })

    let listed = await listDiagrams({ includeArchived: false })
    expect((listed as { data: unknown[] }).data).toHaveLength(0)

    await restoreDiagram({ id })
    listed = await listDiagrams({ includeArchived: false })
    expect((listed as { data: unknown[] }).data).toHaveLength(1)
  })

  it('archiveDiagram returns DIAGRAM_NOT_FOUND for unknown id', async () => {
    expect(await archiveDiagram({ id: 'nope' })).toEqual({ error: 'DIAGRAM_NOT_FOUND' })
  })

  it('restoreDiagram returns DIAGRAM_NOT_FOUND for unknown id', async () => {
    expect(await restoreDiagram({ id: 'nope' })).toEqual({ error: 'DIAGRAM_NOT_FOUND' })
  })

  it('archiveDiagram returns VALIDATION_ERROR for bad payload', async () => {
    expect(await archiveDiagram({ id: 123 })).toEqual({ error: 'VALIDATION_ERROR' })
  })

  it('restoreDiagram returns VALIDATION_ERROR for bad payload', async () => {
    expect(await restoreDiagram(null)).toEqual({ error: 'VALIDATION_ERROR' })
  })
})

describe('hardDeleteDiagram', () => {
  it('removes the diagram', async () => {
    const r = await createDiagram({})
    const id = (r as { data: { id: string } }).data.id
    await hardDeleteDiagram({ id })
    const result = await getDiagram({ id })
    expect(result).toEqual({ error: 'DIAGRAM_NOT_FOUND' })
  })

  it('returns DIAGRAM_NOT_FOUND for unknown id', async () => {
    expect(await hardDeleteDiagram({ id: 'nope' })).toEqual({ error: 'DIAGRAM_NOT_FOUND' })
  })

  it('returns VALIDATION_ERROR for bad payload', async () => {
    expect(await hardDeleteDiagram(null)).toEqual({ error: 'VALIDATION_ERROR' })
  })
})

describe('registerDiagramsIpcHandlers', () => {
  it('registers and disposes without error', () => {
    const dispose = registerDiagramsIpcHandlers()
    expect(typeof dispose).toBe('function')
    dispose()
  })
})
