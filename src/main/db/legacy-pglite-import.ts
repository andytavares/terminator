import type { PGlite } from '@electric-sql/pglite'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import * as path from 'node:path'
import { logger } from '../logger.js'
import type { ExtensionDB } from '@terminator/extension-sdk'

// One-time import of the PGlite database used before ADR 099. Removed together
// with the @electric-sql/pglite dependency one release after it ships.

export function legacyImportPending(userData: string): boolean {
  return (
    !existsSync(path.join(userData, 'app.sqlite')) && existsSync(path.join(userData, 'app.pglite'))
  )
}

// postgres.wasm and postgres.data are the two files unpacked from the asar (see
// asarUnpack in electron-builder.cjs), so they are passed in explicitly.
async function openLegacyDatabase(dataDir: string): Promise<PGlite> {
  const { PGlite } = await import('@electric-sql/pglite')
  const distDir = path.dirname(createRequire(import.meta.url).resolve('@electric-sql/pglite'))
  const wasmModule = await WebAssembly.compile(readFileSync(path.join(distDir, 'postgres.wasm')))
  const fsBundle = new Blob([readFileSync(path.join(distDir, 'postgres.data'))])
  const legacy = new PGlite({ dataDir, wasmModule, fsBundle })
  await legacy.waitReady
  return legacy
}

async function tablesInBoth(legacy: PGlite, db: ExtensionDB): Promise<string[]> {
  const old = await legacy.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`
  )
  const current = await db.query<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`
  )
  const created = new Set(current.map((table) => table.name))
  return old.rows.map((table) => table.tablename).filter((name) => created.has(name))
}

async function copyTable(legacy: PGlite, tx: ExtensionDB, table: string): Promise<number> {
  const { rows } = await legacy.query<Record<string, unknown>>(`SELECT * FROM "${table}"`)
  if (rows.length === 0) return 0
  const targetColumns = await tx.query<{ name: string }>(`SELECT name FROM pragma_table_info(?)`, [
    table,
  ])
  const known = new Set(targetColumns.map((column) => column.name))
  const columns = Object.keys(rows[0]).filter((column) => known.has(column))
  const sql = `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(', ')})
    VALUES (${columns.map(() => '?').join(', ')})`
  let copied = 0
  for (const row of rows)
    copied += await tx.run(
      sql,
      columns.map((column) => row[column])
    )
  return copied
}

/** Copies every row of each table in both databases, so it runs after extensions create theirs.
 * All or nothing: a failure is logged and leaves the new database empty. app.pglite is never
 * deleted; removing app.sqlite makes the next start import again. */
export async function importLegacyDatabase(userData: string, db: ExtensionDB): Promise<void> {
  let legacy: PGlite | undefined
  try {
    legacy = await openLegacyDatabase(path.join(userData, 'app.pglite'))
    const tables = await tablesInBoth(legacy, db)
    const source = legacy
    const copied: Record<string, number> = {}
    await db.transaction(async (tx) => {
      await tx.exec('PRAGMA defer_foreign_keys = ON')
      for (const table of tables) copied[table] = await copyTable(source, tx, table)
    })
    logger.info('Imported legacy PGlite database', { rowsByTable: copied })
  } catch (error) {
    logger.error('Legacy PGlite import failed; starting with an empty database', {
      error: error instanceof Error ? (error.stack ?? error.message) : String(error),
    })
  } finally {
    await legacy?.close().catch(() => undefined)
  }
}
