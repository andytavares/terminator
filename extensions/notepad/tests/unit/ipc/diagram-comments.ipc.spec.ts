import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp') },
}))

import { wrapDb } from '../../../../../src/main/db/index'
import { applyNotepadSchema } from '../../../src/db/db'
import { createDiagram } from '../../../src/ipc/diagrams.ipc'
import {
  createDiagramComment,
  listDiagramComments,
  resolveDiagramComment,
  deleteDiagramComment,
  registerDiagramCommentsIpcHandlers,
} from '../../../src/ipc/diagram-comments.ipc'
import type { ExtensionDB } from '../../../../../src/main/db/index'

let pg: PGlite
let db: ExtensionDB
let diagramId: string

beforeEach(async () => {
  pg = new PGlite()
  await pg.waitReady
  db = wrapDb(pg)
  await applyNotepadSchema(db)
  const r = await createDiagram(db, { title: 'Test diagram' })
  diagramId = (r as { data: { id: string } }).data.id
})

afterEach(async () => {
  await pg.close()
})

describe('createDiagramComment', () => {
  it('creates a root comment at given coordinates', async () => {
    const result = await createDiagramComment(db, {
      diagramId,
      body: 'Check this element',
      sceneX: 100,
      sceneY: 200,
    })
    expect(result).toHaveProperty('data.id')
    expect(result).toHaveProperty('data.createdAt')
  })

  it('creates a reply comment with parentId', async () => {
    const root = await createDiagramComment(db, {
      diagramId,
      body: 'Root comment',
      sceneX: 0,
      sceneY: 0,
    })
    const parentId = (root as { data: { id: string } }).data.id
    const reply = await createDiagramComment(db, { diagramId, parentId, body: 'Reply' })
    expect(reply).toHaveProperty('data.id')
  })

  it('returns DIAGRAM_NOT_FOUND for unknown diagramId', async () => {
    const result = await createDiagramComment(db, {
      diagramId: 'nope',
      body: 'hi',
      sceneX: 0,
      sceneY: 0,
    })
    expect(result).toEqual({ error: 'DIAGRAM_NOT_FOUND' })
  })

  it('returns VALIDATION_ERROR for missing body', async () => {
    const result = await createDiagramComment(db, { diagramId, sceneX: 0, sceneY: 0 })
    expect(result).toEqual({ error: 'VALIDATION_ERROR' })
  })
})

describe('listDiagramComments', () => {
  it('returns empty list when no comments', async () => {
    const result = await listDiagramComments(db, { diagramId })
    expect((result as { data: unknown[] }).data).toEqual([])
  })

  it('nests replies under their parent', async () => {
    const root = await createDiagramComment(db, { diagramId, body: 'Root', sceneX: 10, sceneY: 20 })
    const parentId = (root as { data: { id: string } }).data.id
    await createDiagramComment(db, { diagramId, parentId, body: 'Reply' })

    const result = await listDiagramComments(db, { diagramId })
    const data = (result as { data: { body: string; replies: { body: string }[] }[] }).data
    expect(data).toHaveLength(1)
    expect(data[0].body).toBe('Root')
    expect(data[0].replies).toHaveLength(1)
    expect(data[0].replies[0].body).toBe('Reply')
  })

  it('stores sceneX and sceneY', async () => {
    await createDiagramComment(db, { diagramId, body: 'Pin', sceneX: 42.5, sceneY: 99.1 })
    const result = await listDiagramComments(db, { diagramId })
    const data = (result as { data: { sceneX: number; sceneY: number }[] }).data
    expect(Number(data[0].sceneX)).toBeCloseTo(42.5)
    expect(Number(data[0].sceneY)).toBeCloseTo(99.1)
  })

  it('excludes resolved comments by default', async () => {
    const r = await createDiagramComment(db, {
      diagramId,
      body: 'To resolve',
      sceneX: 0,
      sceneY: 0,
    })
    const id = (r as { data: { id: string } }).data.id
    await resolveDiagramComment(db, { id })
    const result = await listDiagramComments(db, { diagramId })
    expect((result as { data: unknown[] }).data).toHaveLength(0)
  })

  it('includes resolved comments when includeResolved=true', async () => {
    const r = await createDiagramComment(db, { diagramId, body: 'Resolved', sceneX: 0, sceneY: 0 })
    const id = (r as { data: { id: string } }).data.id
    await resolveDiagramComment(db, { id })
    const result = await listDiagramComments(db, { diagramId, includeResolved: true })
    expect((result as { data: unknown[] }).data).toHaveLength(1)
  })

  it('returns VALIDATION_ERROR for invalid payload', async () => {
    const result = await listDiagramComments(db, {})
    expect(result).toEqual({ error: 'VALIDATION_ERROR' })
  })
})

describe('resolveDiagramComment', () => {
  it('resolves a comment and its replies', async () => {
    const root = await createDiagramComment(db, { diagramId, body: 'Root', sceneX: 0, sceneY: 0 })
    const parentId = (root as { data: { id: string } }).data.id
    await createDiagramComment(db, { diagramId, parentId, body: 'Reply' })

    await resolveDiagramComment(db, { id: parentId })

    const result = await listDiagramComments(db, { diagramId, includeResolved: false })
    expect((result as { data: unknown[] }).data).toHaveLength(0)
  })

  it('returns COMMENT_NOT_FOUND for unknown id', async () => {
    const result = await resolveDiagramComment(db, { id: 'nope' })
    expect(result).toEqual({ error: 'COMMENT_NOT_FOUND' })
  })
})

describe('deleteDiagramComment', () => {
  it('removes the comment', async () => {
    const r = await createDiagramComment(db, { diagramId, body: 'Delete me', sceneX: 0, sceneY: 0 })
    const id = (r as { data: { id: string } }).data.id
    await deleteDiagramComment(db, { id })
    const result = await listDiagramComments(db, { diagramId, includeResolved: true })
    expect((result as { data: unknown[] }).data).toHaveLength(0)
  })
})

describe('registerDiagramCommentsIpcHandlers', () => {
  it('registers and disposes without error', () => {
    const dispose = registerDiagramCommentsIpcHandlers(db)
    expect(typeof dispose).toBe('function')
    dispose()
  })
})
