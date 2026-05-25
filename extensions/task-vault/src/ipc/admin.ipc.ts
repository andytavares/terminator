import { ipcMain } from 'electron'
import { getDb } from '../vault/db'

// Block DDL to prevent schema corruption
const BLOCKED_DDL = /^\s*(drop|create|alter)\s/i

export function registerAdminIpcHandlers(): () => void {
  const listTablesHandler = ipcMain.handle('task-vault:admin:list-tables', () => {
    try {
      const db = getDb()
      const rows = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
        .all() as { name: string }[]
      return { tables: rows.map((r) => r.name) }
    } catch (err) {
      return { error: String(err) }
    }
  })

  const tableStatsHandler = ipcMain.handle('task-vault:admin:table-stats', () => {
    try {
      const db = getDb()
      const tables = (
        db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all() as {
          name: string
        }[]
      ).map((r) => r.name)
      const stats: Record<string, number> = {}
      for (const t of tables) {
        const row = db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number }
        stats[t] = row.n
      }
      return { stats }
    } catch (err) {
      return { error: String(err) }
    }
  })

  const runQueryHandler = ipcMain.handle(
    'task-vault:admin:run-query',
    (_event, payload: unknown) => {
      try {
        const { sql } = payload as { sql: string }
        if (!sql?.trim()) return { error: 'Empty query' }
        if (BLOCKED_DDL.test(sql.trim())) {
          return { error: 'DDL statements (DROP, CREATE, ALTER) are not permitted' }
        }
        const db = getDb()
        const stmt = db.prepare(sql)
        if (stmt.reader) {
          const rows = stmt.all() as Record<string, unknown>[]
          return { rows, changes: 0 }
        }
        const result = stmt.run()
        return { rows: [], changes: result.changes }
      } catch (err) {
        return { error: String(err) }
      }
    }
  )

  return () => {
    ipcMain.removeHandler('task-vault:admin:list-tables')
    ipcMain.removeHandler('task-vault:admin:table-stats')
    ipcMain.removeHandler('task-vault:admin:run-query')
    void listTablesHandler
    void tableStatsHandler
    void runQueryHandler
  }
}
