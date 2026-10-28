import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { wrapDb } from '../../../../src/main/db/index'
import type { ExtensionDB } from '@terminator/extension-sdk'
import { createIpcHarness, createVaultDb, seedTask } from '../support/vault-db'

vi.mock('../../src/notifications/task-scheduler.js', () => ({
  triggerSchedulerTick: vi.fn(),
  broadcast: vi.fn(),
}))

import { registerVaultIpcHandlers } from '../../src/ipc/vault.ipc'

let db: ExtensionDB
let harness: ReturnType<typeof createIpcHarness>

beforeEach(async () => {
  db = await createVaultDb()
  harness = createIpcHarness()
  registerVaultIpcHandlers(harness.api, db)
})

describe('task-vault:vault:list-contexts', () => {
  it('returns the distinct non-empty contexts in order', async () => {
    await seedTask(db, { id: 't1', context: 'work' })
    await seedTask(db, { id: 't2', context: 'home' })
    await seedTask(db, { id: 't3', context: 'work' })
    await seedTask(db, { id: 't4', context: '' })
    await seedTask(db, { id: 't5' })

    expect(await harness.invoke('task-vault:vault:list-contexts')).toEqual({
      contexts: ['home', 'work'],
    })
  })

  it('returns the error when the database is closed', async () => {
    const database = new DatabaseSync(':memory:')
    const closed = wrapDb(database)
    database.close()
    const other = createIpcHarness()
    registerVaultIpcHandlers(other.api, closed)

    expect(await other.invoke('task-vault:vault:list-contexts')).toMatchObject({
      error: expect.stringMatching(/not open/),
    })
  })
})
