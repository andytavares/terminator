import { vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { wrapDb } from '../../../../src/main/db/index'
import { dispatchChannel } from '@terminator/extension-sdk'
import type { ChannelSpec, ExtensionAPI, ExtensionDB } from '@terminator/extension-sdk'
import { applyTaskVaultSchema } from '../../src/vault/db'
import { insertTask, type NewTaskRow } from '../../src/vault/task-repository'

/** A real in-memory SQLite database with the task-vault schema applied. */
export async function createVaultDb(): Promise<ExtensionDB> {
  const db = wrapDb(new DatabaseSync(':memory:'))
  await applyTaskVaultSchema(db)
  return db
}

/** Stands in for the ExtensionAPI: collects the channels an extension registers. */
export function createIpcHarness() {
  const specs = new Map<string, ChannelSpec>()
  const createNotification = vi.fn()
  const api = {
    ipc: {
      registerHandler: (spec: ChannelSpec) => {
        specs.set(spec.channel, spec)
        return { dispose: () => specs.delete(spec.channel) }
      },
    },
    notifications: { createNotification },
  } as unknown as ExtensionAPI

  return {
    api,
    createNotification,
    channels: () => [...specs.keys()],
    specs: () => [...specs.values()],
    /** What a renderer's invoke reaches: the registered channel, payload parsing included. */
    invoke(channel: string, payload?: unknown): Promise<unknown> {
      const spec = specs.get(channel)
      if (!spec) throw new Error(`no handler registered for ${channel}`)
      return dispatchChannel(spec, payload)
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

/** An area's name, or its name and status (active when omitted). */
export type AreaSeed = string | { name: string; status?: string }

export async function seedArea(db: ExtensionDB, id: string, area: AreaSeed): Promise<string> {
  const { name, status = 'active' } = typeof area === 'string' ? { name: area } : area
  await db.run(
    `INSERT INTO areas (id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    [id, name, status, NOW, NOW]
  )
  return id
}

/** A project's name, or its name with a status and area. */
export type ProjectSeed = string | { name: string; status?: string; areaId?: string | null }

export async function seedProject(
  db: ExtensionDB,
  id: string,
  project: ProjectSeed
): Promise<string> {
  const fields = typeof project === 'string' ? { name: project } : project
  await db.run(
    `INSERT INTO projects (id, name, status, area_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, fields.name, fields.status ?? 'active', fields.areaId ?? null, NOW, NOW]
  )
  return id
}

export async function taskRow(db: ExtensionDB, id: string) {
  return db.get<Record<string, unknown>>(`SELECT * FROM tasks WHERE id = ?`, [id])
}
