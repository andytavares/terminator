import { PGlite } from '@electric-sql/pglite'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
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
  run(sql: string, params?: unknown[]): Promise<number>
  transaction<T>(fn: (tx: ExtensionDB) => Promise<T>): Promise<T>
}

// Convert SQLite-style ? placeholders to Postgres $1, $2, ...
function toPositional(sql: string, params?: unknown[]): [string, unknown[]] {
  if (!params || params.length === 0) return [sql, []]
  let n = 0
  return [sql.replace(/\?/g, () => `$${++n}`), params]
}

type PgTx = Parameters<Parameters<PGlite['transaction']>[0]>[0]

let _spCount = 0

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
      const result = await tx.query(s, p)
      return result.affectedRows ?? 0
    },
    async transaction<T>(fn: (tx2: ExtensionDB) => Promise<T>) {
      // PGlite does not support nested BEGIN; demote to a savepoint.
      const sp = `sp_${++_spCount}`
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
      const result = await db.query(s, p)
      return result.affectedRows ?? 0
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
  // Pass PGlite's wasm + filesystem bundle explicitly instead of relying on its
  // own module-relative URL resolution. In the packaged ESM build that
  // resolution fails to load postgres.data and pg_initdb aborts (blank app).
  // Reading the files ourselves works in dev and when packaged — Electron
  // transparently redirects the asar path to the unpacked copy (see asarUnpack
  // in electron-builder.yml).
  const require = createRequire(import.meta.url)
  const distDir = path.dirname(require.resolve('@electric-sql/pglite'))
  const wasmModule = await WebAssembly.compile(readFileSync(path.join(distDir, 'postgres.wasm')))
  const fsBundle = new Blob([readFileSync(path.join(distDir, 'postgres.data'))])
  _pg = new PGlite({ dataDir: dbPath, wasmModule, fsBundle })
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
    _spCount = 0
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
