import type { z } from 'zod'
import type { ExtensionDB } from '@terminator/extension-sdk'
import { noPayload } from '@terminator/extension-sdk'
import { route, type IpcContext } from './register'
import { insertTask } from '../vault/task-repository'
import { randomUUID } from '../vault/db'
import { staleDaysThreshold, STALE_THRESHOLD_KEY } from '../stale-threshold'
import {
  CalendarMonthRequestSchema,
  CompleteTaskRequestSchema,
  GetDailyRequestSchema,
  StaleThresholdRequestSchema,
} from '../schemas/vault.schema'
import {
  rowToTask,
  rowToProject,
  TASK_COLS,
  TASK_JOINS,
  PROJECT_COLS,
  PROJECT_JOINS,
} from '../vault/mappers'
import {
  dailyTasks,
  indexUpdated,
  nowIso,
  orErrorString,
  tasksWithSubtasks,
  today,
} from './vault-shared'

type Row = Record<string, unknown>
type Tx = Pick<ExtensionDB, 'run'>

interface RollOver {
  date: string
  now: string
}

/** Copies one unfinished task from an earlier day into today, marking the original migrated. */
async function rollOverRow(tx: Tx, row: Row, at: RollOver): Promise<string> {
  const { date, now } = at
  const newId = randomUUID()
  const inheritedTodaySince = (row.today_since as string) || (row.source_ref as string) || date
  await insertTask(
    tx,
    {
      id: newId,
      text: row.text as string,
      status: 'open',
      projectId: (row.project_id as string) ?? null,
      context: (row.context as string) ?? null,
      areaId: (row.area_id as string) ?? null,
      dueDate: (row.due_date as string) ?? null,
      source: 'daily',
      sourceRef: date,
      todaySince: inheritedTodaySince,
      createdAt: now,
      updatedAt: now,
    },
    { orIgnore: true }
  )
  await markRolledOver(tx, row.id as string, at)
  return newId
}

/** Marks the original migrated and moves its subtasks onto today's log. */
async function markRolledOver(tx: Tx, rowId: string, at: RollOver): Promise<void> {
  const { date, now } = at
  await tx.run(`UPDATE tasks SET status='migrated', migrated_to=?, updated_at=? WHERE id=?`, [
    date,
    now,
    rowId,
  ])
  await tx.run(`UPDATE tasks SET source='daily', source_ref=?, updated_at=? WHERE parent_id=?`, [
    date,
    now,
    rowId,
  ])
}

/** Rolls every unfinished, non-recurring task of earlier days into today. */
async function rollOverStaleTasks(db: ExtensionDB, date: string) {
  const staleRows = await db.query<Row>(
    `SELECT t.id, t.text, p.name AS project, t.context, a.name AS area, t.due_date, t.project_id, t.area_id, t.source_ref, t.today_since
         FROM tasks t ${TASK_JOINS}
         WHERE t.source='daily' AND t.source_ref < ? AND t.source_ref IS NOT NULL
           AND t.status IN ('open','in-progress','blocked') AND t.parent_id IS NULL
           AND t.recurrence_rule IS NULL`,
    [date]
  )
  const rolledOverIds: string[] = []
  if (staleRows.length > 0) {
    const at = { date, now: nowIso() }
    await db.transaction(async (tx) => {
      for (const row of staleRows) rolledOverIds.push(await rollOverRow(tx, row, at))
    })
  }
  return { rolledOver: staleRows.length, rolledOverIds }
}

function getToday({ api, db }: IpcContext) {
  return orErrorString(async () => {
    const date = today()
    const { rolledOver, rolledOverIds } = await rollOverStaleTasks(db, date)
    const tasks = await dailyTasks(db, date)
    return {
      date,
      filePath: `daily/${date}.md`,
      tasks,
      rolledOver,
      rolledOverIds,
      exists: tasks.length > 0,
      staleDaysThreshold: staleDaysThreshold(api),
    }
  })
}

