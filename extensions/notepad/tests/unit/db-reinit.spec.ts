import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { dispatchChannel } from '@terminator/extension-sdk'
import type { ChannelSpec, ExtensionAPI, ExtensionDB } from '@terminator/extension-sdk'
import { wrapDb } from '../../../../src/main/db/index'
import { partialFake } from '../../../../tests/support/fakes'
import { activate, deactivate } from '../../src/index'

// Notepad's "Re-initialise database" setting: its button runs
// terminator.notepad:db.reinit, which re-applies the schema and keeps the notes.

let db: ExtensionDB

beforeEach(() => {
  db = wrapDb(new DatabaseSync(':memory:'))
})

const disposable = () => ({ dispose: vi.fn() })

/** Activates Notepad on the test database and returns its channels by name. */
async function activateNotepad(): Promise<Map<string, ChannelSpec>> {
  const channels = new Map<string, ChannelSpec>()
  await activate(
    partialFake<ExtensionAPI>({
      db,
      ipc: partialFake<ExtensionAPI['ipc']>({
        registerHandler: (spec: ChannelSpec) => {
          channels.set(spec.channel, spec)
          return disposable()
        },
      }),
      settings: partialFake<ExtensionAPI['settings']>({ register: vi.fn(disposable) }),
      window: partialFake<ExtensionAPI['window']>({ broadcast: vi.fn(), openAuxiliary: vi.fn() }),
      notifications: partialFake<ExtensionAPI['notifications']>({ showToast: vi.fn() }),
      nativeMenu: partialFake<ExtensionAPI['nativeMenu']>({ addViewMenuItem: vi.fn(disposable) }),
      commands: partialFake<ExtensionAPI['commands']>({ register: vi.fn(disposable) }),
    })
  )
  deactivate()
  return channels
}

const tableNames = async () =>
  (await db.query<{ name: string }>(`SELECT name FROM sqlite_master WHERE type='table'`)).map(
    (row) => row.name
  )

describe('Re-initialise database', () => {
  it('puts back a table the schema declares, and keeps the notes', async () => {
    const reinit = (await activateNotepad()).get('terminator.notepad:db.reinit')!
    await db.run(
      `INSERT INTO notes (id, title, body, created_at, updated_at) VALUES ('n1', 'Plan', 'body', 'now', 'now')`
    )
    await db.exec('DROP TABLE diagram_comments')

    expect(await dispatchChannel(reinit, undefined)).toEqual({ data: { ok: true } })

    expect(await tableNames()).toContain('diagram_comments')
    expect(await db.query(`SELECT id FROM notes`)).toEqual([{ id: 'n1' }])
  })
})
