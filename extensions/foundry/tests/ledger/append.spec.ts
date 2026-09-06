import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { appendEntry, readEntries, queryEntries } from '../../src/ledger/append.js'
import type { LedgerEntry } from '../../src/ledger/append.js'

// The ledger is the record of every decision, by whom or by what rule, and why
// (FR-078). It is append-only: a reversal is a new entry, never a rewritten
// line. That property is what lets several unit writers append at once without
// a lock, and what makes the curator's citations meaningful later.

let dir: string
let file: string

function entry(over: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    at: '2026-09-06T10:00:00.000Z',
    orderId: 'WO-0913-c71',
    actor: 'operator',
    action: 'gate.decided',
    subject: 'G-1',
    reason: 'looks right',
    evidence: [],
    ...over,
  }
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-ledger-'))
  file = path.join(dir, 'ledger.jsonl')
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('appendEntry', () => {
  it('creates the file and its parent directory on first write', async () => {
    const nested = path.join(dir, 'orders', 'WO-1', 'ledger.jsonl')
    await appendEntry(nested, entry())
    expect(fs.existsSync(nested)).toBe(true)
  })

  it('writes one entry per line as valid JSON', async () => {
    await appendEntry(file, entry({ subject: 'A' }))
    await appendEntry(file, entry({ subject: 'B' }))
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(lines.map((l) => JSON.parse(l).subject)).toEqual(['A', 'B'])
  })

  it('never rewrites an existing line', async () => {
    await appendEntry(file, entry({ subject: 'first' }))
    const before = fs.readFileSync(file, 'utf8')
    await appendEntry(file, entry({ subject: 'second' }))
    expect(fs.readFileSync(file, 'utf8').startsWith(before)).toBe(true)
  })

  it('records a reversal as a new entry rather than by editing the original', async () => {
    await appendEntry(file, entry({ action: 'gate.decided', subject: 'G-1' }))
    await appendEntry(file, entry({ action: 'gate.reversed', subject: 'G-1' }))
    const entries = await readEntries(file)
    expect(entries.map((e) => e.action)).toEqual(['gate.decided', 'gate.reversed'])
  })

  it('lands every entry when many writers append at once', async () => {
    await Promise.all(
      Array.from({ length: 40 }, (_, i) => appendEntry(file, entry({ subject: `S-${i}` })))
    )
    const entries = await readEntries(file)
    expect(entries).toHaveLength(40)
    expect(new Set(entries.map((e) => e.subject)).size).toBe(40)
  })

  it('rejects an entry with no actor, since an unattributed decision is not a record', async () => {
    await expect(appendEntry(file, entry({ actor: '' }))).rejects.toThrow()
  })

  it('rejects an entry with no action', async () => {
    await expect(appendEntry(file, entry({ action: '' }))).rejects.toThrow()
  })
})

describe('readEntries', () => {
  it('returns nothing for a ledger that does not exist yet', async () => {
    expect(await readEntries(path.join(dir, 'absent.jsonl'))).toEqual([])
  })

  it('skips a corrupt line rather than losing the whole ledger', async () => {
    await appendEntry(file, entry({ subject: 'good-1' }))
    fs.appendFileSync(file, '{{{ not json\n')
    await appendEntry(file, entry({ subject: 'good-2' }))
    const entries = await readEntries(file)
    expect(entries.map((e) => e.subject)).toEqual(['good-1', 'good-2'])
  })
})

describe('queryEntries', () => {
  beforeEach(async () => {
    await appendEntry(file, entry({ actor: 'operator', action: 'gate.decided', subject: 'G-1' }))
    await appendEntry(file, entry({ actor: 'rule:risk.p0', action: 'gate.raised', subject: 'G-2' }))
    await appendEntry(
      file,
      entry({
        actor: 'role:verifier',
        action: 'verdict',
        subject: 'U-1',
        at: '2026-09-07T10:00:00.000Z',
      })
    )
  })

  it('filters by actor', async () => {
    const r = await queryEntries(file, { actor: 'operator' })
    expect(r.map((e) => e.subject)).toEqual(['G-1'])
  })

  it('filters by action', async () => {
    const r = await queryEntries(file, { action: 'gate.raised' })
    expect(r.map((e) => e.subject)).toEqual(['G-2'])
  })

  it('filters by time', async () => {
    const r = await queryEntries(file, { since: '2026-09-07T00:00:00.000Z' })
    expect(r.map((e) => e.subject)).toEqual(['U-1'])
  })

  it('honours a limit, keeping the most recent', async () => {
    const r = await queryEntries(file, { limit: 1 })
    expect(r).toHaveLength(1)
    expect(r[0].subject).toBe('U-1')
  })
})
