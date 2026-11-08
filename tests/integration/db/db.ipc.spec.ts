import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { rmSync } from 'node:fs'
import { makeTempDir } from '../../support/temp-dir'

type Handler = (event: unknown, payload?: unknown) => unknown
const handlers = vi.hoisted(() => new Map<string, Handler>())

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
}))

import { registerDbIpcHandlers } from '../../../src/main/ipc/db.ipc'
import { initAppDb, closeAppDb } from '../../../src/main/db/index'

// The handler runs against the real node:sqlite database, not a stub of it.
describe('db:health', () => {
  let userData: string

  beforeAll(() => registerDbIpcHandlers())

  afterEach(() => {
    closeAppDb()
    if (userData) rmSync(userData, { recursive: true, force: true })
  })

  it('answers ok while the app database is open', async () => {
    userData = makeTempDir('db-health-')
    initAppDb(userData)

    expect(await handlers.get('db:health')!({})).toEqual({ ok: true })
  })

  it('answers not ok, with the reason, before the database has been opened', async () => {
    expect(await handlers.get('db:health')!({})).toEqual({
      ok: false,
      message: 'AppDB not initialized — call initAppDb first',
    })
  })
})
