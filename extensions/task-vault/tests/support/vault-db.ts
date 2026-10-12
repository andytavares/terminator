import { vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { wrapDb } from '../../../../src/main/db/index'
import type { ExtensionAPI, ExtensionDB } from '../../../../src/main/extensions/api'
import { applyTaskVaultSchema } from '../../src/vault/db'
import { insertTask, type NewTaskRow } from '../../src/vault/task-repository'

/** A real in-memory SQLite database with the task-vault schema applied. */
export async function createVaultDb(): Promise<ExtensionDB> {
  const db = wrapDb(new DatabaseSync(':memory:'))
  await applyTaskVaultSchema(db)
  return db
}

type Handler = (payload: unknown) => Promise<unknown> | unknown

/** Stands in for the ExtensionAPI: collects the handlers an extension registers. */
export function createIpcHarness() {
  const handlers = new Map<string, Handler>()
  const createNotification = vi.fn()
  const api = {
    ipc: {
      registerHandler: (channel: string, handler: Handler) => {
        handlers.set(channel, handler)
        return { dispose: () => handlers.delete(channel) }
      },
    },
    notifications: { createNotification },
  } as unknown as ExtensionAPI

  return {
    api,
    createNotification,
    channels: () => [...handlers.keys()],
    invoke(channel: string, payload?: unknown): Promise<unknown> {
      const handler = handlers.get(channel)
      if (!handler) throw new Error(`no handler registered for ${channel}`)
      return Promise.resolve(handler(payload))
    },
  }
}

const NOW = '2026-01-10T09:00:00.000Z'

/** Inserts a task through the production insert path; every field has a default. */
export async function seedTask(
  db: ExtensionDB,
  row: Partial<NewTaskRow> & { id: string }
): Promise<string> {
  await insertTask(db, {
    text: `Task ${row.id}`,
    status: 'open',
    source: 'inbox',
    createdAt: NOW,
    updatedAt: NOW,
    ...row,
  })
  return row.id
}

export async function seedArea(
  db: ExtensionDB,
  id: string,
  name: string,
  status = 'active'
): Promise<string> {
  await db.run(
    `INSERT INTO areas (id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    [id, name, status, NOW, NOW]
  )
  return id
}

export async function seedProject(
  db: ExtensionDB,
  id: string,
  name: string,
  fields: { status?: string; areaId?: string | null } = {}
): Promise<string> {
  await db.run(
    `INSERT INTO projects (id, name, status, area_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, name, fields.status ?? 'active', fields.areaId ?? null, NOW, NOW]
  )
  return id
}

export async function taskRow(db: ExtensionDB, id: string) {
  return db.get<Record<string, unknown>>(`SELECT * FROM tasks WHERE id = ?`, [id])
}
