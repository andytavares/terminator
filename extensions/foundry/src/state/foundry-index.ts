import type { WorkOrder } from '../order/schema.js'
import type { RunGraph } from '../line/run-graph.js'
import type { Gate } from '../gates/rules.js'
import type { LedgerEntry } from '../ledger/append.js'

// Foundry's own records held in memory: disk stays the truth and is written first;
// each piece loads on first ask and hears of every successful write, so polls stop
// reparsing. A file edited by hand is not noticed until a restart.

// `live` has no file behind it: held calls, stalls, stranded agents and running
// intakes live in the process. `orderId` is empty for a change tied to no order.
export type ChangeKind = 'order' | 'graph' | 'gates' | 'ledger' | 'live'

export interface FoundryChange {
  readonly kind: ChangeKind
  readonly orderId: string
}

/** The disk readers an index loads from; none of them knows an index exists. */
export interface IndexSource {
  /** Every order, newest first. */
  readonly orders: () => Promise<WorkOrder[]>
  /** Every gate of every order. */
  readonly gates: () => Promise<Gate[]>
  readonly graph: (orderId: string) => Promise<RunGraph | null>
  readonly ledger: (orderId: string) => Promise<LedgerEntry[]>
}

export interface FoundryIndex {
  orders(): Promise<WorkOrder[]>
  order(id: string): Promise<WorkOrder | null>
  gates(): Promise<Gate[]>
  gatesOf(orderId: string): Promise<Gate[]>
  graph(orderId: string): Promise<RunGraph | null>
  ledger(orderId: string): Promise<LedgerEntry[]>
  orderSaved(order: WorkOrder): void
  /** The whole gate file of one order, as just written. */
  gatesWritten(orderId: string, gates: readonly Gate[]): void
  graphSaved(graph: RunGraph): void
  entryAppended(entry: LedgerEntry): void
  /** A run was torn down: its graph and gates are gone; the order and ledger stay. */
  runReset(orderId: string): void
  /** The order's whole directory is gone. */
  orderRemoved(orderId: string): void
  /** Tell the windows about a change this index holds nothing for. */
  announce(change: FoundryChange): void
}

interface Slot<T> {
  read(): Promise<T>
  /** A write that already reached disk. Applied if loaded; otherwise the next read sees it. */
  apply(change: (value: T) => T): void
  /** A write that replaced the whole record, so nothing else needs to be read to know it. */
  replace(value: T): void
}

class CachedSlot<T> implements Slot<T> {
  private loaded: { value: T } | undefined
  private loading: Promise<T> | undefined

  constructor(private readonly load: () => Promise<T>) {}

  read(): Promise<T> {
    if (this.loaded !== undefined) return Promise.resolve(this.loaded.value)
    if (this.loading !== undefined) return this.loading
    const pending: Promise<T> = this.load().then(
      (value) => {
        if (this.loading === pending) {
          this.loaded = { value }
          this.loading = undefined
        }
        return value
      },
      (error: unknown) => {
        if (this.loading === pending) this.loading = undefined
        throw error
      }
    )
    this.loading = pending
    return pending
  }

  apply(change: (value: T) => T): void {
    // A read still in flight may or may not have seen this write, so it is
    // not trusted to be kept: the next read starts over.
    if (this.loaded === undefined) this.loading = undefined
    else this.loaded = { value: change(this.loaded.value) }
  }

  replace(value: T): void {
    this.loaded = { value }
    this.loading = undefined
  }
}

function createSlot<T>(load: () => Promise<T>): Slot<T> {
  return new CachedSlot(load)
}

function createKeyedSlots<T>(load: (key: string) => Promise<T>): (key: string) => Slot<T> {
  const slots = new Map<string, Slot<T>>()
  return (key) => {
    let slot = slots.get(key)
    if (slot === undefined) {
      slot = createSlot(() => load(key))
      slots.set(key, slot)
    }
    return slot
  }
}

const byNewest = (a: WorkOrder, b: WorkOrder): number => b.createdAt.localeCompare(a.createdAt)

function groupGates(all: readonly Gate[]): Map<string, Gate[]> {
  const grouped = new Map<string, Gate[]>()
  for (const gate of all) grouped.set(gate.orderId, [...(grouped.get(gate.orderId) ?? []), gate])
  return grouped
}

