import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ExtensionDB } from '@terminator/extension-sdk'
import { wrapDb, initAppDb, getAppDb, closeAppDb, healthCheck } from '../../../src/main/db/index'

describe('ExtensionDB over node:sqlite', () => {
  let db: ExtensionDB

  beforeEach(async () => {
    db = wrapDb(new DatabaseSync(':memory:'))
    await db.exec(`
      CREATE TABLE parents (id TEXT PRIMARY KEY);
      CREATE TABLE children (
        id TEXT PRIMARY KEY,
        parent_id TEXT NOT NULL REFERENCES parents(id) ON DELETE CASCADE
      );
      CREATE TABLE items (id TEXT PRIMARY KEY, name TEXT, weight REAL);
    `)
  })

  it('binds ? parameters and returns rows', async () => {
    await db.run('INSERT INTO items (id, name, weight) VALUES (?, ?, ?)', ['a', 'Alice', 1.5])
    await db.run('INSERT INTO items (id, name, weight) VALUES (?, ?, ?)', ['b', null, 2])
    const rows = await db.query<{ id: string; name: string | null; weight: number }>(
      'SELECT id, name, weight FROM items WHERE weight > ? ORDER BY id',
      [1]
    )
    expect(rows.map((row) => ({ ...row }))).toEqual([
      { id: 'a', name: 'Alice', weight: 1.5 },
      { id: 'b', name: null, weight: 2 },
    ])
  })

  it('get returns the first row, or undefined when nothing matches', async () => {
    await db.run('INSERT INTO items (id, name) VALUES (?, ?)', ['a', 'Alice'])
    expect((await db.get('SELECT name FROM items WHERE id = ?', ['a']))?.name).toBe('Alice')
    expect(await db.get('SELECT name FROM items WHERE id = ?', ['missing'])).toBeUndefined()
  })

  it('run returns the number of rows changed', async () => {
    await db.exec(`INSERT INTO items (id) VALUES ('a'), ('b'), ('c')`)
    expect(await db.run('UPDATE items SET name = ? WHERE id != ?', ['x', 'a'])).toBe(2)
    expect(await db.run('DELETE FROM items WHERE 1 = 0')).toBe(0)
  })

  it('rejects a statement that is not valid SQL', async () => {
    await expect(db.query('SELECT FROM WHERE')).rejects.toThrow()
  })

  it('enforces foreign keys and cascades deletes', async () => {
    await expect(
      db.run('INSERT INTO children (id, parent_id) VALUES (?, ?)', ['c', 'x'])
    ).rejects.toThrow(/FOREIGN KEY/)
    await db.run('INSERT INTO parents (id) VALUES (?)', ['p'])
    await db.run('INSERT INTO children (id, parent_id) VALUES (?, ?)', ['c', 'p'])
    await db.run('DELETE FROM parents WHERE id = ?', ['p'])
    expect(await db.query('SELECT id FROM children')).toEqual([])
  })

  describe('transaction', () => {
    it('commits when the callback resolves and returns its value', async () => {
      const result = await db.transaction(async (tx) => {
        await tx.run('INSERT INTO items (id) VALUES (?)', ['a'])
        return 'done'
      })
      expect(result).toBe('done')
      expect(await db.query('SELECT id FROM items')).toHaveLength(1)
    })

    it('rolls everything back when the callback throws', async () => {
      await expect(
        db.transaction(async (tx) => {
          await tx.run('INSERT INTO items (id) VALUES (?)', ['a'])
          throw new Error('boom')
        })
      ).rejects.toThrow('boom')
      expect(await db.query('SELECT id FROM items')).toEqual([])
    })

    it('rolls back when a deferred constraint fails at commit', async () => {
      await expect(
        db.transaction(async (tx) => {
          await tx.exec('PRAGMA defer_foreign_keys = ON')
          await tx.run('INSERT INTO children (id, parent_id) VALUES (?, ?)', ['c', 'missing'])
        })
      ).rejects.toThrow(/FOREIGN KEY/)
      expect(await db.query('SELECT id FROM children')).toEqual([])
      await db.transaction(async (tx) => {
        await tx.run('INSERT INTO parents (id) VALUES (?)', ['p'])
      })
      expect(await db.query('SELECT id FROM parents')).toHaveLength(1)
    })

    it('a nested transaction that throws undoes only its own writes', async () => {
      await db.transaction(async (tx) => {
        await tx.run('INSERT INTO items (id) VALUES (?)', ['outer'])
        await tx
          .transaction(async (inner) => {
            await inner.run('INSERT INTO items (id) VALUES (?)', ['inner'])
            throw new Error('inner failure')
          })
          .catch(() => undefined)
        await tx.run('INSERT INTO items (id) VALUES (?)', ['after'])
      })
      const ids = (await db.query<{ id: string }>('SELECT id FROM items ORDER BY id')).map(
        (r) => r.id
      )
      expect(ids).toEqual(['after', 'outer'])
    })

    it('a nested transaction that succeeds is undone when the outer one fails', async () => {
      await expect(
        db.transaction(async (tx) => {
          await tx.transaction(async (inner) => {
            await inner.run('INSERT INTO items (id) VALUES (?)', ['inner'])
          })
          throw new Error('outer failure')
        })
      ).rejects.toThrow('outer failure')
      expect(await db.query('SELECT id FROM items')).toEqual([])
    })

    it('a statement issued while a transaction is open waits and is not rolled back with it', async () => {
      let release!: () => void
      const gate = new Promise<void>((resolve) => (release = resolve))
      const failing = db
        .transaction(async (tx) => {
          await tx.run('INSERT INTO items (id) VALUES (?)', ['in-transaction'])
          await gate
          throw new Error('rolled back')
        })
        .catch(() => undefined)
      const outside = db.run('INSERT INTO items (id) VALUES (?)', ['outside'])
      release()
      await Promise.all([failing, outside])
      const ids = (await db.query<{ id: string }>('SELECT id FROM items')).map((r) => r.id)
      expect(ids).toEqual(['outside'])
    })

    it('runs overlapping transactions one after the other', async () => {
      const order: string[] = []
      const run = (label: string) =>
        db.transaction(async (tx) => {
          order.push(`${label}:start`)
          await tx.run('INSERT INTO items (id) VALUES (?)', [label])
          await new Promise((resolve) => setTimeout(resolve, 5))
          order.push(`${label}:end`)
        })
      await Promise.all([run('a'), run('b')])
      expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end'])
    })
  })
})

describe('app database', () => {
  let userData: string

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'app-db-'))
  })

  afterEach(() => {
    closeAppDb()
    rmSync(userData, { recursive: true, force: true })
  })

  it('getAppDb throws before initAppDb', () => {
    expect(() => getAppDb()).toThrow('AppDB not initialized')
  })

  it('keeps data in <userData>/app.sqlite across a close and reopen, in WAL mode', async () => {
    initAppDb(userData)
    expect((await getAppDb().get('PRAGMA journal_mode'))?.journal_mode).toBe('wal')
    await getAppDb().exec("CREATE TABLE t (id TEXT); INSERT INTO t VALUES ('kept')")
    closeAppDb()
    expect(() => getAppDb()).toThrow('AppDB not initialized')

    initAppDb(userData)
    expect((await getAppDb().get('SELECT id FROM t'))?.id).toBe('kept')
  })

  it('healthCheck is ok when open and reports the reason when not initialized', async () => {
    expect(await healthCheck()).toMatchObject({
      ok: false,
      message: expect.stringMatching(/not initialized/),
    })
    initAppDb(userData)
    expect(await healthCheck()).toEqual({ ok: true })
  })
})
