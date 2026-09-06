import * as fs from 'node:fs'
import * as path from 'node:path'
import { orderDir } from '../data-root.js'
import type { Gate } from './rules.js'

// Gates on disk, one file per order.
//
// Kept beside the order rather than in one global file so that two orders
// cannot contend, and so a cancelled order takes its own outstanding decisions
// with it rather than leaving them in a shared queue nobody can attribute.

export interface GateStore {
  save(gate: Gate): Promise<void>
  list(): Promise<Gate[]>
  forOrder(orderId: string): Promise<Gate[]>
  get(id: string): Promise<Gate | null>
}

function gatesPath(root: string, orderId: string): string {
  return path.join(orderDir(root, orderId), 'gates.json')
}

async function read(root: string, orderId: string): Promise<Gate[]> {
  try {
    const raw = await fs.promises.readFile(gatesPath(root, orderId), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as Gate[]) : []
  } catch {
    // A missing or unreadable file is no gates, never a thrown surface.
    return []
  }
}

export function createGateStore(root: string): GateStore {
  async function orderIds(): Promise<string[]> {
    try {
      return await fs.promises.readdir(path.join(root, 'orders'))
    } catch {
      return []
    }
  }

  async function forOrder(orderId: string): Promise<Gate[]> {
    return read(root, orderId)
  }

  return {
    forOrder,

    async save(gate) {
      const existing = await read(root, gate.orderId)
      const next = existing.some((g) => g.id === gate.id)
        ? existing.map((g) => (g.id === gate.id ? gate : g))
        : [...existing, gate]
      await fs.promises.mkdir(orderDir(root, gate.orderId), { recursive: true })
      await fs.promises.writeFile(
        gatesPath(root, gate.orderId),
        `${JSON.stringify(next, null, 2)}\n`,
        'utf8'
      )
    },

    async list() {
      const ids = await orderIds()
      const perOrder = await Promise.all(ids.map((id) => read(root, id)))
      return perOrder.flat()
    },

    async get(id) {
      return (await this.list()).find((g) => g.id === id) ?? null
    },
  }
}
