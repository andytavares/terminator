import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import { writeJsonAtomic } from '@terminator/extension-sdk/node'
import {
  TaskSchema,
  type Task,
  type TaskCreateInput,
  type TaskLane,
  type TaskUpdateInput,
} from '../../shared/schemas/tasks.schema.js'
import { sameLane } from '../../shared/task-lanes.js'

// The operator's pieces of work: each groups lanes (a branch in a repository)
// across repositories. Held in memory for synchronous readers and mirrored to
// disk with a tmp-then-rename write, like session-record-store.

const FILE_NAME = 'tasks.json'

type TaskChangeHandler = (tasks: Task[]) => void

export class TaskError extends Error {
  constructor(
    readonly code: 'NOT_FOUND',
    message: string
  ) {
    super(message)
  }
}

const tasks = new Map<string, Task>()
const handlers = new Set<TaskChangeHandler>()

const filePath = (): string => path.join(app.getPath('userData'), FILE_NAME)

export function listTasks(): Task[] {
  return [...tasks.values()]
}

async function commit(): Promise<void> {
  await writeJsonAtomic(filePath(), listTasks())
  const snapshot = listTasks()
  for (const handler of handlers) handler(snapshot)
}

function find(id: string): Task {
  const task = tasks.get(id)
  if (task === undefined) throw new TaskError('NOT_FOUND', `No task ${id}`)
  return task
}

async function readStoredEntries(): Promise<unknown[]> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(filePath(), 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    // Missing or unreadable means no tasks, never a failed startup.
    return []
  }
}

/** Read what was stored, dropping entries that are not tasks. Called once at startup. */
export async function loadTasks(): Promise<void> {
  tasks.clear()
  for (const entry of await readStoredEntries()) {
    const parsed = TaskSchema.safeParse(entry)
    if (parsed.success) tasks.set(parsed.data.id, parsed.data)
  }
}

function withoutLane(task: Task, lane: TaskLane): Task {
  return { ...task, lanes: task.lanes.filter((l) => !sameLane(l, lane)) }
}

/** A lane belongs to one task: take it out of every task but `owner`. */
function claimLane(owner: string, lane: TaskLane): void {
  for (const [id, task] of tasks) {
    if (id !== owner) tasks.set(id, withoutLane(task, lane))
  }
}

function withLane(task: Task, lane: TaskLane): Task {
  if (task.lanes.some((l) => sameLane(l, lane))) return task
  return { ...task, lanes: [...task.lanes, lane] }
}

export async function createTask(input: TaskCreateInput): Promise<Task> {
  const id = randomUUID()
  let task: Task = {
    id,
    title: input.title,
    lanes: [],
    ticket: input.ticket ?? null,
    focus: false,
    doneAt: null,
    createdAt: new Date().toISOString(),
    archivedAt: null,
  }
  for (const lane of input.lanes) {
    claimLane(id, lane)
    task = withLane(task, lane)
  }
  tasks.set(id, task)
  await commit()
  return task
}

function doneAtFor(task: Task, done: boolean | undefined): string | null {
  if (done === undefined) return task.doneAt
  return done ? new Date().toISOString() : null
}

export async function updateTask(input: TaskUpdateInput): Promise<Task> {
  const task = find(input.id)
  const updated: Task = {
    ...task,
    title: input.title ?? task.title,
    focus: input.focus ?? task.focus,
    ticket: input.ticket === undefined ? task.ticket : input.ticket,
    doneAt: doneAtFor(task, input.done),
  }
  tasks.set(task.id, updated)
  await commit()
  return updated
}

export async function addLane(id: string, lane: TaskLane): Promise<Task> {
  const task = find(id)
  claimLane(id, lane)
  const updated = withLane(task, lane)
  tasks.set(id, updated)
  await commit()
  return updated
}

export async function removeLane(id: string, lane: TaskLane): Promise<Task> {
  const updated = withoutLane(find(id), lane)
  tasks.set(id, updated)
  await commit()
  return updated
}

export async function archiveTask(id: string, archived: boolean): Promise<Task> {
  const updated: Task = {
    ...find(id),
    archivedAt: archived ? new Date().toISOString() : null,
  }
  tasks.set(id, updated)
  await commit()
  return updated
}

export function onTaskChange(handler: TaskChangeHandler): () => void {
  handlers.add(handler)
  return () => {
    handlers.delete(handler)
  }
}
