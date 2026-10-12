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

/**
 * Wraps one synchronous connection in the async ExtensionDB interface. Statements
 * and transactions run one at a time, in call order: a statement issued while a
 * transaction is open waits for it, so it is never committed or rolled back with it.
 */
export function wrapDb(database: DatabaseSync): ExtensionDB {
  const direct = statements(database)
  let tail: Promise<unknown> = Promise.resolve()
  let savepoints = 0

  const inOrder = <T>(task: () => Promise<T>): Promise<T> => {
    const result = tail.then(task)
    tail = result.catch(() => undefined)
    return result
  }

  const withinTransaction: ExtensionDB = {
    ...direct,
    async transaction<T>(fn: (tx: ExtensionDB) => Promise<T>): Promise<T> {
      const savepoint = `sp_${++savepoints}`
      database.exec(`SAVEPOINT ${savepoint}`)
      try {
        const result = await fn(withinTransaction)
        database.exec(`RELEASE ${savepoint}`)
        return result
      } catch (error) {
        database.exec(`ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`)
        throw error
      }
    },
  }

  async function transaction<T>(fn: (tx: ExtensionDB) => Promise<T>): Promise<T> {
    database.exec('BEGIN')
    try {
      const result = await fn(withinTransaction)
      database.exec('COMMIT')
      return result
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }

  return {
    exec: (sql) => inOrder(() => direct.exec(sql)),
    query: <T extends Record<string, unknown>>(sql: string, params?: unknown[]) =>
      inOrder(() => direct.query<T>(sql, params)),
    get: <T extends Record<string, unknown>>(sql: string, params?: unknown[]) =>
      inOrder(() => direct.get<T>(sql, params)),
    run: (sql, params) => inOrder(() => direct.run(sql, params)),
    transaction: (fn) => inOrder(() => transaction(fn)),
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
