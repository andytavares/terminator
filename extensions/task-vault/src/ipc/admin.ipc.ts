import { z } from 'zod'
import { noPayload, type ExtensionAPI, type ExtensionDB } from '@terminator/extension-sdk'
import { localRoute, registerRoutes, type IpcContext } from './register'
import { orErrorString } from './vault-shared'

const BLOCKED_DDL = /^\s*(drop|create|alter)\s/i

const RunQueryRequestSchema = z.object({ sql: z.string() })

async function tableNames(db: ExtensionDB): Promise<string[]> {
  const rows = await db.query<{ table_name: string }>(
    `SELECT name AS table_name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
  )
  return rows.map((r) => r.table_name)
}

function listTables({ db }: IpcContext) {
  return orErrorString(async () => ({ tables: await tableNames(db) }))
}

function tableStats({ db }: IpcContext) {
  return orErrorString(async () => {
    const stats: Record<string, number> = {}
    for (const t of await tableNames(db)) {
      const row = await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM "${t}"`)
      stats[t] = row?.n ?? 0
    }
    return { stats }
  })
}

function runQuery({ db }: IpcContext, args: z.infer<typeof RunQueryRequestSchema>) {
  const { sql } = args
  return orErrorString(async () => {
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
  })
}

/** The database console: desktop-only, since it reads and writes any table. */
const ADMIN_ROUTES = [
  localRoute('task-vault:admin:list-tables', noPayload, listTables),
  localRoute('task-vault:admin:table-stats', noPayload, tableStats),
  localRoute('task-vault:admin:run-query', RunQueryRequestSchema, runQuery),
]

export function registerAdminIpcHandlers(api: ExtensionAPI, db: ExtensionDB): () => void {
  return registerRoutes({ api, db }, ADMIN_ROUTES)
}
