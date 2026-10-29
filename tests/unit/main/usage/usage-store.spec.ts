import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { wrapDb } from '../../../../src/main/db/index'
import { createUsageStore } from '../../../../src/main/usage/usage-store'
import type { FeatureDeclaration } from '../../../../src/shared/schemas/usage.schema'

const notes: FeatureDeclaration = {
  id: 'ext.notes',
  label: 'Notes',
  kind: 'surface',
  source: 'ext',
}
const search: FeatureDeclaration = {
  id: 'core.search',
  label: 'Search',
  kind: 'action',
  source: 'core',
}

let database: DatabaseSync
let clock: Date
let warn: Mock<(message: string) => void>

function openStore() {
  return createUsageStore(wrapDb(database), { now: () => clock, warn })
}

async function rowOf(store: ReturnType<typeof openStore>, id: string, from: string | null = null) {
  return (await store.report(from)).features.find((f) => f.id === id)!
}

beforeEach(() => {
  database = new DatabaseSync(':memory:')
  clock = new Date(2026, 9, 28, 12, 0, 0)
  warn = vi.fn()
})

describe('recordUse', () => {
  it('folds two uses on the same day by the same route into one row', async () => {
    const store = openStore()
    await store.declare([notes])
    await store.recordUse({ feature: 'ext.notes', via: 'click' })
    await store.recordUse({ feature: 'ext.notes', via: 'click' })
    const rows = database.prepare('SELECT uses FROM usage_day').all()
    expect(rows).toEqual([{ uses: 2 }])
  })

  it('keeps a second route as its own row', async () => {
    const store = openStore()
    await store.declare([notes])
    await store.recordUse({ feature: 'ext.notes', via: 'click' })
    await store.recordUse({ feature: 'ext.notes', via: 'palette' })
    expect((await rowOf(store, 'ext.notes')).byVia).toEqual({ click: 1, palette: 1 })
  })
})

describe('recordUse — failures and days', () => {
  it('counts failures', async () => {
    const store = openStore()
    await store.declare([notes])
    await store.recordUse({ feature: 'ext.notes', via: 'click', failed: true })
    await store.recordUse({ feature: 'ext.notes', via: 'click' })
    const row = await rowOf(store, 'ext.notes')
    expect([row.usesAllTime, row.failures]).toEqual([2, 1])
  })

  it('puts 23:59 and 00:01 local time on two days', async () => {
    const store = openStore()
    await store.declare([notes])
    clock = new Date(2026, 9, 28, 23, 59, 0)
    await store.recordUse({ feature: 'ext.notes', via: 'click' })
    clock = new Date(2026, 9, 29, 0, 1, 0)
    await store.recordUse({ feature: 'ext.notes', via: 'click' })
    const days = database.prepare('SELECT day FROM usage_day ORDER BY day').all()
    expect(days).toEqual([{ day: '2026-10-28' }, { day: '2026-10-29' }])
  })
})

describe('recordUse — undeclared ids', () => {
  it('writes nothing for an undeclared id and warns once for two calls', async () => {
    const store = openStore()
    await store.recordUse({ feature: 'ext.ghost', via: 'click' })
    await store.recordUse({ feature: 'ext.ghost', via: 'click' })
    expect(database.prepare('SELECT * FROM usage_day').all()).toEqual([])
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('declares an unknown id from the call and stores the use', async () => {
    const store = openStore()
    await store.recordUse({
      feature: 'ext.notes',
      via: 'click',
      declare: { label: 'Notes', kind: 'surface', source: 'ext' },
    })
    const row = await rowOf(store, 'ext.notes')
    expect([row.label, row.usesAllTime, row.declared]).toEqual(['Notes', 1, true])
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('recordUse — active time and last use', () => {
  it('adds active time and no use when the record carries active time', async () => {
    const store = openStore()
    await store.declare([notes])
    await store.recordUse({ feature: 'ext.notes', via: 'shown', activeMs: 4000 })
    const row = await rowOf(store, 'ext.notes')
    expect([row.activeMs, row.usesAllTime, row.lastUsedAt]).toEqual([4000, 0, null])
  })

  it('sets lastUsedAt to the time of the use', async () => {
    const store = openStore()
    await store.declare([notes])
    await store.recordUse({ feature: 'ext.notes', via: 'click' })
    expect((await rowOf(store, 'ext.notes')).lastUsedAt).toBe(clock.toISOString())
  })
})

describe('declare', () => {
  it('keeps firstDeclared and updates the label on a second declare', async () => {
    const store = openStore()
    await store.declare([notes])
    const first = clock.toISOString()
    clock = new Date(2026, 10, 2, 9, 0, 0)
    await store.declare([{ ...notes, label: 'Notebook' }])
    const row = await rowOf(store, 'ext.notes')
    expect([row.firstDeclared, row.label]).toEqual([first, 'Notebook'])
  })
})

describe('report — periods', () => {
  it('zero-fills daily from the period start to today, oldest first', async () => {
    const store = openStore()
    await store.declare([notes])
    clock = new Date(2026, 9, 26, 10, 0, 0)
    await store.recordUse({ feature: 'ext.notes', via: 'click' })
    clock = new Date(2026, 9, 28, 10, 0, 0)
    await store.recordUse({ feature: 'ext.notes', via: 'click' })
    await store.recordUse({ feature: 'ext.notes', via: 'click' })
    expect((await rowOf(store, 'ext.notes', '2026-10-25')).daily).toEqual([0, 1, 0, 2])
  })

  it('counts a period apart from all time, and lists the last 30 days for all time', async () => {
    const store = openStore()
    await store.declare([notes])
    clock = new Date(2026, 9, 1, 10, 0, 0)
    await store.recordUse({ feature: 'ext.notes', via: 'click' })
    clock = new Date(2026, 9, 28, 10, 0, 0)
    await store.recordUse({ feature: 'ext.notes', via: 'click' })
    const week = await rowOf(store, 'ext.notes', '2026-10-22')
    expect([week.usesInPeriod, week.usesAllTime]).toEqual([1, 2])
    const all = await rowOf(store, 'ext.notes', null)
    expect([all.usesInPeriod, all.daily.length]).toEqual([2, 30])
  })
})

describe('report — declared and counting since', () => {
  it('reports declared false for a feature stored by an earlier run and not declared since', async () => {
    await openStore().declare([notes, search])
    const later = openStore()
    await later.declare([search])
    const report = await later.report(null)
    const declared = Object.fromEntries(report.features.map((f) => [f.id, f.declared]))
    expect(declared).toEqual({ 'core.search': true, 'ext.notes': false })
  })

  it('says since when counting began, and null for an empty store', async () => {
    const store = openStore()
    expect((await store.report(null)).countingSince).toBeNull()
    await store.declare([notes])
    expect((await store.report(null)).countingSince).toBe(clock.toISOString())
  })
})
