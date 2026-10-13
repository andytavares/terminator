import { describe, it, expect, beforeEach } from 'vitest'
import type { ExtensionDB } from '@terminator/extension-sdk'
import {
  migrateStoredStaleThreshold,
  staleDaysThreshold,
  STALE_THRESHOLD_KEY,
} from '../src/stale-threshold'
import { createIpcHarness, createVaultDb } from './support/vault-db'

let db: ExtensionDB
let harness: ReturnType<typeof createIpcHarness>

beforeEach(async () => {
  db = await createVaultDb()
  harness = createIpcHarness()
})

const storedRows = () =>
  db.query(
    `SELECT value FROM settings WHERE extension_id='task-vault' AND key='stale_days_threshold'`
  )

describe('staleDaysThreshold', () => {
  it('reads the "Stale task threshold" setting', () => {
    harness.settings.set(STALE_THRESHOLD_KEY, 4)
    expect(staleDaysThreshold(harness.api)).toBe(4)
  })

  it('is seven days when the setting is unset, emptied or unreadable', () => {
    expect(staleDaysThreshold(harness.api)).toBe(7)
    harness.settings.set(STALE_THRESHOLD_KEY, '')
    expect(staleDaysThreshold(harness.api)).toBe(7)
    harness.settings.set(STALE_THRESHOLD_KEY, 'soon')
    expect(staleDaysThreshold(harness.api)).toBe(7)
  })

  it('keeps the threshold within 1 to 365 days', () => {
    harness.settings.set(STALE_THRESHOLD_KEY, 0)
    expect(staleDaysThreshold(harness.api)).toBe(1)
    harness.settings.set(STALE_THRESHOLD_KEY, 1000)
    expect(staleDaysThreshold(harness.api)).toBe(365)
  })
})

describe('migrateStoredStaleThreshold', () => {
  it('moves a threshold earlier versions kept in the vault into the setting', async () => {
    await db.run(
      `INSERT INTO settings (extension_id, key, value) VALUES ('task-vault', 'stale_days_threshold', '12')`
    )

    await migrateStoredStaleThreshold(harness.api, db)

    expect(harness.settings.get(STALE_THRESHOLD_KEY)).toBe(12)
    expect(await storedRows()).toEqual([])
  })

  it('leaves the setting alone when the vault holds no threshold', async () => {
    harness.settings.set(STALE_THRESHOLD_KEY, 5)

    await migrateStoredStaleThreshold(harness.api, db)

    expect(harness.settings.get(STALE_THRESHOLD_KEY)).toBe(5)
  })
})
