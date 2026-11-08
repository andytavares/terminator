import { describe, it, expect, afterEach } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import * as path from 'node:path'
import { openUsageDatabase } from '../../../../src/main/usage/usage-store'
import { makeTempDir } from '../../../support/temp-dir'

let database: DatabaseSync | null = null

afterEach(() => {
  database?.close()
  database = null
})

function openedFile(): DatabaseSync {
  database = openUsageDatabase(path.join(makeTempDir('usage-db-'), 'usage.sqlite'))
  return database
}

// A use is one write per operator action, so a write must not wait for the disk: WAL with
// synchronous NORMAL syncs at checkpoints only (sqlite.org/pragma.html#pragma_synchronous).
describe('the usage database file', () => {
  it('is in WAL mode', () => {
    expect(openedFile().prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' })
  })

  it('syncs the disk at checkpoints, not on every write (synchronous NORMAL)', () => {
    expect(openedFile().prepare('PRAGMA synchronous').get()).toEqual({ synchronous: 1 })
  })
})
