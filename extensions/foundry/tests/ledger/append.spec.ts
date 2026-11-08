import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { appendEntry, readEntries } from '../../src/ledger/append.js'
import type { LedgerEntry } from '../../src/ledger/append.js'
import { makeTempDir } from '../../../../tests/support/temp-dir'

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
  dir = makeTempDir('foundry-ledger-')
  file = path.join(dir, 'ledger.jsonl')
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('appendEntry', () => {
  describe('writing lines', writingLinesTests)
  describe('concurrent and invalid entries', concurrentAndInvalidEntriesTests)
})

function writingLinesTests() {
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
}

function concurrentAndInvalidEntriesTests() {
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
}

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

describe('every decision is attributable (FR-078)', () => {
  describe('who, what and why', whoWhatAndWhyTests)
  describe('gaps', gapsTests)
})

function whoWhatAndWhyTests() {
  it('reads back who, what, about what, why, the evidence and the order of every entry, a reversal as its own entry', async () => {
    const written = [
      entry({
        actor: 'operator',
        action: 'gate.decided',
        subject: 'G-1',
        reason: 'risk.p0 -> send_back: the token comparison is not constant time',
        evidence: [
          { kind: 'exit_code', exitCode: 1 },
          { kind: 'diff', path: 'src/a.ts' },
        ],
      }),
      entry({ actor: 'rule:budget.exceeded', action: 'gate.reversed', subject: 'G-1' }),
      entry({ orderId: 'WO-2', actor: 'role:verifier', subject: 'G-3', reason: 'tests pass' }),
    ]
    await appendEntry(file, written[0])
    await appendEntry(file, written[1])
    await appendEntry(file, written[2])

    expect(await readEntries(file)).toEqual(written)
  })
}

function gapsTests() {
  it('accepts an entry with no reason but keeps the field, so the gap is visible', async () => {
    // A reason is not structurally required — the curator skips what has none
    // rather than the ledger refusing to record that something happened.
    await appendEntry(file, entry({ reason: '' }))
    expect((await readEntries(file))[0].reason).toBe('')
  })
}

describe('a torn last line', () => {
  it('costs only the torn line, never the entry written after it', async () => {
    await appendEntry(file, entry({ subject: 'before' }))
    // A process killed part-way through a write leaves a line with no newline.
    await fs.promises.appendFile(file, '{"at":"2026-09-06T10:01:00.000Z","orderId":"WO-0', 'utf8')
    await appendEntry(file, entry({ subject: 'after' }))
    expect((await readEntries(file)).map((e) => e.subject)).toEqual(['before', 'after'])
  })
})
