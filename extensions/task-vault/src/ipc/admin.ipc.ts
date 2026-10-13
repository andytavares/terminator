import { z } from 'zod'
import { noPayload, type ExtensionAPI, type ExtensionDB } from '@terminator/extension-sdk'
import { createIpcRegistrar } from './register'

const BLOCKED_DDL = /^\s*(drop|create|alter)\s/i

const RunQueryRequestSchema = z.object({ sql: z.string() })

export function registerAdminIpcHandlers(api: ExtensionAPI, db: ExtensionDB): () => void {
  const { handle, cleanup } = createIpcRegistrar(api)
  handle('task-vault:admin:table-stats', noPayload, async () => {
    try {
      const tableRows = await db.query<{ table_name: string }>(
        `SELECT name AS table_name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
      )
      const tables = tableRows.map((r) => r.table_name)
      const stats: Record<string, number> = {}
      for (const t of tables) {
        const row = await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM "${t}"`)
        stats[t] = row?.n ?? 0
      }
      return { stats }
    } catch (err) {
      return { error: String(err) }
    }
  })

  handle('task-vault:admin:run-query', RunQueryRequestSchema, async ({ sql }) => {
    try {
      if (!sql.trim()) return { error: 'Empty query' }
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