function getDaily({ db }: IpcContext, args: z.infer<typeof GetDailyRequestSchema>) {
  return orErrorString(async () => {
    const { date } = args
    const tasks = await dailyTasks(db, date)
    return { date, filePath: `daily/${date}.md`, tasks, exists: tasks.length > 0 }
  })
}

function getInbox({ db }: IpcContext) {
  return orErrorString(async () => {
    const rows = await db.query<Row>(
      `SELECT ${TASK_COLS} FROM tasks t ${TASK_JOINS}
         WHERE t.source='inbox' AND t.status='open' AND t.parent_id IS NULL ORDER BY t.created_at`
    )
    return { tasks: await tasksWithSubtasks(db, rows) }
  })
}

function listSomeday({ db }: IpcContext) {
  return orErrorString(async () => {
    const taskRows = await db.query<Row>(
      `SELECT ${TASK_COLS} FROM tasks t ${TASK_JOINS}
         WHERE t.source='someday' AND t.status='open' AND t.parent_id IS NULL
         ORDER BY t.created_at ASC`
    )
    const projectRows = await db.query<Row>(
      `SELECT ${PROJECT_COLS} FROM projects p ${PROJECT_JOINS} WHERE p.status='someday' ORDER BY p.name ASC`
    )
    return { tasks: taskRows.map(rowToTask), projects: projectRows.map(rowToProject) }
  })
}

function somedayToToday({ db }: IpcContext, args: z.infer<typeof CompleteTaskRequestSchema>) {
  const { taskId } = args
  return orErrorString(async () => {
    const todayDate = today()
    const now = nowIso()
    await db.run(
      `UPDATE tasks SET source='daily', source_ref=?, status='open', updated_at=? WHERE id=?`,
      [todayDate, now, taskId]
    )
    await db.run(`UPDATE tasks SET source='daily', source_ref=?, updated_at=? WHERE parent_id=?`, [
      todayDate,
      now,
      taskId,
    ])
    indexUpdated()
    return { success: true }
  })
}

async function calendarMonth({ db }: IpcContext, args: z.infer<typeof CalendarMonthRequestSchema>) {
  const { year, month } = args
  const pad = (n: number) => String(n).padStart(2, '0')
  const startDate = `${year}-${pad(month)}-01`
  const endDate = `${year}-${pad(month)}-31`
  type DayRow = { date: string; status: string; count: string }
  const rows = await db.query<DayRow>(
    `SELECT source_ref AS date, status, COUNT(*) AS count
       FROM tasks
       WHERE source='daily' AND source_ref >= ? AND source_ref <= ?
         AND parent_id IS NULL
       GROUP BY source_ref, status`,
    [startDate, endDate]
  )
  return { days: rows.map((r) => ({ ...r, count: Number(r.count) })) }
}

async function resetTodaySince(
  { db }: IpcContext,
  args: z.infer<typeof CompleteTaskRequestSchema>
) {
  await db.run(`UPDATE tasks SET today_since=?, updated_at=? WHERE id=?`, [
    today(),
    nowIso(),
    args.taskId,
  ])
  return { success: true }
}

/** Writes the "Stale task threshold" setting, as its settings page does. */
function setStaleThreshold({ api }: IpcContext, args: z.infer<typeof StaleThresholdRequestSchema>) {
  api.settings.set(STALE_THRESHOLD_KEY, args.days)
  return { success: true }
}

/** Channels for the daily log, the inbox and someday lists, and the calendar. */
export const DAILY_ROUTES = [
  route('task-vault:vault:get-today', noPayload, getToday),
  route('task-vault:vault:get-daily', GetDailyRequestSchema, getDaily),
  route('task-vault:vault:get-inbox', noPayload, getInbox),
  route('task-vault:vault:list-someday', noPayload, listSomeday),
  route('task-vault:vault:someday-to-today', CompleteTaskRequestSchema, somedayToToday),
  route('task-vault:vault:get-calendar-month', CalendarMonthRequestSchema, calendarMonth),
  route('task-vault:vault:reset-today-since', CompleteTaskRequestSchema, resetTodaySince),
  route('task-vault:settings:set-stale-threshold', StaleThresholdRequestSchema, setStaleThreshold),
]
