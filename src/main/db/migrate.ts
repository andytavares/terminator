import * as fs from 'node:fs'
import * as path from 'node:path'
import { makeLogger } from '../logger.js'
import type { ExtensionDB } from './index.js'

const log = makeLogger('db-migrate')

// Tables that came from the old vault.db (task-vault extension)
const VAULT_TABLES = ['tasks', 'projects', 'areas', 'settings'] as const

// Tables that came from the old notepad.db (notepad extension)
const NOTEPAD_TABLES = [
  'notes',
  'tags',
  'note_tags',
  'comments',
  'diagrams',
  'diagram_comments',
] as const

export async function runLegacyMigration(userData: string, db: ExtensionDB): Promise<void> {
  await migrateFile(userData, 'vault.db', VAULT_TABLES, db)
  await migrateFile(userData, 'notepad.db', NOTEPAD_TABLES, db)
}

async function migrateFile(
  userData: string,
  filename: string,
  tables: readonly string[],
  db: ExtensionDB
): Promise<void> {
  const dbPath = path.join(userData, filename)
  if (!fs.existsSync(dbPath)) return

  log.info(`Migrating legacy ${filename}…`)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let initSqlJs: (opts?: any) => Promise<import('sql.js').SqlJsStatic>
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    initSqlJs = require('sql.js') as typeof initSqlJs
  } catch (err) {
    log.warn(`sql.js not available — skipping legacy migration of ${filename}: ${String(err)}`)
    return
  }

  try {
    const SQL = await initSqlJs()
    const buf = fs.readFileSync(dbPath)
    const sqlite = new SQL.Database(buf)

    for (const table of tables) {
      try {
        // Get column list from old SQLite schema
        const colRows = sqlite.exec(`PRAGMA table_info(${table})`)
        if (!colRows.length || !colRows[0].values.length) continue
        const cols = colRows[0].values.map((r) => r[1] as string)

        // Read all rows
        const rowResult = sqlite.exec(`SELECT * FROM ${table}`)
        if (!rowResult.length) continue
        const rows = rowResult[0].values

        let imported = 0
        for (const row of rows) {
          const colList = cols.join(', ')
          const placeholders = cols.map(() => '?').join(', ')
          try {
            await db.run(
              `INSERT INTO ${table} (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
              row as unknown[]
            )
            imported++
          } catch {
            // Skip rows that fail (schema mismatch, FK violations, etc.)
          }
        }
        log.info(`  ${table}: imported ${imported}/${rows.length} rows`)
      } catch (err) {
        log.warn(`  ${table}: skipped — ${String(err)}`)
      }
    }

    sqlite.close()

    // Rename the old file so migration doesn't run again
    fs.renameSync(dbPath, dbPath + '.bak')
    for (const suffix of ['-wal', '-shm']) {
      const side = dbPath + suffix
      if (fs.existsSync(side)) fs.unlinkSync(side)
    }

    log.info(`Migration of ${filename} complete — renamed to ${filename}.bak`)
  } catch (err) {
    log.error(`Legacy migration of ${filename} failed: ${String(err)}`)
    // Non-fatal: app starts fresh if migration fails
  }
}
