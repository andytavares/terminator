import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, appendFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createJsonlLog } from '../../src/runtime/jsonl-log.js'

// Backs the two growing logs — stall firings and the feed (research.md R9).
// Append-only, so a torn final line from an interrupted write is expected and
// must never take the log down with it.

let dir: string
let logPath: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jsonl-log-'))
  logPath = join(dir, 'nested', 'firings.jsonl')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

interface Row {
  id: string
  at: number
}

describe('append and read', () => {
  it('creates the file and any missing parent directories on first append', () => {
    const log = createJsonlLog<Row>(logPath)
    log.append({ id: 'a', at: 1 })
    expect(existsSync(logPath)).toBe(true)
  })

  it('reads back what it appended, in order', () => {
    const log = createJsonlLog<Row>(logPath)
    log.append({ id: 'a', at: 1 })
    log.append({ id: 'b', at: 2 })
    log.append({ id: 'c', at: 3 })
    expect(log.readAll().map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('returns an empty list when the log does not exist yet', () => {
    expect(createJsonlLog<Row>(logPath).readAll()).toEqual([])
  })

  it('writes one line per record with no embedded newlines', () => {
    const log = createJsonlLog<Row>(logPath)
    log.append({ id: 'a\nb', at: 1 })
    const lines = readFileSync(logPath, 'utf-8').trimEnd().split('\n')
    expect(lines).toHaveLength(1)
    expect(log.readAll()[0].id).toBe('a\nb')
  })
})

describe('reading a range', () => {
  it('returns only records inside the window, inclusive of both bounds', () => {
    const log = createJsonlLog<Row>(logPath)
    for (const at of [10, 20, 30, 40]) log.append({ id: `r${at}`, at })
    const inRange = log.readRange((r) => r.at >= 20 && r.at <= 30)
    expect(inRange.map((r) => r.id)).toEqual(['r20', 'r30'])
  })

  it('returns an empty list when nothing matches', () => {
    const log = createJsonlLog<Row>(logPath)
    log.append({ id: 'a', at: 1 })
    expect(log.readRange((r) => r.at > 100)).toEqual([])
  })
})

describe('corruption tolerance', () => {
  it('skips a torn final line rather than throwing', () => {
    // The exact shape of an interrupted append: a partial JSON object with no
    // trailing newline. Losing that record is correct; losing the log is not.
    const log = createJsonlLog<Row>(logPath)
    log.append({ id: 'a', at: 1 })
    log.append({ id: 'b', at: 2 })
    appendFileSync(logPath, '{"id":"c","at":')
    expect(log.readAll().map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('skips an unparseable line in the middle and keeps the rest', () => {
    const log = createJsonlLog<Row>(logPath)
    log.append({ id: 'a', at: 1 })
    appendFileSync(logPath, 'not json at all\n')
    log.append({ id: 'c', at: 3 })
    expect(log.readAll().map((r) => r.id)).toEqual(['a', 'c'])
  })

  it('ignores blank lines', () => {
    const log = createJsonlLog<Row>(logPath)
    log.append({ id: 'a', at: 1 })
    appendFileSync(logPath, '\n\n')
    log.append({ id: 'b', at: 2 })
    expect(log.readAll()).toHaveLength(2)
  })

  it('can still append after encountering a torn line', () => {
    const log = createJsonlLog<Row>(logPath)
    log.append({ id: 'a', at: 1 })
    appendFileSync(logPath, '{"id":"torn"')
    log.append({ id: 'b', at: 2 })
    expect(log.readAll().map((r) => r.id)).toEqual(['a', 'b'])
  })
})

describe('count', () => {
  it('counts only well-formed records', () => {
    const log = createJsonlLog<Row>(logPath)
    log.append({ id: 'a', at: 1 })
    appendFileSync(logPath, 'garbage\n')
    log.append({ id: 'b', at: 2 })
    expect(log.count()).toBe(2)
  })

  it('is zero for a log that does not exist', () => {
    expect(createJsonlLog<Row>(logPath).count()).toBe(0)
  })
})
