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

class TaskError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'SAME_TASK',
    message: string
  ) {
    super(message)
  }
}

const tasks = new Map<string, Task>()
const handlers = new Set<TaskChangeHandler>()
/** Writes wait for the startup read, so one made before it lands is not wiped by it. */
let loaded: Promise<void> = Promise.resolve()

const filePath = (): string => path.join(app.getPath('userData'), FILE_NAME)

export function listTasks(): Task[] {
  return [...tasks.values()]
}

function announce(): void {
  const snapshot = listTasks()
  for (const handler of handlers) handler(snapshot)
}

/** Saves the tasks; when the write fails, memory goes back to `before` so disk and memory agree. */
async function commit(before: ReadonlyMap<string, Task>): Promise<void> {
  try {
    await writeJsonAtomic(filePath(), listTasks())
  } catch (error) {
    tasks.clear()
    for (const [id, task] of before) tasks.set(id, task)
    throw error
  }
  announce()
}

async function find(id: string): Promise<Task> {
  await loaded
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

async function readTasks(): Promise<void> {
  for (const entry of await readStoredEntries()) {
    const parsed = TaskSchema.safeParse(entry)
    if (parsed.success) tasks.set(parsed.data.id, parsed.data)
  }
  // A window may have listed before the read finished; it learns what was stored.
  announce()
}

/** Read what was stored, dropping entries that are not tasks. Called once at startup. */
export function loadTasks(): Promise<void> {
  tasks.clear()
  loaded = readTasks()
  return loaded
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
  await loaded
  const before = new Map(tasks)
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
  await commit(before)
  return task
}

function doneAtFor(task: Task, done: boolean | undefined): string | null {
  if (done === undefined) return task.doneAt
  return done ? new Date().toISOString() : null
}

export async function updateTask(input: TaskUpdateInput): Promise<Task> {
  const task = await find(input.id)
  const updated: Task = {
    ...task,
    title: input.title ?? task.title,
    focus: input.focus ?? task.focus,
    ticket: input.ticket === undefined ? task.ticket : input.ticket,
    doneAt: doneAtFor(task, input.done),
  }
  const before = new Map(tasks)
  tasks.set(task.id, updated)
  await commit(before)
  return updated
}

export async function addLane(id: string, lane: TaskLane): Promise<Task> {
  const task = await find(id)
  const before = new Map(tasks)
  claimLane(id, lane)
  const updated = withLane(task, lane)
  tasks.set(id, updated)
  await commit(before)
  return updated
}

export async function removeLane(id: string, lane: TaskLane): Promise<Task> {
  const updated = withoutLane(await find(id), lane)
  const before = new Map(tasks)
  tasks.set(id, updated)
  await commit(before)
  return updated
}

export async function archiveTask(id: string, archived: boolean): Promise<Task> {
  const updated: Task = {
    ...(await find(id)),
    archivedAt: archived ? new Date().toISOString() : null,
  }
  const before = new Map(tasks)
  tasks.set(id, updated)
  await commit(before)
  return updated
}

/** Moves every lane of `fromId` into `intoId` and drops `fromId`. The receiver keeps its title
 * and its ticket if it has one; it is focused if either was. */
export async function mergeTasks(fromId: string, intoId: string): Promise<Task> {
  if (fromId === intoId) throw new TaskError('SAME_TASK', `Task ${fromId} cannot merge into itself`)
  const from = await find(fromId)
  const into = await find(intoId)
  const merged: Task = {
    ...from.lanes.reduce(withLane, into),
    focus: into.focus || from.focus,
    ticket: into.ticket ?? from.ticket,
  }
  const before = new Map(tasks)
  tasks.delete(fromId)
  tasks.set(intoId, merged)
  await commit(before)
  return merged
}

export function onTaskChange(handler: TaskChangeHandler): () => void {
  handlers.add(handler)
  return () => {
    handlers.delete(handler)
  }
}
