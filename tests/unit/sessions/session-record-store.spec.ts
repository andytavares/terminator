import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { SessionSnapshot } from '../../../src/shared/types/index'

let userData: string

vi.mock('electron', () => ({ app: { getPath: () => userData } }))

async function load() {
  vi.resetModules()
  return import('../../../src/main/sessions/session-record-store')
}

const FILE = () => path.join(userData, 'session-records.json')

const SNAP: SessionSnapshot = {
  sessionId: 's1',
  projectId: 'p1',
  workspaceName: 'Northwind',
  projectName: 'northwind-api',
  branch: 'main',
  tabTitle: 'zsh',
  shell: '/bin/zsh',
  startedAt: '2026-09-15T10:02:00.000Z',
}

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'session-record-store-'))
})

describe('session-record-store — loading', () => {
  it('starts empty when there is no file', async () => {
    const store = await load()
    await store.loadRecords()
    expect(store.listRecords()).toEqual([])
  })

  it('starts empty when the file is corrupt', async () => {
    fs.writeFileSync(FILE(), '{not json')
    const store = await load()
    await store.loadRecords()
    expect(store.listRecords()).toEqual([])
  })

  it('starts empty when the file is not an array', async () => {
    fs.writeFileSync(FILE(), JSON.stringify({ sessionId: 's1' }))
    const store = await load()
    await store.loadRecords()
    expect(store.listRecords()).toEqual([])
  })

  it('skips malformed entries but keeps the valid ones', async () => {
    const good = { ...SNAP, description: 'kept', link: null, updatedAt: SNAP.startedAt }
    fs.writeFileSync(
      FILE(),
      JSON.stringify([
        null,
        'x',
        { sessionId: 's2' },
        good,
        { ...good, sessionId: 's3', link: { tracker: 'asana', key: 'A-1' } },
      ])
    )
    const store = await load()
    await store.loadRecords()
    const records = store.listRecords()
    expect(records.map((r) => r.sessionId).sort()).toEqual(['s1', 's3'])
    // An unknown tracker loses its link, not the whole record.
    expect(records.find((r) => r.sessionId === 's3')?.link).toBeNull()
  })

  it('prunes records closed more than 30 days ago on load', async () => {
    const old = {
      ...SNAP,
      description: 'old',
      link: null,
      updatedAt: SNAP.startedAt,
      closedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(),
    }
    fs.writeFileSync(FILE(), JSON.stringify([old]))
    const store = await load()
    await store.loadRecords()
    expect(store.listRecords()).toEqual([])
  })
})

describe('session-record-store — writing', () => {
  it('creates a record with the session snapshot on first description', async () => {
    const store = await load()
    const record = await store.setDescription(SNAP, '  Reproducing the staging 429s  ')
    expect(record).toMatchObject({
      ...SNAP,
      description: 'Reproducing the staging 429s',
      link: null,
    })
    expect(record?.closedAt).toBeUndefined()
    expect(Date.parse(record?.updatedAt ?? '')).not.toBeNaN()
  })

  it('persists to disk and leaves no tmp file behind', async () => {
    const store = await load()
    await store.setDescription(SNAP, 'why')
    const onDisk = JSON.parse(fs.readFileSync(FILE(), 'utf8'))
    expect(onDisk).toHaveLength(1)
    expect(fs.existsSync(`${FILE()}.tmp`)).toBe(false)
  })

  it('survives a reload', async () => {
    const first = await load()
    await first.setDescription(SNAP, 'why')
    const second = await load()
    await second.loadRecords()
    expect(second.listRecords()[0]?.description).toBe('why')
  })

  it('refreshes the snapshot on a later write', async () => {
    const store = await load()
    await store.setDescription(SNAP, 'why')
    const record = await store.setDescription({ ...SNAP, tabTitle: 'renamed' }, 'why still')
    expect(record?.tabTitle).toBe('renamed')
  })

  it('keeps newlines inside a description', async () => {
    const store = await load()
    const record = await store.setDescription(SNAP, 'line one\nline two')
    expect(record?.description).toBe('line one\nline two')
  })

  it('deletes an open record when its description is cleared and it has no link', async () => {
    const store = await load()
    await store.setDescription(SNAP, 'why')
    expect(await store.setDescription(SNAP, '   ')).toBeNull()
    expect(store.listRecords()).toEqual([])
  })

  it('keeps the record when the description is cleared but a link remains', async () => {
    const store = await load()
    await store.setLink(SNAP, { tracker: 'linear', key: 'NW-88' })
    await store.setDescription(SNAP, 'why')
    const record = await store.setDescription(SNAP, null)
    expect(record).toMatchObject({ description: null, link: { tracker: 'linear', key: 'NW-88' } })
  })

  it('deletes the record when the last link is removed and there is no description', async () => {
    const store = await load()
    await store.setLink(SNAP, { tracker: 'linear', key: 'NW-88' })
    expect(await store.setLink(SNAP, null)).toBeNull()
    expect(store.listRecords()).toEqual([])
  })

  it('does not create a record for a clear on a session that has none', async () => {
    const store = await load()
    expect(await store.setDescription(SNAP, null)).toBeNull()
    expect(fs.existsSync(FILE())).toBe(false)
  })

  it('rejects a description over 500 characters', async () => {
    const store = await load()
    await expect(store.setDescription(SNAP, 'x'.repeat(501))).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    })
    expect(store.listRecords()).toEqual([])
  })

  it('accepts a description of exactly 500 characters', async () => {
    const store = await load()
    const record = await store.setDescription(SNAP, 'x'.repeat(500))
    expect(record?.description).toHaveLength(500)
  })

  it('rejects any write to a closed record', async () => {
    const store = await load()
    await store.setDescription(SNAP, 'why')
    await store.markClosed('s1', new Date('2026-09-15T11:00:00.000Z'))
    await expect(store.setDescription(SNAP, 'later')).rejects.toMatchObject({
      code: 'RECORD_CLOSED',
    })
    await expect(store.setLink(SNAP, null)).rejects.toMatchObject({ code: 'RECORD_CLOSED' })
  })
})

