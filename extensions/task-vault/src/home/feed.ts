import type { HomeAsk, HomeFeed, HomeFocusCandidate } from '@terminator/extension-sdk'
import type { IndexedTask } from '../vault/types'

export const OPEN_COMMAND = 'task-vault:open'
const TASK_ITEM_PREFIX = 'task:'

export interface HomeFeedInput {
  tasks: IndexedTask[]
  /** Today's local date, YYYY-MM-DD. */
  today: string
}

const FINISHED: IndexedTask['status'][] = ['done', 'cancelled', 'migrated']

/** The task a Home item id names, or null when it names something else. */
export function taskIdOf(itemId: string): string | null {
  return itemId.startsWith(TASK_ITEM_PREFIX) ? itemId.slice(TASK_ITEM_PREFIX.length) : null
}

function dueAsk(task: IndexedTask, today: string): HomeAsk {
  const fact = task.project ?? task.area
  return {
    id: TASK_ITEM_PREFIX + task.id,
    kind: 'task',
    title: task.dueDate === today ? 'Task due' : 'Task overdue',
    detail: task.text,
    where: fact ? `Task Vault · ${fact}` : 'Task Vault',
    facts: fact ? [fact] : [],
    workKey: null,
    since: new Date(`${task.dueDate}T00:00:00`).toISOString(),
    actions: [
      { id: 'done', label: 'Mark done', primary: true },
      { id: 'open', label: 'Open' },
    ],
    open: { command: OPEN_COMMAND, args: { taskId: task.id } },
  }
}

// A task's terminator link is a terminal session id, which names no tracker issue or branch,
// so a task cannot be tied to a piece of work: its workKey is always null.
function focusCandidate(task: IndexedTask): HomeFocusCandidate {
  return {
    id: TASK_ITEM_PREFIX + task.id,
    title: task.text,
    detail: task.project ?? task.area,
    workKey: null,
    done: task.status === 'done',
  }
}

/** What Task Vault shows on Home: due and overdue tasks, and today's tasks. */
export function buildHomeFeed(input: HomeFeedInput): HomeFeed {
  const asks = input.tasks
    .filter((t) => t.dueDate && t.dueDate <= input.today && !FINISHED.includes(t.status))
    .map((t) => dueAsk(t, input.today))
  const focus = input.tasks
    .filter((t) => t.todaySince && !['cancelled', 'migrated'].includes(t.status))
    .map(focusCandidate)
  return { asks, facets: [], measures: [], focus }
}
