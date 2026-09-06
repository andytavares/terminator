import * as fs from 'node:fs'
import * as path from 'node:path'
import { orderDir, ledgerPath } from '../data-root.js'
import { appendEntry } from '../ledger/append.js'
import type { LedgerEntry } from '../ledger/append.js'
import { parseWorkOrder } from './schema.js'
import type { WorkOrder } from './schema.js'
import { renderOrder } from './render.js'

// Orders on disk.
//
// `order.json` is the truth; `order.md` is regenerated beside it on every save
// so the record is readable in a bare terminal, in a diff, and as a tracker
// comment without anything re-deriving it. Both live under the data root and
// never inside a target repository.

export interface OrderStore {
  save(order: WorkOrder): Promise<void>
  load(id: string): Promise<WorkOrder | null>
  list(): Promise<WorkOrder[]>
  /** The open order already seeded from this issue, if there is one (FR-013). */
  findByIssue(tracker: string, key: string): Promise<{ id: string; title: string } | null>
  record(entry: LedgerEntry): Promise<void>
}

export function createOrderStore(root: string): OrderStore {
  const dirFor = (id: string): string => orderDir(root, id)

  async function save(order: WorkOrder): Promise<void> {
    const dir = dirFor(order.id)
    await fs.promises.mkdir(dir, { recursive: true })
    await fs.promises.writeFile(
      path.join(dir, 'order.json'),
      `${JSON.stringify(order, null, 2)}\n`,
      'utf8'
    )
    // Regenerated, never hand-edited: anything the operator wants to change
    // goes through intake so it lands in the truth.
    await fs.promises.writeFile(path.join(dir, 'order.md'), renderOrder(order), 'utf8')
  }

  async function load(id: string): Promise<WorkOrder | null> {
    try {
      const raw = await fs.promises.readFile(path.join(dirFor(id), 'order.json'), 'utf8')
      return parseWorkOrder(JSON.parse(raw))
    } catch {
      // A missing or unreadable order is null rather than fatal — one corrupt
      // directory must not cost the operator every other order.
      return null
    }
  }

  async function list(): Promise<WorkOrder[]> {
    let ids: string[]
    try {
      ids = await fs.promises.readdir(path.join(root, 'orders'))
    } catch {
      return []
    }
    const loaded = await Promise.all(ids.map((id) => load(id)))
    return loaded
      .filter((order): order is WorkOrder => order !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  return {
    save,
    load,
    list,
    async findByIssue(tracker, key) {
      const open = (await list()).filter(
        (order) =>
          order.status !== 'shipped' &&
          order.status !== 'cancelled' &&
          order.source.tracker === tracker &&
          order.source.key === key
      )
      return open.length === 0 ? null : { id: open[0].id, title: open[0].title }
    },
    async record(entry) {
      await appendEntry(ledgerPath(root, entry.orderId), entry)
    },
  }
}