describe('session-record-store — closing', () => {
  it('stamps the close time', async () => {
    const store = await load()
    await store.setDescription(SNAP, 'why')
    await store.markClosed('s1', new Date('2026-09-15T11:00:00.000Z'))
    expect(store.listRecords()[0]?.closedAt).toBe('2026-09-15T11:00:00.000Z')
  })

  it('does nothing for a session without a record', async () => {
    const store = await load()
    await store.markClosed('nobody', new Date())
    expect(fs.existsSync(FILE())).toBe(false)
  })

  it('does not move the close time of an already-closed record', async () => {
    const store = await load()
    await store.setDescription(SNAP, 'why')
    await store.markClosed('s1', new Date('2026-09-15T11:00:00.000Z'))
    await store.markClosed('s1', new Date('2026-09-15T12:00:00.000Z'))
    expect(store.listRecords()[0]?.closedAt).toBe('2026-09-15T11:00:00.000Z')
  })

  it('closes every open record at its last update when swept', async () => {
    const open = { ...SNAP, description: 'why', link: null, updatedAt: '2026-09-14T09:00:00.000Z' }
    const closed = {
      ...open,
      sessionId: 's2',
      updatedAt: '2026-09-14T08:00:00.000Z',
      closedAt: '2026-09-14T08:30:00.000Z',
    }
    fs.writeFileSync(
      FILE(),
      JSON.stringify([
        { ...open, updatedAt: new Date().toISOString() },
        { ...closed, closedAt: new Date().toISOString() },
      ])
    )
    const store = await load()
    await store.loadRecords()
    const before = store.listRecords()
    await store.sweepOpenRecords()
    const after = store.listRecords()
    const s1 = after.find((r) => r.sessionId === 's1')
    expect(s1?.closedAt).toBe(before.find((r) => r.sessionId === 's1')?.updatedAt)
    expect(after.find((r) => r.sessionId === 's2')?.closedAt).toBe(
      before.find((r) => r.sessionId === 's2')?.closedAt
    )
  })
})

describe('session-record-store — announcing', () => {
  it('tells every subscriber about creates, updates, deletes and closes', async () => {
    const store = await load()
    const seen: Array<[string, string | null]> = []
    const off = store.onRecordChange((id, record) => seen.push([id, record?.description ?? null]))
    await store.setDescription(SNAP, 'one')
    await store.setDescription(SNAP, 'two')
    await store.markClosed('s1', new Date())
    off()
    await store.loadRecords()
    expect(seen).toEqual([
      ['s1', 'one'],
      ['s1', 'two'],
      ['s1', 'two'],
    ])
  })

  it('announces a delete with a null record', async () => {
    const store = await load()
    await store.setDescription(SNAP, 'one')
    const seen: Array<unknown> = []
    store.onRecordChange((_id, record) => seen.push(record))
    await store.setDescription(SNAP, null)
    expect(seen).toEqual([null])
  })
})
