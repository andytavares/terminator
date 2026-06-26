import { PGlite } from '@electric-sql/pglite'
import { createRequire } from 'node:module'
import { readFileSync, existsSync, unlinkSync, renameSync } from 'node:fs'
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

async function tryInitPGlite(
  dbPath: string,
  wasmModule: WebAssembly.Module,
  fsBundle: Blob
): Promise<PGlite> {
  // Remove stale PostgreSQL lock files left by a previous unclean exit.
  for (const name of ['postmaster.pid', '.s.PGSQL.5432.lock.out', '.s.PGSQL.5432']) {
    const p = path.join(dbPath, name)
    if (existsSync(p)) {
      try {
        unlinkSync(p)
      } catch {
        // best-effort
      }
    }
  }
  const pg = new PGlite({ dataDir: dbPath, wasmModule, fsBundle })
  await pg.waitReady
  // Probe the catalog — pg_attribute corruption surfaces here, not at waitReady.
  await pg.query('SELECT 1 FROM information_schema.columns LIMIT 1')
  // Probe each user table to force PGLite to build relation caches.
  // pg_attribute corruption on a specific table only surfaces at this point,
  // not during the information_schema probe above.
  const tables = await pg.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`
  )
  for (const { tablename } of tables.rows) {
    await pg.query(`SELECT 1 FROM "${tablename}" LIMIT 0`)
  }
  return pg
}

export async function initAppDb(userData: string): Promise<void> {
  const dbPath = path.join(userData, 'app.pglite')

  // Pass PGlite's wasm + filesystem bundle explicitly. Only the two binary
  // files are in app.asar.unpacked (see asarUnpack in electron-builder.yml);
  // Electron's asar fs interception redirects readFileSync on the virtual asar
  // path to the real unpacked file. All pglite JS remains inside the asar so
  // ESM dynamic imports (e.g. import("./fs/nodefs.js")) resolve correctly.
  const req = createRequire(import.meta.url)
  const distDir = path.dirname(req.resolve('@electric-sql/pglite'))
  const wasmModule = await WebAssembly.compile(readFileSync(path.join(distDir, 'postgres.wasm')))
  const fsBundle = new Blob([readFileSync(path.join(distDir, 'postgres.data'))])

  try {
    _pg = await tryInitPGlite(dbPath, wasmModule, fsBundle)
  } catch {
    // Existing database is corrupt. Back it up and start fresh.
    if (existsSync(dbPath)) {
      const backup = `${dbPath}.corrupt-backup-${Math.floor(Date.now() / 1000)}`
      try {
        renameSync(dbPath, backup)
      } catch {
        // Rename failed (e.g. cross-device); proceed without backup — fresh
        // init will overwrite whatever is there.
      }
    }
    _pg = await tryInitPGlite(dbPath, wasmModule, fsBundle)
  }

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
