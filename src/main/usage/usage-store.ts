import { DatabaseSync } from 'node:sqlite'
import * as path from 'node:path'
import type { ExtensionDB } from '@terminator/extension-sdk'
import { wrapDb } from '../db/index.js'
import { makeLogger } from '../logger.js'
import type { FeatureDeclaration, Via } from '../../shared/schemas/usage.schema.js'
import type { UsageFeatureRow, UsageReport } from '../../shared/usage/usage-types.js'

export interface UsageRecord {
  feature: string
  via: Via
  failed?: boolean
  activeMs?: number
  declare?: Omit<FeatureDeclaration, 'id'>
}

export interface UsageStore {
  declare(features: FeatureDeclaration[]): Promise<void>
  recordUse(input: UsageRecord): Promise<void>
  report(from: string | null): Promise<UsageReport>
}

interface UsageStoreDeps {
  now: () => Date
  warn: (message: string) => void
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS feature (
    id TEXT PRIMARY KEY, source TEXT NOT NULL, label TEXT NOT NULL, kind TEXT NOT NULL,
    first_declared TEXT NOT NULL, last_declared TEXT NOT NULL, last_used_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS usage_day (
    day TEXT NOT NULL, feature_id TEXT NOT NULL, via TEXT NOT NULL,
    uses INTEGER NOT NULL DEFAULT 0, failures INTEGER NOT NULL DEFAULT 0,
    active_ms INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, feature_id, via))`,
]

interface FeatureRecord extends Record<string, unknown> {
  id: string
  source: string
  label: string
  kind: UsageFeatureRow['kind']
  first_declared: string
  last_used_at: string | null
}

interface DayRecord extends Record<string, unknown> {
  day: string
  feature_id: string
  via: Via
  uses: number
  failures: number
  active_ms: number
}

/** The local calendar day, 'YYYY-MM-DD'. */
function localDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Local days from `from` to `to`, both included, oldest first. */
function daysBetween(from: string, to: string): string[] {
  const [year, month, day] = from.split('-').map(Number)
  const days: string[] = []
  for (let offset = 0; ; offset++) {
    const current = localDay(new Date(year, month - 1, day + offset))
    if (current > to) return days
    days.push(current)
  }
}

interface PeriodDay extends DayRecord {
  inPeriod: boolean
}

function emptyRow(feature: FeatureRecord, declared: boolean, slots: number): UsageFeatureRow {
  return {
    id: feature.id,
    label: feature.label,
    source: feature.source,
    kind: feature.kind,
    firstDeclared: feature.first_declared,
    lastUsedAt: feature.last_used_at,
    declared,
    usesInPeriod: 0,
    usesAllTime: 0,
    activeMs: 0,
    failures: 0,
    byVia: {},
    daily: Array<number>(slots).fill(0),
  }
}

function addDay(row: UsageFeatureRow, day: PeriodDay, slots: ReadonlyMap<string, number>): void {
  row.usesAllTime += day.uses
  if (day.inPeriod) {
    row.usesInPeriod += day.uses
    row.activeMs += day.active_ms
    row.failures += day.failures
    row.byVia[day.via] = (row.byVia[day.via] ?? 0) + day.uses
  }
  const slot = slots.get(day.day)
  if (slot !== undefined) row.daily[slot] += day.uses
}

class SqliteUsageStore implements UsageStore {
  private readonly ready: Promise<unknown>
  private readonly declaredHere = new Set<string>()
  private readonly warnedAbout = new Set<string>()

  constructor(
    private readonly db: ExtensionDB,
    private readonly deps: UsageStoreDeps
  ) {
    this.ready = Promise.all(SCHEMA.map((sql) => db.exec(sql)))
  }

  async declare(features: FeatureDeclaration[]): Promise<void> {
    await this.ready
    const at = localDay(this.deps.now())
    await this.db.transaction(async (tx) => {
      for (const f of features) {
        await tx.run(
          `INSERT INTO feature (id, source, label, kind, first_declared, last_declared)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET source = excluded.source, label = excluded.label,
             kind = excluded.kind, last_declared = excluded.last_declared`,
          [f.id, f.source, f.label, f.kind, at, at]
        )
      }
    })
    for (const f of features) this.declaredHere.add(f.id)
  }

  async recordUse(input: UsageRecord): Promise<void> {
    await this.ready
    if (!(await this.isKnownOrDeclare(input))) return
    const now = this.deps.now()
    // A record that carries active time adds that time and counts no use.
    const isUse = !(input.activeMs && input.activeMs > 0)
    await this.db.run(
      `INSERT INTO usage_day (day, feature_id, via, uses, failures, active_ms)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(day, feature_id, via) DO UPDATE SET uses = uses + excluded.uses,
         failures = failures + excluded.failures, active_ms = active_ms + excluded.active_ms`,
      [
        localDay(now),
        input.feature,
        input.via,
        isUse ? 1 : 0,
        input.failed ? 1 : 0,
        input.activeMs ?? 0,
      ]
    )
    if (isUse) {
      await this.db.run('UPDATE feature SET last_used_at = ? WHERE id = ?', [
        now.toISOString(),
        input.feature,
      ])
    }
  }

  async report(from: string | null): Promise<UsageReport> {
    await this.ready
    const now = this.deps.now()
    const thirtyDaysAgo = localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29))
    const range = daysBetween(from ?? thirtyDaysAgo, localDay(now))
    const features = await this.db.query<FeatureRecord>('SELECT * FROM feature ORDER BY id')
    const dayRows = await this.db.query<DayRecord>('SELECT * FROM usage_day')
    const slots = new Map(range.map((day, index) => [day, index]))
    const rowsById = new Map(
      features.map((f) => [f.id, emptyRow(f, this.declaredHere.has(f.id), range.length)])
    )
    for (const day of dayRows) {
      const row = rowsById.get(day.feature_id)
      if (row) addDay(row, { ...day, inPeriod: from === null || day.day >= from }, slots)
    }
    const rows = [...rowsById.values()]
    const firsts = features.map((f) => f.first_declared).sort()
    return { countingSince: firsts[0] ?? null, features: rows }
  }

  /** True when the use can be counted: the id is known, or the call declared it. */
  private async isKnownOrDeclare(input: UsageRecord): Promise<boolean> {
    const { feature } = input
    if (this.declaredHere.has(feature)) return true
    if (await this.db.get('SELECT 1 AS found FROM feature WHERE id = ?', [feature])) return true
    if (input.declare) {
      await this.declare([{ id: feature, ...input.declare }])
      return true
    }
    if (!this.warnedAbout.has(feature)) {
      this.warnedAbout.add(feature)
      this.deps.warn(`usage: "${feature}" is not declared, so its use was not counted`)
    }
    return false
  }
}

export function createUsageStore(db: ExtensionDB, deps: UsageStoreDeps): UsageStore {
  return new SqliteUsageStore(db, deps)
}

let database: DatabaseSync | null = null
let store: UsageStore | null = null

export function initUsageStore(userData: string): void {
  database = new DatabaseSync(path.join(userData, 'usage.sqlite'))
  database.exec('PRAGMA journal_mode = WAL')
  const log = makeLogger('usage')
  store = createUsageStore(wrapDb(database), {
    now: () => new Date(),
    warn: (message) => log.warn(message),
  })
}

export function getUsageStore(): UsageStore {
  if (!store) throw new Error('Usage store not initialized — call initUsageStore first')
  return store
}

export function closeUsageStore(): void {
  database?.close()
  database = null
  store = null
}
