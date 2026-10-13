import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { orderDir, ledgerPath } from '../data-root.js'
import { appendEntry, readEntries } from '../ledger/append.js'
import type { LedgerEntry } from '../ledger/append.js'
import { parseWorkOrder } from './schema.js'
import type { WorkOrder } from './schema.js'
import { renderOrder } from './render.js'
import type { FoundryIndex } from '../state/foundry-index.js'

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
  /**
   * This order's ledger, oldest first.
   *
   * Reading it back is not bookkeeping. Some of what happens to an order is
   * recorded here and nowhere else — an intake turn the architect never
   * finished writes a ledger line and does not touch `order.json` — so a
   * surface that only ever loads the document cannot see it happened.
   */
  entries(orderId: string): Promise<LedgerEntry[]>
}

/**
 * A store whose root is resolved on every call.
 *
 * For the extension host, where the records location depends on the open
 * workspace and activation runs before there is one. The resolver is still
 * `data-root.ts` and every write still receives an absolute path; what this
 * removes is the assumption that the answer is known at activation.
 */
export function createLiveOrderStore(
  root: () => string,
  indexFor?: (root: string) => FoundryIndex
): OrderStore {
  const orderStore = (): OrderStore => createOrderStore(root(), indexFor?.(root()))
  return {
    save: (order) => orderStore().save(order),
    load: (id) => orderStore().load(id),
    list: () => orderStore().list(),
    findByIssue: (tracker, key) => orderStore().findByIssue(tracker, key),
    record: (entry) => orderStore().record(entry),
    entries: (orderId) => orderStore().entries(orderId),
  }
}

// The Forge polls load() while saves happen; writing in place lets a read land
// between the truncate and the write and see a half-written order as missing.
async function writeAtomically(file: string, content: string): Promise<void> {
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`
  await fs.promises.writeFile(tmp, content, 'utf8')
  await fs.promises.rename(tmp, file)
}

/** With an index, reads come from memory and writes tell it; without, files are reparsed. */
export function createOrderStore(root: string, index?: FoundryIndex): OrderStore {
  const list = (): Promise<WorkOrder[]> =>
    index === undefined ? readAllOrders(root) : index.orders()
  return {
    save: (order) => saveOrder(root, order, index),
    load: async (id) => (index === undefined ? readOrder(root, id) : index.order(id)),
    list,
    findByIssue: async (tracker, key) => openFromIssue(await list(), { tracker, key }),
    async record(entry) {
      await appendEntry(ledgerPath(root, entry.orderId), entry)
      index?.entryAppended(JSON.parse(JSON.stringify(entry)) as LedgerEntry)
    },
    entries(orderId) {
      return index === undefined ? readEntries(ledgerPath(root, orderId)) : index.ledger(orderId)
    },
  }
}

async function saveOrder(root: string, order: WorkOrder, index?: FoundryIndex): Promise<void> {
  const dir = orderDir(root, order.id)
  const json = `${JSON.stringify(order, null, 2)}\n`
  await fs.promises.mkdir(dir, { recursive: true })
  await writeAtomically(path.join(dir, 'order.json'), json)
  // Regenerated, never hand-edited: anything the operator wants to change
  // goes through intake so it lands in the truth.
  await writeAtomically(path.join(dir, 'order.md'), renderOrder(order))
  // As a read would see it: parsed back, so defaults are filled in the same way.
  index?.orderSaved(parseWorkOrder(JSON.parse(json)))
}

async function readOrder(root: string, id: string): Promise<WorkOrder | null> {
  try {
    const raw = await fs.promises.readFile(path.join(orderDir(root, id), 'order.json'), 'utf8')
    return parseWorkOrder(JSON.parse(raw))
  } catch {
    // A missing or unreadable order is null rather than fatal — one corrupt
    // directory must not cost the operator every other order.
    return null
  }
}

async function readAllOrders(root: string): Promise<WorkOrder[]> {
  let ids: string[]
  try {
    ids = await fs.promises.readdir(path.join(root, 'orders'))
  } catch {
    return []
  }
  const loaded = await Promise.all(ids.map((id) => readOrder(root, id)))
  return loaded
    .filter((order): order is WorkOrder => order !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** The first order still open that was seeded from this tracker's issue. */
function openFromIssue(
  orders: readonly WorkOrder[],
  issue: { tracker: string; key: string }
): { id: string; title: string } | null {
  const open = orders.filter(
    (order) =>
      order.status !== 'shipped' &&
      order.status !== 'cancelled' &&
      order.source.tracker === issue.tracker &&
      order.source.key === issue.key
  )
  return open.length === 0 ? null : { id: open[0].id, title: open[0].title }
}
