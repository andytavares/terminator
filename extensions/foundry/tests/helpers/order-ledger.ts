/** Reading an order's ledger the way the store reads it, for specs that wait on or assert it. */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { eventually } from '../../../../tests/support/eventually'
import { createOrderStore } from '../../src/order/store.js'
import type { LedgerEntry } from '../../src/ledger/append.js'

/** Every entry of the order's ledger under `dataDir`, oldest first. */
export function orderLedger(dataDir: string, orderId = 'WO-1'): Promise<LedgerEntry[]> {
  return createOrderStore(dataDir).entries(orderId)
}

/** The actions of the order's ledger under `dataDir`, oldest first. */
export async function ledgerActions(dataDir: string, orderId = 'WO-1'): Promise<string[]> {
  return (await orderLedger(dataDir, orderId)).map((entry) => entry.action)
}

/** WO-1's ledger file under `dataDir` as written, one JSON entry per line; empty before any. */
export function ledgerFileText(dataDir: string): string {
  const file = path.join(dataDir, 'orders', 'WO-1', 'ledger.jsonl')
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
}

/** Until WO-1's ledger has an `action` entry, saying `reason` when one is given; that entry. */
export function untilLedgerHas(
  dataDir: string,
  action: string,
  reason?: string
): Promise<LedgerEntry> {
  return eventually(async () => {
    const found = (await orderLedger(dataDir)).find(
      (entry) => entry.action === action && (reason === undefined || entry.reason === reason)
    )
    if (found === undefined) throw new Error(`no ${action} yet`)
    return found
  })
}