function without<T>(all: ReadonlyMap<string, T>, key: string): Map<string, T> {
  const next = new Map(all)
  next.delete(key)
  return next
}

// Callers get copies: reads used to parse a fresh object each time, and some callers
// edit what they are given.
const copy = <T>(value: T): T => structuredClone(value)

interface Slots {
  readonly orders: Slot<Map<string, WorkOrder>>
  readonly gates: Slot<Map<string, Gate[]>>
  readonly graph: (orderId: string) => Slot<RunGraph | null>
  readonly ledger: (orderId: string) => Slot<LedgerEntry[]>
}

type Reads = Pick<FoundryIndex, 'orders' | 'order' | 'gates' | 'gatesOf' | 'graph' | 'ledger'>

function readsOver(slots: Slots): Reads {
  return {
    async orders() {
      return copy([...(await slots.orders.read()).values()].sort(byNewest))
    },
    async order(id) {
      const found = (await slots.orders.read()).get(id)
      return found === undefined ? null : copy(found)
    },
    async gates() {
      return copy([...(await slots.gates.read()).values()].flat())
    },
    async gatesOf(orderId) {
      return copy((await slots.gates.read()).get(orderId) ?? [])
    },
    async graph(orderId) {
      return copy(await slots.graph(orderId).read())
    },
    async ledger(orderId) {
      return [...(await slots.ledger(orderId).read())]
    },
  }
}

type Writes = Omit<FoundryIndex, keyof Reads | 'announce'>
type Removals = Pick<Writes, 'runReset' | 'orderRemoved'>

function writesOver(slots: Slots, announce: (change: FoundryChange) => void): Writes {
  return { ...savesOver(slots, announce), ...removalsOver(slots, announce) }
}

function savesOver(
  slots: Slots,
  announce: (change: FoundryChange) => void
): Omit<Writes, keyof Removals> {
  return {
    orderSaved(order) {
      slots.orders.apply((all) => new Map(all).set(order.id, copy(order)))
      announce({ kind: 'order', orderId: order.id })
    },
    gatesWritten(orderId, written) {
      slots.gates.apply((all) => new Map(all).set(orderId, copy([...written])))
      announce({ kind: 'gates', orderId })
    },
    graphSaved(graph) {
      slots.graph(graph.orderId).replace(copy(graph))
      announce({ kind: 'graph', orderId: graph.orderId })
    },
    entryAppended(entry) {
      slots.ledger(entry.orderId).apply((all) => [...all, entry])
      announce({ kind: 'ledger', orderId: entry.orderId })
    },
  }
}

function removalsOver(slots: Slots, announce: (change: FoundryChange) => void): Removals {
  return {
    runReset(orderId) {
      slots.graph(orderId).replace(null)
      slots.gates.apply((all) => without(all, orderId))
      announce({ kind: 'graph', orderId })
      announce({ kind: 'gates', orderId })
    },
    orderRemoved(orderId) {
      slots.orders.apply((all) => without(all, orderId))
      slots.gates.apply((all) => without(all, orderId))
      slots.graph(orderId).replace(null)
      slots.ledger(orderId).replace([])
      announce({ kind: 'order', orderId })
    },
  }
}

function createIndex(source: IndexSource, announce: (change: FoundryChange) => void): FoundryIndex {
  const slots: Slots = {
    orders: createSlot(async () => new Map((await source.orders()).map((o) => [o.id, o]))),
    gates: createSlot(async () => groupGates(await source.gates())),
    graph: createKeyedSlots((id) => source.graph(id)),
    ledger: createKeyedSlots((id) => source.ledger(id)),
  }
  return { ...readsOver(slots), ...writesOver(slots, announce), announce }
}

export interface FoundryIndexes {
  /** The index over one data root. The root follows the open workspace, so there is one per root. */
  forRoot(root: string): FoundryIndex
  /** Tell the windows about a change no file records. */
  announce(change: FoundryChange): void
}

export function createFoundryIndexes(
  sourceFor: (root: string) => IndexSource,
  announce: (change: FoundryChange) => void
): FoundryIndexes {
  const byRoot = new Map<string, FoundryIndex>()
  return {
    announce,
    forRoot(root) {
      let index = byRoot.get(root)
      if (index === undefined) {
        index = createIndex(sourceFor(root), announce)
        byRoot.set(root, index)
      }
      return index
    },
  }
}
