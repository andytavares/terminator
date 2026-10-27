import * as fs from 'node:fs'
import * as path from 'node:path'
import { orderDir } from '../data-root.js'
import type { Gate } from './rules.js'
import { BUDGET_KINDS } from '../line/scheduler.js'
import type { FoundryIndex } from '../state/foundry-index.js'
import { writeJsonAtomic } from '@terminator/extension-sdk/node'

// Gates on disk, one file per order.
//
// Kept beside the order rather than in one global file so that two orders
// cannot contend, and so a cancelled order takes its own outstanding decisions
// with it rather than leaving them in a shared queue nobody can attribute.

export interface GateStore {
  save(gate: Gate): Promise<void>
  list(): Promise<Gate[]>
  get(id: string): Promise<Gate | null>
}

function gatesPath(root: string, orderId: string): string {
  return path.join(orderDir(root, orderId), 'gates.json')
}

/**
 * A gate halted on a budget that no longer exists reads as one that never
 * recorded its breach, so raising it resumes the run rather than setting a
 * limit on nothing.
 */
function withoutRetiredBreach(gate: Gate): Gate {
  const kind = gate.breach?.kind
  if (kind === undefined || (BUDGET_KINDS as readonly string[]).includes(kind)) return gate
  return { ...gate, breach: null }
}

/**
 * `verify.flaky` is gone: a check that fails once is a failure. A gate an earlier
 * build raised under it reads as the failed-check question, which offers the same options.
 */
function withoutRetiredRule(gate: Gate): Gate {
  return (gate.rule as string) === 'verify.flaky' ? { ...gate, rule: 'verify.repeat-fail' } : gate
}

function readAsCurrent(gate: Gate): Gate {
  return withoutRetiredRule(withoutRetiredBreach(gate))
}

async function readGates(root: string, orderId: string): Promise<Gate[]> {
  try {
    const raw = await fs.promises.readFile(gatesPath(root, orderId), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as Gate[]).map(readAsCurrent) : []
  } catch {
    // A missing or unreadable file is no gates, never a thrown surface.
    return []
  }
}

/** A gate store whose root is resolved on every call. See createLiveOrderStore. */
export function createLiveGateStore(
  root: () => string,
  indexFor?: (root: string) => FoundryIndex
): GateStore {
  const gateStore = (): GateStore => createGateStore(root(), indexFor?.(root()))
  return {
    save: (gate) => gateStore().save(gate),
    list: () => gateStore().list(),
    get: (id) => gateStore().get(id),
  }
}

/** With an index, `list` and `get` read memory and `save` tells the index. */
export function createGateStore(root: string, index?: FoundryIndex): GateStore {
  async function orderIds(): Promise<string[]> {
    try {
      return await fs.promises.readdir(path.join(root, 'orders'))
    } catch {
      return []
    }
  }

  return {
    async save(gate) {
      const existing = await readGates(root, gate.orderId)
      const next = existing.some((g) => g.id === gate.id)
        ? existing.map((g) => (g.id === gate.id ? gate : g))
        : [...existing, gate]
      await fs.promises.mkdir(orderDir(root, gate.orderId), { recursive: true })
      const json = JSON.stringify(next)
      await writeJsonAtomic(gatesPath(root, gate.orderId), next)
      index?.gatesWritten(gate.orderId, (JSON.parse(json) as Gate[]).map(readAsCurrent))
    },

    async list() {
      if (index !== undefined) return index.gates()
      const ids = await orderIds()
      const perOrder = await Promise.all(ids.map((id) => readGates(root, id)))
      return perOrder.flat()
    },

    async get(id) {
      return (await this.list()).find((g) => g.id === id) ?? null
    },
  }
}

/** Saves a gate unless one with its id is already decided: `save` replaces by id. */
export async function raiseUnlessDecided(store: GateStore, gate: Gate): Promise<void> {
  if ((await store.get(gate.id))?.decision != null) return
  await store.save(gate)
}

/**
 * A decision taken before the work it gates, asked once per order.
 *
 * A resume runs the tail again, so a gate with a fixed id comes round again
 * after its own Approve. Saving it unconditionally replaced the approval with a
 * fresh question, and the operator answered it for ever.
 */
export async function askOnce(store: GateStore, gate: Gate): Promise<'approve' | 'hold'> {
  // The same rule already approved on this order answers it too: the push
  // decision after an approved "riskier than planned" was asked twice.
  const answered = (await store.list()).some(
    (prior) =>
      prior.orderId === gate.orderId &&
      prior.rule === gate.rule &&
      prior.decision?.option === 'approve'
  )
  if (answered) return 'approve'
  await store.save(gate)
  return 'hold'
}
