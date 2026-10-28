import type { ExtensionAPI, ExtensionDB, Disposable } from '@terminator/extension-sdk'
import { buildHomeFeed, taskIdOf } from './feed.js'
import { completeTask } from '../ipc/vault-task-state.js'
import type { IpcContext } from '../ipc/register.js'
import { openInVault } from '../navigation.js'
import { rowToTask, TASK_COLS, TASK_JOINS } from '../vault/mappers.js'
import { zonedNow } from '../vault/clock.js'
import type { IndexedTask } from '../vault/types.js'

const DEBOUNCE_MS = 500

type Row = Record<string, unknown>

export interface HomePublisher extends Disposable {
  /** Publishes after a quiet 500 ms, however many changes arrive meanwhile. */
  schedule(): void
}

/** Tasks that are due by `today`, or on Today and not finished before it. */
async function homeTasks(db: ExtensionDB, today: string): Promise<IndexedTask[]> {
  const rows = await db.query<Row>(
    `SELECT ${TASK_COLS} FROM tasks t ${TASK_JOINS}
      WHERE (t.due_date IS NOT NULL AND t.due_date <= ?)
         OR (t.today_since IS NOT NULL AND (t.status <> 'done' OR t.completed_date = ?))`,
    [today, today]
  )
  return rows.map(rowToTask)
}

async function publishVaultFeed(api: ExtensionAPI, db: ExtensionDB): Promise<void> {
  const now = zonedNow()
  const today = now.toPlainDate().toString()
  api.home.publish(
    buildHomeFeed({
      tasks: await homeTasks(db, today),
      today,
    })
  )
}

function untilMidnight(): number {
  const now = zonedNow()
  return now.add({ days: 1 }).startOfDay().epochMilliseconds - now.epochMilliseconds
}

async function runVaultHomeAction(
  { api, db }: IpcContext,
  itemId: string,
  actionId: string
): Promise<void> {
  const taskId = taskIdOf(itemId)
  if (actionId === 'done' && taskId) await completeTask({ api, db }, { taskId })
  else if (actionId === 'open' && taskId) openInVault(api, { taskId })
}

/** Keeps Task Vault's Home feed current: on change (debounced) and when the date rolls over. */
export function startHomePublisher(api: ExtensionAPI, db: ExtensionDB): HomePublisher {
  let debounce: ReturnType<typeof setTimeout> | null = null
  let midnight: ReturnType<typeof setTimeout> | null = null

  const publishNow = () => {
    debounce = null
    publishVaultFeed(api, db).catch((err) => console.error('[task-vault] Home publish:', err))
  }
  const scheduleVaultPublish = () => {
    if (debounce !== null) clearTimeout(debounce)
    debounce = setTimeout(publishNow, DEBOUNCE_MS)
  }
  const rollOverAtMidnight = () => {
    midnight = setTimeout(() => {
      scheduleVaultPublish()
      rollOverAtMidnight()
    }, untilMidnight())
  }

  const action = api.home.onAction((id, act) => runVaultHomeAction({ api, db }, id, act))
  rollOverAtMidnight()
  return {
    schedule: scheduleVaultPublish,
    dispose: () => {
      if (debounce !== null) clearTimeout(debounce)
      if (midnight !== null) clearTimeout(midnight)
      action.dispose()
    },
  }
}
