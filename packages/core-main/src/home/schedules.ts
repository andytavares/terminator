import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import type { ExtensionDB } from '@terminator/extension-sdk'
import { describeRepeat, latestRun, type RepeatRule } from '../../../core-shared/src/recurrence.js'
import type { HomeAsk } from '../../../core-shared/src/schemas/home-feed.schema.js'
import type { Schedule, ScheduleInput } from '../../../core-shared/src/schemas/schedules.schema.js'

// Prompts saved to run later. A run due while the app is open starts at once; one due while it
// was closed becomes an ask and never starts by itself.

/** A tick this late still starts the run; later than this the person was away (sleep, closed). */
const START_GRACE_MS = 2 * 60_000

const SCHEMA = `CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY, repo_root TEXT NOT NULL, prompt TEXT NOT NULL, run_as TEXT NOT NULL,
  kind TEXT NOT NULL, time TEXT NOT NULL, date TEXT, last_run_at TEXT, created_at TEXT NOT NULL,
  new_worktree INTEGER NOT NULL, agent_id TEXT, repeat TEXT, branch TEXT, paused_at TEXT, settled_at TEXT)`

/** Columns added after the first release; CREATE TABLE IF NOT EXISTS leaves old tables without them. */
const ADDED_COLUMNS = ['repeat', 'branch', 'paused_at', 'settled_at']

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
  paused_at: string | null
  /** When the last occurrence was run, skipped, or set aside by an edit or a resume. */
  settled_at: string | null
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
  repoRoot: row.repo_root === '' ? null : row.repo_root,
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
  paused: row.paused_at !== null,
})

/** A saved run plus the moment its occurrences up to then count as handled. */
type StoredSchedule = Schedule & { settledAt: string | null }

const toStored = (row: Row): StoredSchedule => ({ ...toSchedule(row), settledAt: row.settled_at })

export interface SchedulerDeps {
  db: ExtensionDB
  now: () => Date
  start: (schedule: Schedule) => void
  /** Everything the scheduler currently asks the person; replaces the earlier list. */
  publish: (asks: HomeAsk[]) => void
}

/** The local moment a one-time run is set for, from its 'YYYY-MM-DD' date and 'HH:MM' time. */
function onceAt(date: string, time: string): Date {
  const [year, month, day] = date.split('-').map(Number)
  const [hours, minutes] = time.split(':').map(Number)
  return new Date(year, month - 1, day, hours, minutes)
}

/** The latest moment, up to now, this schedule was meant to run (local time). */
function latestOccurrence(schedule: Schedule, now: Date): Date | null {
  if (schedule.repeat !== null)
    return latestRun(
      { rule: schedule.repeat, time: schedule.time, anchor: new Date(schedule.createdAt) },
      now
    )
  const at = onceAt(schedule.date ?? '', schedule.time)
  return at <= now ? at : null
}

