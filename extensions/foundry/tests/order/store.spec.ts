import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createOrderStore } from '../../src/order/store.js'
import { draftOrder } from '../../src/order/schema.js'
import type { WorkOrder } from '../../src/order/schema.js'
import { SCHEMA_VERSION } from '../../src/order/schema.js'

let root: string

function order(over: Partial<WorkOrder> = {}): WorkOrder {
  return {
    ...draftOrder({
      id: 'WO-0913-c71',
      title: 'Terminal clips the last glyph',
      source: { kind: 'typed', tracker: null, key: null, url: null },
      repoPaths: ['/repos/a'],
      now: '2026-09-06T10:00:00.000Z',
    }),
    ...over,
  }
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-store-'))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('createOrderStore', () => {
  it('writes the truth and its rendering side by side', async () => {
    const store = createOrderStore(root)
    await store.save(order())
    const dir = path.join(root, 'orders', 'WO-0913-c71')
    expect(fs.existsSync(path.join(dir, 'order.json'))).toBe(true)
    expect(fs.readFileSync(path.join(dir, 'order.md'), 'utf8')).toContain(
      '# Terminal clips the last glyph'
    )
  })

  it('reads back exactly what it wrote', async () => {
    const store = createOrderStore(root)
    await store.save(order())
    const loaded = await store.load('WO-0913-c71')
    expect(loaded?.id).toBe('WO-0913-c71')
    expect(loaded?.schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('regenerates the rendering on every save rather than leaving it stale', async () => {
    const store = createOrderStore(root)
    await store.save(order())
    await store.save(order({ title: 'A different title' }))
    expect(fs.readFileSync(path.join(root, 'orders', 'WO-0913-c71', 'order.md'), 'utf8')).toContain(
      'A different title'
    )
  })

  it('returns null for an order that does not exist', async () => {
    expect(await createOrderStore(root).load('WO-nope')).toBeNull()
  })

  it('returns null for a corrupt order rather than throwing', async () => {
    const dir = path.join(root, 'orders', 'WO-bad')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'order.json'), '{{{')
    expect(await createOrderStore(root).load('WO-bad')).toBeNull()
  })

  it('lists orders newest first', async () => {
    const store = createOrderStore(root)
    await store.save(order({ id: 'WO-1', createdAt: '2026-09-01T10:00:00.000Z' }))
    await store.save(order({ id: 'WO-2', createdAt: '2026-09-05T10:00:00.000Z' }))
    expect((await store.list()).map((o) => o.id)).toEqual(['WO-2', 'WO-1'])
  })

  it('lists nothing before any order exists', async () => {
    expect(await createOrderStore(root).list()).toEqual([])
  })

  it('skips a corrupt order without losing the rest', async () => {
    const store = createOrderStore(root)
    await store.save(order({ id: 'WO-good' }))
    const bad = path.join(root, 'orders', 'WO-bad')
    fs.mkdirSync(bad, { recursive: true })
    fs.writeFileSync(path.join(bad, 'order.json'), 'not json')
    expect((await store.list()).map((o) => o.id)).toEqual(['WO-good'])
  })

  it('finds an open order already seeded from an issue', async () => {
    const store = createOrderStore(root)
    await store.save(
      order({
        id: 'WO-tav',
        source: { kind: 'tracker', tracker: 'linear', key: 'TAV-42', url: 'u' },
      })
    )
    expect(await store.findByIssue('linear', 'TAV-42')).toEqual({
      id: 'WO-tav',
      title: 'Terminal clips the last glyph',
    })
  })

  it('does not offer a shipped order when the same issue is seeded again', async () => {
    const store = createOrderStore(root)
    await store.save(
      order({
        id: 'WO-tav',
        status: 'shipped',
        source: { kind: 'tracker', tracker: 'linear', key: 'TAV-42', url: 'u' },
      })
    )
    expect(await store.findByIssue('linear', 'TAV-42')).toBeNull()
  })

  it('does not confuse the same key on two different trackers', async () => {
    const store = createOrderStore(root)
    await store.save(
      order({ id: 'WO-l', source: { kind: 'tracker', tracker: 'linear', key: 'X-1', url: 'u' } })
    )
    expect(await store.findByIssue('jira', 'X-1')).toBeNull()
  })

  it('appends a decision to that order own ledger', async () => {
    const store = createOrderStore(root)
    await store.record({
      at: '2026-09-06T10:00:00.000Z',
      orderId: 'WO-0913-c71',
      actor: 'operator',
      action: 'order.agreed',
      subject: 'WO-0913-c71',
      reason: 'all six checks pass',
      evidence: [],
    })
    const ledger = path.join(root, 'orders', 'WO-0913-c71', 'ledger.jsonl')
    expect(JSON.parse(fs.readFileSync(ledger, 'utf8').trim()).action).toBe('order.agreed')
  })
})
