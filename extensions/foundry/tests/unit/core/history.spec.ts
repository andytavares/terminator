import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { tmpdir } from 'node:os'
import { appendHistoryEntry, readHistory } from '../../../src/core/history.js'
import type { HistoryEntry } from '../../../src/types/foundry.types.js'

function makeEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    runId: 'run-001',
    mode: 'spec-to-code',
    providerId: 'provider-1',
    providerLabel: 'Claude',
    model: 'claude-sonnet-4-6',
    promptSummary: 'Test spec',
    status: 'done',
    tokenCountIn: 1000,
    tokenCountOut: 500,
    sensorSummary: '2/2 pass',
    gateDecisions: [],
    filesChangedCount: 3,
    durationMs: 60000,
    createdAt: '2026-05-28T10:00:00.000Z',
    completedAt: '2026-05-28T10:01:00.000Z',
    ...overrides,
  }
}

async function makeTmp(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'foundry-history-test-'))
  return { dir, cleanup: () => fs.rm(dir, { recursive: true, force: true }) }
}

describe('appendHistoryEntry()', () => {
  let dir: string
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    ;({ dir, cleanup } = await makeTmp())
  })
  afterEach(async () => cleanup())

  it('creates .foundry dir and history.jsonl if absent', async () => {
    await appendHistoryEntry(dir, makeEntry())
    const exists = await fs
      .access(path.join(dir, '.foundry', 'history.jsonl'))
      .then(() => true)
      .catch(() => false)
    expect(exists).toBe(true)
  })

  it('appends a valid JSON line', async () => {
    const entry = makeEntry({ runId: 'abc123' })
    await appendHistoryEntry(dir, entry)
    const raw = await fs.readFile(path.join(dir, '.foundry', 'history.jsonl'), 'utf-8')
    const lines = raw.trim().split('\n')
    expect(lines).toHaveLength(1)
    const parsed = JSON.parse(lines[0])
    expect(parsed.runId).toBe('abc123')
  })

  it('appends multiple entries as separate lines', async () => {
    await appendHistoryEntry(dir, makeEntry({ runId: 'r1' }))
    await appendHistoryEntry(dir, makeEntry({ runId: 'r2' }))
    await appendHistoryEntry(dir, makeEntry({ runId: 'r3' }))
    const raw = await fs.readFile(path.join(dir, '.foundry', 'history.jsonl'), 'utf-8')
    const lines = raw.trim().split('\n').filter(Boolean)
    expect(lines).toHaveLength(3)
  })
})

describe('readHistory()', () => {
  let dir: string
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    ;({ dir, cleanup } = await makeTmp())
  })
  afterEach(async () => cleanup())

  it('returns empty list and zero total when file absent', async () => {
    const result = await readHistory(dir, 0, 200)
    expect(result).toEqual({ entries: [], total: 0, hasMore: false })
  })

  it('returns entries in reverse order (newest first)', async () => {
    for (let i = 1; i <= 3; i++) {
      await appendHistoryEntry(dir, makeEntry({ runId: `r${i}` }))
    }
    const { entries } = await readHistory(dir, 0, 10)
    expect(entries[0].runId).toBe('r3')
    expect(entries[1].runId).toBe('r2')
    expect(entries[2].runId).toBe('r1')
  })

  it('paginates correctly with offset and limit', async () => {
    for (let i = 1; i <= 5; i++) {
      await appendHistoryEntry(dir, makeEntry({ runId: `r${i}` }))
    }
    const page1 = await readHistory(dir, 0, 2)
    expect(page1.entries).toHaveLength(2)
    expect(page1.hasMore).toBe(true)
    expect(page1.total).toBe(5)

    const page2 = await readHistory(dir, 2, 2)
    expect(page2.entries).toHaveLength(2)
    expect(page2.hasMore).toBe(true)

    const page3 = await readHistory(dir, 4, 2)
    expect(page3.entries).toHaveLength(1)
    expect(page3.hasMore).toBe(false)
  })

  it('gracefully skips malformed lines', async () => {
    const foundryDir = path.join(dir, '.foundry')
    await fs.mkdir(foundryDir, { recursive: true })
    await fs.writeFile(
      path.join(foundryDir, 'history.jsonl'),
      'not json\n' + JSON.stringify(makeEntry({ runId: 'ok' })) + '\n'
    )
    const { entries, total } = await readHistory(dir, 0, 10)
    expect(entries).toHaveLength(1)
    expect(entries[0].runId).toBe('ok')
    expect(total).toBe(1)
  })
})
