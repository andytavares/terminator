import { PGlite } from '@electric-sql/pglite'
import * as path from 'node:path'

export interface ExtensionDB {
  exec(sql: string): Promise<void>
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<T[]>
  get<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<T | undefined>
  run(sql: string, params?: unknown[]): Promise<void>
  transaction<T>(fn: (tx: ExtensionDB) => Promise<T>): Promise<T>
}

// Convert SQLite-style ? placeholders to Postgres $1, $2, ...
function toPositional(sql: string, params?: unknown[]): [string, unknown[]] {
  if (!params || params.length === 0) return [sql, []]
  let n = 0
  return [sql.replace(/\?/g, () => `$${++n}`), params]
}

type PgTx = Parameters<Parameters<PGlite['transaction']>[0]>[0]

function wrapTx(tx: PgTx): ExtensionDB {
  return {
    async exec(sql) {
      await tx.exec(sql)
    },
    async query<T extends Record<string, unknown>>(sql: string, params?: unknown[]) {
      const [s, p] = toPositional(sql, params)
      const result = await tx.query<T>(s, p)
      return result.rows
    },
    async get<T extends Record<string, unknown>>(sql: string, params?: unknown[]) {
      const [s, p] = toPositional(sql, params)
      const result = await tx.query<T>(s, p)
      return result.rows[0]
    },
    async run(sql: string, params?: unknown[]) {
      const [s, p] = toPositional(sql, params)
      await tx.query(s, p)
    },
    async transaction<T>(fn: (tx2: ExtensionDB) => Promise<T>) {
      // PGlite does not support nested BEGIN; demote to a savepoint.
      const sp = `sp_${Math.random().toString(36).slice(2)}`
      await tx.exec(`SAVEPOINT ${sp}`)
      try {
        const result = await fn(wrapTx(tx))
        await tx.exec(`RELEASE SAVEPOINT ${sp}`)
        return result
      } catch (e) {
        await tx.exec(`ROLLBACK TO SAVEPOINT ${sp}`)
        throw e
      }
    },
  }
}

export function wrapDb(db: PGlite): ExtensionDB {
  return {
    async exec(sql) {
      await db.exec(sql)
    },
    async query<T extends Record<string, unknown>>(sql: string, params?: unknown[]) {
      const [s, p] = toPositional(sql, params)
      const result = await db.query<T>(s, p)
      return result.rows
    },
    async get<T extends Record<string, unknown>>(sql: string, params?: unknown[]) {
      const [s, p] = toPositional(sql, params)
      const result = await db.query<T>(s, p)
      return result.rows[0]
    },
    async run(sql: string, params?: unknown[]) {
      const [s, p] = toPositional(sql, params)
      await db.query(s, p)
    },
    async transaction<T>(fn: (tx: ExtensionDB) => Promise<T>) {
      return db.transaction((tx) => fn(wrapTx(tx)))
    },
  }
}

let _pg: PGlite | null = null
let _db: ExtensionDB | null = null

export async function initAppDb(userData: string): Promise<void> {
  const dbPath = path.join(userData, 'app.pglite')
  _pg = new PGlite(dbPath)
  await _pg.waitReady
  _db = wrapDb(_pg)
}

export function getAppDb(): ExtensionDB {
  if (!_db) throw new Error('AppDB not initialized — call initAppDb first')
  return _db
}

export async function closeAppDb(): Promise<void> {
  if (_pg) {
    await _pg.close()
    _pg = null
    _db = null
  }
}

export async function healthCheck(): Promise<{ ok: boolean; message?: string }> {
  try {
    const db = getAppDb()
    await db.query('SELECT 1')
    return { ok: true }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}
