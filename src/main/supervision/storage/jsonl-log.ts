import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  openSync,
  readSync,
  closeSync,
} from 'fs'
import { dirname } from 'path'

// Append-only JSONL, backing the two logs that grow without bound: stall
// firings and the feed (research.md R9). electron-store would hold each of
// these as one JSON blob and reload the whole thing on every write, which is
// the wrong shape for an append-mostly record.
//
// Reads are deliberately forgiving. An append interrupted mid-write leaves a
// torn final line; losing that one record is correct, losing the log is not.

export interface JsonlLog<T> {
  append(record: T): void
  readAll(): T[]
  readRange(predicate: (record: T) => boolean): T[]
  count(): number
}

function parseLines<T>(path: string): T[] {
  if (!existsSync(path)) return []
  const records: T[] = []
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    try {
      records.push(JSON.parse(trimmed) as T)
    } catch {
      // Torn or corrupt line. Skip it and keep reading — a partial write must
      // never take the rest of the log down with it.
    }
  }
  return records
}

/** Reads only the final byte, so log size does not affect append cost. */
function endsWithoutNewline(path: string): boolean {
  if (!existsSync(path)) return false
  const size = statSync(path).size
  if (size === 0) return false
  const fd = openSync(path, 'r')
  try {
    const last = Buffer.alloc(1)
    readSync(fd, last, 0, 1, size - 1)
    return last[0] !== 0x0a
  } finally {
    closeSync(fd)
  }
}

export function createJsonlLog<T>(path: string): JsonlLog<T> {
  return {
    append(record: T): void {
      mkdirSync(dirname(path), { recursive: true })
      // Heal a torn tail before appending. If a previous write was interrupted
      // the file ends mid-record with no newline, and appending directly would
      // fuse the new record onto the broken one — losing two records instead of
      // one. Terminating the torn line first confines the damage to it.
      if (endsWithoutNewline(path)) appendFileSync(path, '\n', 'utf-8')
      // JSON.stringify never emits a raw newline, so one record is one line
      // even when a field value contains one.
      appendFileSync(path, JSON.stringify(record) + '\n', 'utf-8')
    },

    readAll(): T[] {
      return parseLines<T>(path)
    },

    readRange(predicate: (record: T) => boolean): T[] {
      return parseLines<T>(path).filter(predicate)
    },

    count(): number {
      return parseLines<T>(path).length
    },
  }
}
