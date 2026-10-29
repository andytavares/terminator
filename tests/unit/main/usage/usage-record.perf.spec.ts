import { describe, it, expect } from 'vitest'
import { mkdtempSync, statSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { wrapDb } from '../../../../src/main/db/index'
import { createUsageStore, openUsageDatabase } from '../../../../src/main/usage/usage-store'

// The store's own file settings. 5 ms a use, far above the 0.04 ms measured idle: ci:local runs
// this beside every other job. A use is one write per operator action.
const USES = 1_000
const BUDGET_MS = 5000

describe('usage recording', () => {
  it('records 1,000 uses into a file database within the budget', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'usage-perf-'))
    const file = path.join(dir, 'usage.sqlite')
    const database = openUsageDatabase(file)
    const store = createUsageStore(wrapDb(database), { now: () => new Date(), warn: () => {} })
    await store.declare([{ id: 'core.home', label: 'Home', kind: 'surface', source: 'core' }])

    const start = performance.now()
    for (let i = 0; i < USES; i++) await store.recordUse({ feature: 'core.home', via: 'click' })
    const elapsedMs = Math.round(performance.now() - start)
    database.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    console.log(`usage: ${USES} uses in ${elapsedMs} ms, file ${statSync(file).size} bytes`)

    expect((await store.report(null)).features[0].usesAllTime).toBe(USES)
    expect(elapsedMs).toBeLessThan(BUDGET_MS)
    database.close()
    rmSync(dir, { recursive: true })
  })
})
