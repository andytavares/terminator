import * as fs from 'node:fs'
import * as path from 'node:path'

// Every decision, by whom or by what rule, and why (FR-078).
//
// Append-only, one JSON object per line. A reversal is a new entry; nothing
// rewrites a line. That is what lets several unit writers append at the same
// time without a lock — each append is one whole line opened for append, never
// a read-modify-write — and it is what makes the curator's citations mean
// something later, since the entry it cites cannot have changed underneath it.

export interface LedgerEvidence {
  readonly kind: string
  readonly path?: string
  readonly excerpt?: string
  readonly exitCode?: number
}

export interface LedgerEntry {
  readonly at: string
  readonly orderId: string
  /** `operator`, `rule:<id>` or `role:<id>`. Never empty. */
  readonly actor: string
  readonly action: string
  readonly subject: string
  readonly reason: string
  readonly evidence: readonly LedgerEvidence[]
}

export interface LedgerQuery {
  readonly orderId?: string
  readonly actor?: string
  readonly action?: string
  readonly since?: string
  readonly limit?: number
}

export class UnattributedEntryError extends Error {
  readonly code = 'UNATTRIBUTED_LEDGER_ENTRY'
  constructor(missing: 'actor' | 'action') {
    super(
      `A ledger entry needs an ${missing}: an unattributed decision is not a record of a decision.`
    )
    this.name = 'UnattributedEntryError'
  }
}

/**
 * Add one entry. Creates the file and its parents on first write.
 *
 * `appendFile` rather than read-modify-write, deliberately: the whole
 * concurrency story rests on each writer contributing exactly one line.
 */
export async function appendEntry(file: string, entry: LedgerEntry): Promise<void> {
  if (entry.actor.trim() === '') throw new UnattributedEntryError('actor')
  if (entry.action.trim() === '') throw new UnattributedEntryError('action')

  await fs.promises.mkdir(path.dirname(file), { recursive: true })
  await fs.promises.appendFile(file, `${JSON.stringify(entry)}\n`, 'utf8')
}

function isEntry(value: unknown): value is LedgerEntry {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.at === 'string' && typeof v.actor === 'string' && typeof v.action === 'string'
}

/**
 * Every entry, oldest first.
 *
 * A corrupt line is skipped rather than fatal: a half-written line from a
 * killed process must not cost the operator the record of everything that
 * happened before it.
 */
export async function readEntries(file: string): Promise<LedgerEntry[]> {
  let raw: string
  try {
    raw = await fs.promises.readFile(file, 'utf8')
  } catch {
    return []
  }
  const out: LedgerEntry[] = []
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue
    try {
      const parsed: unknown = JSON.parse(line)
      if (isEntry(parsed)) out.push(parsed)
    } catch {
      // A partial line. Skip it; the rest of the ledger is still the record.
    }
  }
  return out
}

/** Filtered, oldest first; `limit` keeps the most recent. */
export async function queryEntries(file: string, query: LedgerQuery = {}): Promise<LedgerEntry[]> {
  const all = await readEntries(file)
  const matched = all.filter((entry) => {
    if (query.orderId !== undefined && entry.orderId !== query.orderId) return false
    if (query.actor !== undefined && entry.actor !== query.actor) return false
    if (query.action !== undefined && entry.action !== query.action) return false
    if (query.since !== undefined && entry.at < query.since) return false
    return true
  })
  return query.limit === undefined ? matched : matched.slice(-query.limit)
}