/** The occurrence nobody has run or skipped yet. */
function dueOccurrence(schedule: StoredSchedule, now: Date): Date | null {
  const occurrence = latestOccurrence(schedule, now)
  // Rows saved before settled_at existed record a skip in last_run_at.
  const handled = new Date(schedule.settledAt ?? schedule.lastRunAt ?? schedule.createdAt)
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
    where: `${schedule.repoRoot === null ? 'Global' : basename(schedule.repoRoot)} · ${whenWords(schedule)}`,
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

/** A one-time run whose moment is already behind `now`: it would never come due. */
function hasPassed(input: ScheduleInput, now: Date): boolean {
  if (input.kind !== 'once' || input.date === null) return false
  return onceAt(input.date, input.time).getTime() <= now.getTime()
}

interface RowMarks {
  pausedAt: string | null
  settledAt: string | null
}

/** Writes the whole row; an edit replaces the row it keeps the id of. */
function writeSchedule(db: ExtensionDB, schedule: Schedule, marks: RowMarks) {
  const columns =
    'id, repo_root, prompt, run_as, kind, time, date, last_run_at, created_at, new_worktree, agent_id, repeat, branch, paused_at, settled_at'
  return db.run(
    `INSERT OR REPLACE INTO schedules (${columns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      // repo_root is NOT NULL and SQLite cannot drop that without a table rebuild: '' is a global run.
      ...[schedule.id, schedule.repoRoot ?? '', schedule.prompt, schedule.runAs, schedule.kind],
      ...[schedule.time, schedule.date, schedule.lastRunAt, schedule.createdAt],
      ...[schedule.newWorktree ? 1 : 0, schedule.agentId],
      ...[schedule.repeat === null ? null : JSON.stringify(schedule.repeat), schedule.branch],
      ...[marks.pausedAt, marks.settledAt],
    ]
  )
}

const GONE = 'That scheduled run no longer exists.'

async function findRow(db: ExtensionDB, id: string): Promise<Row> {
  const [row] = await db.query<Row>('SELECT * FROM schedules WHERE id = ?', [id])
  if (row === undefined) throw new Error(GONE)
  return row
}

const selectSchedules = (db: ExtensionDB): Promise<Row[]> =>
  db.query<Row>('SELECT * FROM schedules ORDER BY created_at')

async function addMissingColumns(db: ExtensionDB): Promise<void> {
  await db.exec(SCHEMA)
  const have = (await db.query<{ name: string }>('PRAGMA table_info(schedules)')).map((c) => c.name)
  for (const column of ADDED_COLUMNS)
    if (!have.includes(column)) await db.exec(`ALTER TABLE schedules ADD COLUMN ${column} TEXT`)
}

/** Changes the person makes to a saved run after it was created. */
function createScheduleEdits({ db, now }: Pick<SchedulerDeps, 'db' | 'now'>) {
  return {
    findSchedule: async (id: string): Promise<Schedule> => toSchedule(await findRow(db, id)),
    /** Occurrences before the edit count as handled, so the edit raises no missed ask. */
    async update(id: string, input: ScheduleInput): Promise<Schedule> {
      const row = await findRow(db, id)
      if (hasPassed(input, now())) throw new Error('That time has passed. Pick a later time.')
      const { createdAt, paused, lastRunAt } = toSchedule(row)
      const schedule: Schedule = { ...input, id, createdAt, paused, lastRunAt }
      await writeSchedule(db, schedule, { pausedAt: row.paused_at, settledAt: now().toISOString() })
      return schedule
    },
    /** A resume counts the occurrences during the pause as handled. */
    async writePaused(id: string, paused: boolean): Promise<void> {
      const changed = paused
        ? await db.run('UPDATE schedules SET paused_at = ? WHERE id = ?', [now().toISOString(), id])
        : await db.run('UPDATE schedules SET paused_at = NULL, settled_at = ? WHERE id = ?', [
            now().toISOString(),
            id,
          ])
      if (changed === 0) throw new Error(GONE)
    },
  }
}

function createScheduleStore({ db, now }: Pick<SchedulerDeps, 'db' | 'now'>) {
  return {
    ...createScheduleEdits({ db, now }),
    init: () => addMissingColumns(db),
    list: async (): Promise<Schedule[]> => (await selectSchedules(db)).map(toSchedule),
    stored: async (): Promise<StoredSchedule[]> => (await selectSchedules(db)).map(toStored),
    async create(input: ScheduleInput): Promise<Schedule> {
      if (hasPassed(input, now())) throw new Error('That time has passed. Pick a later time.')
      const schedule: Schedule = {
        ...input,
        id: randomUUID(),
        lastRunAt: null,
        createdAt: now().toISOString(),
        paused: false,
      }
      await writeSchedule(db, schedule, { pausedAt: null, settledAt: null })
      return schedule
    },
    remove: async (id: string): Promise<void> =>
      void (await db.run('DELETE FROM schedules WHERE id = ?', [id])),
    /** A run or a skip ends this occurrence: a one-time schedule is gone, the others wait for the next. */
    async settle(schedule: Schedule, ran: boolean): Promise<void> {
      if (schedule.kind === 'once') return this.remove(schedule.id)
      const at = now().toISOString()
      await db.run(
        'UPDATE schedules SET settled_at = ?, last_run_at = CASE WHEN ? THEN ? ELSE last_run_at END WHERE id = ?',
        [at, ran ? 1 : 0, at, schedule.id]
      )
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
  for (const schedule of await store.stored()) {
    const waiting = schedule.paused || missed.has(schedule.id)
    const occurrence = waiting ? null : dueOccurrence(schedule, now())
    if (occurrence === null) continue
    if (now().getTime() - occurrence.getTime() <= graceMs) {
      await store.settle(schedule, true)
      start(schedule)
    } else if (settlesSilently(schedule)) await store.settle(schedule, false)
    else missed.add(schedule, occurrence)
  }
  missed.publishAll()
}

type ControlDeps = Omit<ScanDeps, keyof SchedulerDeps> & Pick<SchedulerDeps, 'start'>

/** What the person does to a saved run; each drops the missed ask it would leave behind. */
function createScheduleControls(deps: ControlDeps) {
  const { store, missed, start } = deps
  return {
    async update(id: string, input: ScheduleInput): Promise<Schedule> {
      const schedule = await store.update(id, input)
      if (missed.drop(id)) missed.publishAll()
      return schedule
    },
    async pauseRun(id: string, paused: boolean): Promise<void> {
      await store.writePaused(id, paused)
      if (missed.drop(id)) missed.publishAll()
    },
    /** Starts it out of turn: a one-time run is used up, a repeat keeps its next time. */
    async runNow(id: string): Promise<void> {
      const schedule = await store.findSchedule(id)
      // Settling also stops the tick starting this occurrence again, or raising its missed ask.
      await store.settle(schedule, true)
      start(schedule)
      if (missed.drop(id)) missed.publishAll()
    },
    async remove(id: string): Promise<void> {
      missed.drop(id)
      await store.remove(id)
      missed.publishAll()
    },
  }
}

export function createScheduler(deps: SchedulerDeps) {
  const store = createScheduleStore(deps)
  const missed = createMissedRuns(deps.publish)
  const scan = (graceMs: number) => scanSchedules({ ...deps, store, missed }, graceMs)
  return {
    init: store.init,
    list: store.list,
    create: store.create,
    ...createScheduleControls({ store, missed, start: deps.start }),
    /** Once a minute while the app runs. */
    tick: () => scan(START_GRACE_MS),
    /** Once at start-up: whatever came due while the app was closed waits for the person. */
    checkMissed: () => scan(-1),
    /** The person's answer to a missed-run ask. */
    async act(askId: string, actionId: string): Promise<void> {
      const schedule = missed.take(askId)
      if (schedule === undefined) return
      await store.settle(schedule, actionId === 'run')
      if (actionId === 'run') deps.start(schedule)
      missed.publishAll()
    },
  }
}
