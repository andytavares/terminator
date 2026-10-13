import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import * as path from 'node:path'
import type { ExtensionDB } from '@terminator/extension-sdk'

type Statements = Omit<ExtensionDB, 'transaction'>

function statements(database: DatabaseSync): Statements {
  const bind = (params: unknown[] = []) => params as SQLInputValue[]
  return {
    async exec(sql) {
      database.exec(sql)
    },
    async query<T extends Record<string, unknown>>(sql: string, params?: unknown[]) {
      return database.prepare(sql).all(...bind(params)) as T[]
    },
    async get<T extends Record<string, unknown>>(sql: string, params?: unknown[]) {
      return database.prepare(sql).get(...bind(params)) as T | undefined
    },
    async run(sql, params) {
      return Number(database.prepare(sql).run(...bind(params)).changes)
    },
  }
}

interface TransactionSql {
  begin: string
  commit: string
  rollback: string
}

/** Runs `body` between `begin` and `commit`, rolling back and rethrowing when it throws. */
async function guarded<T>(
  database: DatabaseSync,
  sql: TransactionSql,
  body: () => Promise<T>
): Promise<T> {
  database.exec(sql.begin)
  try {
    const result = await body()
    database.exec(sql.commit)
    return result
  } catch (error) {
    database.exec(sql.rollback)
    throw error
  }
}

/** The handle a transaction body receives: a nested transaction is a savepoint. */
function nestedTransactions(database: DatabaseSync, direct: Statements): ExtensionDB {
  let savepoints = 0
  const withinTransaction: ExtensionDB = {
    ...direct,
    transaction<T>(fn: (tx: ExtensionDB) => Promise<T>): Promise<T> {
      const savepoint = `sp_${++savepoints}`
      const sql = {
        begin: `SAVEPOINT ${savepoint}`,
        commit: `RELEASE ${savepoint}`,
        rollback: `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`,
      }
      return guarded(database, sql, () => fn(withinTransaction))
    },
  }
  return withinTransaction
}

/** Runs each task after the one before it has settled. */
function sequential(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve()
  return (task) => {
    const result = tail.then(task)
    tail = result.catch(() => undefined)
    return result
  }
}

const TOP_LEVEL: TransactionSql = { begin: 'BEGIN', commit: 'COMMIT', rollback: 'ROLLBACK' }

/**
 * Wraps one synchronous connection in the async ExtensionDB interface. Statements
 * and transactions run one at a time, in call order: a statement issued while a
 * transaction is open waits for it, so it is never committed or rolled back with it.
 */
export function wrapDb(database: DatabaseSync): ExtensionDB {
  const direct = statements(database)
  const inOrder = sequential()
  const nested = nestedTransactions(database, direct)

  return {
    exec: (sql) => inOrder(() => direct.exec(sql)),
    query: <T extends Record<string, unknown>>(sql: string, params?: unknown[]) =>
      inOrder(() => direct.query<T>(sql, params)),
    get: <T extends Record<string, unknown>>(sql: string, params?: unknown[]) =>
      inOrder(() => direct.get<T>(sql, params)),
    run: (sql, params) => inOrder(() => direct.run(sql, params)),
    transaction: (fn) => inOrder(() => guarded(database, TOP_LEVEL, () => fn(nested))),
  }
}

let _database: DatabaseSync | null = null
let _db: ExtensionDB | null = null

export function initAppDb(userData: string): void {
  _database = new DatabaseSync(path.join(userData, 'app.sqlite'), {
    enableForeignKeyConstraints: true,
  })
  _database.exec('PRAGMA journal_mode = WAL')
  _db = wrapDb(_database)
}

export function getAppDb(): ExtensionDB {
  if (!_db) throw new Error('AppDB not initialized — call initAppDb first')
  return _db
}

export function closeAppDb(): void {
  _database?.close()
  _database = null
  _db = null
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
