import type { HomeAsk, HomeFeed, HomeFocusCandidate } from '@terminator/extension-sdk'
import type { IndexedTask } from '../vault/types'

export const OPEN_COMMAND = 'task-vault:open'
export const WEEKLY_REVIEW_ITEM = 'weekly-review'
const TASK_ITEM_PREFIX = 'task:'

export interface HomeFeedInput {
  tasks: IndexedTask[]
  /** Today's local date, YYYY-MM-DD. */
  today: string
  /** The weekly review day setting: 0 is Sunday. */
  reviewDay: number
  /** Today's weekday: 0 is Sunday. */
  weekday: number
  reviewStarted: boolean
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

function reviewAsk(): HomeAsk {
  return {
    id: WEEKLY_REVIEW_ITEM,
    kind: 'task',
    title: 'Weekly review is ready',
    detail: 'Look back over the week and plan the next one.',
    where: 'Task Vault · due today',
    facts: [],
    workKey: null,
    since: new Date().toISOString(),
    actions: [{ id: 'start-review', label: 'Start', primary: true }],
    open: { command: OPEN_COMMAND, args: { view: 'review' } },
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

/** What Task Vault shows on Home: due and overdue tasks, the review nudge, and today's tasks. */
export function buildHomeFeed(input: HomeFeedInput): HomeFeed {
  const asks = input.tasks
    .filter((t) => t.dueDate && t.dueDate <= input.today && !FINISHED.includes(t.status))
    .map((t) => dueAsk(t, input.today))
  if (input.weekday === input.reviewDay && !input.reviewStarted) asks.push(reviewAsk())
  const focus = input.tasks
    .filter((t) => t.todaySince && !['cancelled', 'migrated'].includes(t.status))
    .map(focusCandidate)
  return { asks, facets: [], measures: [], focus }
}
