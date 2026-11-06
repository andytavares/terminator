import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import type { ExtensionDB } from '@terminator/extension-sdk'
import { describeRepeat, latestRun, type RepeatRule } from '../../shared/recurrence.js'
import type { HomeAsk } from '../../shared/schemas/home-feed.schema.js'
import type { Schedule, ScheduleInput } from '../../shared/schemas/schedules.schema.js'

// Prompts saved to run later. A run due while the app is open starts at once; one due while it
// was closed becomes an ask and never starts by itself.

/** A tick this late still starts the run; later than this the person was away (sleep, closed). */
const START_GRACE_MS = 2 * 60_000

const SCHEMA = `CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY, repo_root TEXT NOT NULL, prompt TEXT NOT NULL, run_as TEXT NOT NULL,
  kind TEXT NOT NULL, time TEXT NOT NULL, date TEXT, last_run_at TEXT, created_at TEXT NOT NULL,
  new_worktree INTEGER NOT NULL, agent_id TEXT, repeat TEXT, branch TEXT)`

/** Columns added after the first release; CREATE TABLE IF NOT EXISTS leaves old tables without them. */
const ADDED_COLUMNS = ['repeat', 'branch']

interface Row extends Record<string, unknown> {
  id: string
  repo_root: string
  prompt: string
  run_as: string
  /** Old rows hold 'daily' or 'weekdays'. */
  kind: string
  time: string
  date: string | null
  last_run_at: string | null
  created_at: string
  new_worktree: number
  agent_id: string | null
  repeat: string | null
  branch: string | null
}

const EVERY_DAY: RepeatRule = { every: 1, unit: 'day', days: [], between: null, overlap: 'skip' }
const OLD_KINDS: Record<string, RepeatRule> = {
  daily: EVERY_DAY,
  weekdays: { ...EVERY_DAY, days: [1, 2, 3, 4, 5] },
}

const repeatOf = (row: Row): RepeatRule | null =>
  row.repeat === null ? (OLD_KINDS[row.kind] ?? null) : (JSON.parse(row.repeat) as RepeatRule)

const toSchedule = (row: Row): Schedule => ({
  id: row.id,
  repoRoot: row.repo_root,
  prompt: row.prompt,
  runAs: row.run_as,
  kind: row.kind === 'once' ? 'once' : 'repeat',
  time: row.time,
  date: row.date,
  lastRunAt: row.last_run_at,
  createdAt: row.created_at,
  newWorktree: row.new_worktree === 1,
  agentId: row.agent_id,
  repeat: repeatOf(row),
  branch: row.branch,
})

export interface SchedulerDeps {
  db: ExtensionDB
  now: () => Date
  start: (schedule: Schedule) => void
  /** Everything the scheduler currently asks the person; replaces the earlier list. */
  publish: (asks: HomeAsk[]) => void
}

/** The latest moment, up to now, this schedule was meant to run (local time). */
function latestOccurrence(schedule: Schedule, now: Date): Date | null {
  const [hours, minutes] = schedule.time.split(':').map(Number)
  if (schedule.repeat !== null)
    return latestRun(
      { rule: schedule.repeat, time: schedule.time, anchor: new Date(schedule.createdAt) },
      now
    )
  const [year, month, day] = (schedule.date ?? '').split('-').map(Number)
  const at = new Date(year, month - 1, day, hours, minutes)
  return at <= now ? at : null
}

/** The occurrence nobody has run or skipped yet. */
function dueOccurrence(schedule: Schedule, now: Date): Date | null {
  const occurrence = latestOccurrence(schedule, now)
  const handled = new Date(schedule.lastRunAt ?? schedule.createdAt)
  return occurrence !== null && occurrence > handled ? occurrence : null
}

const whenWords = (schedule: Schedule): string =>
  schedule.repeat === null
    ? `once at ${schedule.time}`
    : describeRepeat(schedule.repeat, schedule.time)

/** A minute or hour repeat that came due while the app was closed is not worth an ask. */
const settlesSilently = (schedule: Schedule): boolean =>
  schedule.repeat?.unit === 'minute' || schedule.repeat?.unit === 'hour'

function missedAsk(schedule: Schedule, occurrence: Date): HomeAsk {
  return {
    id: `missed-${schedule.id}`,
    kind: 'task',
    title: 'Scheduled run missed',
    detail: schedule.prompt,
    where: `${basename(schedule.repoRoot)} · ${whenWords(schedule)}`,
    facts: [`Was due ${occurrence.toLocaleString()}, while Terminator was closed`],
    workKey: null,
    since: occurrence.toISOString(),
    actions: [
      { id: 'run', label: 'Run now', primary: true },
      { id: 'skip', label: 'Skip' },
    ],
    // Home needs somewhere to go; with no session this does nothing.
    open: { command: 'core:reveal-session' },
  }
}

/** The schedules table: what was saved, and the end of each occurrence. */
/** A one-time run whose moment is already behind `now`: it would never come due. */
function hasPassed(input: ScheduleInput, now: Date): boolean {
  if (input.kind !== 'once' || input.date === null) return false
  const [year, month, day] = input.date.split('-').map(Number)
  const [hours, minutes] = input.time.split(':').map(Number)
  return new Date(year, month - 1, day, hours, minutes).getTime() <= now.getTime()
}

