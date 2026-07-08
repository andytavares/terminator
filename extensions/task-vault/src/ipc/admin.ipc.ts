import type { ExtensionAPI, ExtensionDB } from '../../../../src/main/extensions/api'
import { createIpcRegistrar } from './register'

const BLOCKED_DDL = /^\s*(drop|create|alter)\s/i

export function registerAdminIpcHandlers(api: ExtensionAPI, db: ExtensionDB): () => void {
  const { handle, cleanup } = createIpcRegistrar(api)
  handle('task-vault:admin:list-tables', async () => {
    try {
      const rows = await db.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`
      )
      return { tables: rows.map((r) => r.table_name) }
    } catch (err) {
      return { error: String(err) }
    }
  })

  handle('task-vault:admin:table-stats', async () => {
    try {
      const tableRows = await db.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`
      )
      const tables = tableRows.map((r) => r.table_name)
      const stats: Record<string, number> = {}
      for (const t of tables) {
        const row = await db.get<{ n: string }>(`SELECT COUNT(*) AS n FROM "${t}"`)
        stats[t] = parseInt(row?.n ?? '0', 10)
      }
      return { stats }
    } catch (err) {
      return { error: String(err) }
    }
  })

  handle('task-vault:admin:run-query', async (payload: unknown) => {
    try {
      const { sql } = payload as { sql: string }
      if (!sql?.trim()) return { error: 'Empty query' }
      if (BLOCKED_DDL.test(sql.trim())) {
        return { error: 'DDL statements (DROP, CREATE, ALTER) are not permitted' }
      }
      const isSelect = /^\s*(select|explain|with\b)/i.test(sql.trim())
      if (isSelect) {
        const rows = await db.query(sql)
        return { rows, changes: 0 }
      }
      const changes = await db.run(sql)
      return { rows: [], changes: changes ?? 0 }
    } catch (err) {
      return { error: String(err) }
    }
  })

  return cleanup
}