function insertSchedule(db: ExtensionDB, schedule: Schedule): Promise<unknown> {
  const columns =
    'id, repo_root, prompt, run_as, kind, time, date, last_run_at, created_at, new_worktree, agent_id, repeat, branch'
  return db.run(
    `INSERT INTO schedules (${columns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      ...[schedule.id, schedule.repoRoot, schedule.prompt, schedule.runAs, schedule.kind],
      ...[schedule.time, schedule.date, null, schedule.createdAt],
      ...[schedule.newWorktree ? 1 : 0, schedule.agentId],
      ...[schedule.repeat === null ? null : JSON.stringify(schedule.repeat), schedule.branch],
    ]
  )
}

async function addMissingColumns(db: ExtensionDB): Promise<void> {
  await db.exec(SCHEMA)
  const have = (await db.query<{ name: string }>('PRAGMA table_info(schedules)')).map((c) => c.name)
  for (const column of ADDED_COLUMNS)
    if (!have.includes(column)) await db.exec(`ALTER TABLE schedules ADD COLUMN ${column} TEXT`)
}

function createScheduleStore({ db, now }: Pick<SchedulerDeps, 'db' | 'now'>) {
  return {
    init: () => addMissingColumns(db),
    list: async (): Promise<Schedule[]> =>
      (await db.query<Row>('SELECT * FROM schedules ORDER BY created_at')).map(toSchedule),
    async create(input: ScheduleInput): Promise<Schedule> {
      if (hasPassed(input, now())) throw new Error('That time has passed. Pick a later time.')
      const schedule: Schedule = {
        ...input,
        id: randomUUID(),
        lastRunAt: null,
        createdAt: now().toISOString(),
      }
      await insertSchedule(db, schedule)
      return schedule
    },
    remove: async (id: string): Promise<void> =>
      void (await db.run('DELETE FROM schedules WHERE id = ?', [id])),
    /** A run or a skip ends this occurrence: a one-time schedule is gone, the others wait for the next. */
    async settle(schedule: Schedule): Promise<void> {
      if (schedule.kind === 'once') await this.remove(schedule.id)
      else
        await db.run('UPDATE schedules SET last_run_at = ? WHERE id = ?', [
          now().toISOString(),
          schedule.id,
        ])
    },
  }
}

/** The runs waiting on the person; the Home asks follow it. */
function createMissedRuns(publish: SchedulerDeps['publish']) {
  const missed = new Map<string, { schedule: Schedule; occurrence: Date }>()
  return {
    has: (id: string): boolean => missed.has(id),
    add: (schedule: Schedule, occurrence: Date): void =>
      void missed.set(schedule.id, { schedule, occurrence }),
    /** Takes the run the ask `askId` stands for, if it is still waiting. */
    take: (askId: string): Schedule | undefined => {
      const entry = [...missed.values()].find((m) => `missed-${m.schedule.id}` === askId)
      if (entry !== undefined) missed.delete(entry.schedule.id)
      return entry?.schedule
    },
    drop: (id: string): boolean => missed.delete(id),
    publishAll: (): void =>
      publish([...missed.values()].map((m) => missedAsk(m.schedule, m.occurrence))),
  }
}

interface ScanDeps extends SchedulerDeps {
  store: ReturnType<typeof createScheduleStore>
  missed: ReturnType<typeof createMissedRuns>
}

/** Starts what is due within `graceMs`; what came due longer ago waits for the person. */
async function scanSchedules(deps: ScanDeps, graceMs: number): Promise<void> {
  const { now, start, store, missed } = deps
  for (const schedule of await store.list()) {
    const occurrence = missed.has(schedule.id) ? null : dueOccurrence(schedule, now())
    if (occurrence === null) continue
    if (now().getTime() - occurrence.getTime() <= graceMs) {
      await store.settle(schedule)
      start(schedule)
    } else if (settlesSilently(schedule)) await store.settle(schedule)
    else missed.add(schedule, occurrence)
  }
  missed.publishAll()
}

export function createScheduler(deps: SchedulerDeps) {
  const store = createScheduleStore(deps)
  const missed = createMissedRuns(deps.publish)
  const scan = (graceMs: number) => scanSchedules({ ...deps, store, missed }, graceMs)
  return {
    init: store.init,
    list: store.list,
    create: store.create,
    async remove(id: string): Promise<void> {
      missed.drop(id)
      await store.remove(id)
      missed.publishAll()
    },
    /** Once a minute while the app runs. */
    tick: () => scan(START_GRACE_MS),
    /** Once at start-up: whatever came due while the app was closed waits for the person. */
    checkMissed: () => scan(-1),
    /** The person's answer to a missed-run ask. */
    async act(askId: string, actionId: string): Promise<void> {
      const schedule = missed.take(askId)
      if (schedule === undefined) return
      await store.settle(schedule)
      if (actionId === 'run') deps.start(schedule)
      missed.publishAll()
    },
  }
}
