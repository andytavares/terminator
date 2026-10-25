import { useTaskStore } from '../../stores/task.store'
import { SESSION_ACTIONS } from '../session/session-actions'
import { leadSessionOf } from './thread-actions'
import { sessionsOfLane } from './lane-details'
import { startWork } from './start-work'
import type { WorkThread } from '../../home/work-threads'
import type { Task, TaskCreateInput, TaskLane } from '../../../shared/schemas/tasks.schema'
import { TASK_TITLE_MAX_LENGTH } from '../../../shared/task-title'
import type { Workspace } from '../../../shared/types/index'

const TICKET_KEY = /^(linear|jira):(.+)$/

/** The ticket a ticket-keyed thread is joined under, so storing it as a task keeps its ticket. */
function ticketOf(thread: WorkThread): TaskCreateInput['ticket'] {
  const [, tracker, key] = TICKET_KEY.exec(thread.key) ?? []
  return tracker ? { tracker: tracker as 'linear' | 'jira', key } : null
}

/** The stored task holding the first of these lanes; a write returns no id, so it is looked up. */
function storedTaskOf(lanes: readonly TaskLane[]): string | null {
  const [first] = lanes
  const found = useTaskStore
    .getState()
    .tasks.find((t) =>
      t.lanes.some((lane) => lane.repoRoot === first?.repoRoot && lane.branch === first?.branch)
    )
  return found?.id ?? null
}

/** The id of the thread's stored task, storing a branch or ticket thread first; null when it has no branch. */
async function ensureTask(thread: WorkThread): Promise<string | null> {
  if (thread.taskId !== null) return thread.taskId
  if (thread.lanes.length === 0) return null
  const lanes = thread.lanes.map(({ repoRoot, branch }) => ({ repoRoot, branch }))
  const created = await useTaskStore.getState().create({
    title: thread.title.slice(0, TASK_TITLE_MAX_LENGTH),
    lanes,
    ticket: ticketOf(thread),
  })
  return created ? storedTaskOf(thread.lanes) : null
}

/** Whether a star can be pressed: only work on a branch can be stored as a task. */
export function canStoreTask(thread: WorkThread): boolean {
  return thread.taskId !== null || thread.lanes.length > 0
}

export async function toggleFocus(thread: WorkThread): Promise<void> {
  const id = await ensureTask(thread)
  if (id !== null) await useTaskStore.getState().update({ id, focus: !thread.focus })
}

export async function toggleDone(thread: WorkThread): Promise<void> {
  const id = await ensureTask(thread)
  if (id !== null) await useTaskStore.getState().update({ id, done: thread.doneAt === null })
}

/** Whether `dragged` can be dropped on `target`: two different rows, each on a branch. */
export function canMergeThreads(dragged: WorkThread, target: WorkThread): boolean {
  return dragged.key !== target.key && dragged.lanes.length > 0 && canStoreTask(target)
}

/** What a merge changed, so Undo can put it back: both tasks as they were, or the added lanes. */
export type MergeUndo =
  | { kind: 'task'; task: Task; into: Task }
  | { kind: 'lanes'; into: string; lanes: TaskLane[] }

async function removeLanes(into: string, lanes: readonly TaskLane[]): Promise<void> {
  for (const lane of lanes) await useTaskStore.getState().removeLane(into, lane)
}

/** Adds each lane to `into`; when one is refused, the ones already added are taken out again. */
async function addLanes(into: string, lanes: readonly TaskLane[]): Promise<boolean> {
  const added: TaskLane[] = []
  for (const lane of lanes) {
    if (!(await useTaskStore.getState().addLane(into, lane))) {
      await removeLanes(into, added)
      return false
    }
    added.push(lane)
  }
  return true
}

/** Drops one Home row onto another: the target becomes (or stays) a stored task and takes
 *  every lane of the dragged row; a dragged stored task is merged in and gone afterwards. */
export async function mergeThreads(
  dragged: WorkThread,
  target: WorkThread
): Promise<MergeUndo | null> {
  if (!canMergeThreads(dragged, target)) return null
  const into = await ensureTask(target)
  if (into === null) return null
  const store = useTaskStore.getState()
  const draggedTask = store.tasks.find((t) => t.id === dragged.taskId)
  const intoTask = store.tasks.find((t) => t.id === into)
  if (draggedTask) {
    if (intoTask === undefined || !(await store.merge(draggedTask.id, into))) return null
    return { kind: 'task', task: draggedTask, into: intoTask }
  }
  const lanes = dragged.lanes.map(({ repoRoot, branch }) => ({ repoRoot, branch }))
  return (await addLanes(into, lanes)) ? { kind: 'lanes', into, lanes } : null
}

/** Puts a merge back: the dragged task again with its lanes, star and done mark, and the task it
 *  was dropped on with its own star and ticket; or the added branches out again. */
export async function undoMerge(undo: MergeUndo): Promise<void> {
  const store = useTaskStore.getState()
  if (undo.kind === 'lanes') return removeLanes(undo.into, undo.lanes)
  const { title, lanes, ticket, focus, doneAt } = undo.task
  if (!(await store.create({ title, lanes, ticket }))) return
  const restored = storedTaskOf(lanes)
  if (restored !== null && (focus || doneAt !== null))
    await store.update({ id: restored, focus, done: doneAt !== null })
  await store.update({ id: undo.into.id, focus: undo.into.focus, ticket: undo.into.ticket })
}

/** Renames a stored task; other work is named by its lead session's description. */
export function renameThread(thread: WorkThread, title: string): void {
  if (thread.taskId !== null) {
    void useTaskStore.getState().update({ id: thread.taskId, title })
    return
  }
  const lead = leadSessionOf(thread)
  if (lead) SESSION_ACTIONS.onSaveDescription(lead, title)
}

/** Opens the terminal of each lane that has one. */
export function openAllLanes(thread: WorkThread): void {
  for (const lane of thread.lanes) {
    const lead = leadSessionOf({ ...thread, sessions: sessionsOfLane(thread, lane) })
    if (lead) SESSION_ACTIONS.onOpen(lead.sessionId)
  }
}

/** Makes a worktree on the task's branch in another repo, opens a terminal there and adds the lane.
 *  Null when it worked; otherwise what to tell the person. */
export async function addRepoToTask(
  taskId: string,
  branch: string,
  workspace: Workspace
): Promise<string | null> {
  const message = await startWork({ kind: 'branch', branch, workspace, runAs: 'terminal' })
  if (message !== null) return message
  const added = await useTaskStore
    .getState()
    .addLane(taskId, { repoRoot: workspace.folderPath, branch })
  return added ? null : `${workspace.name} started, but the task could not be changed.`
}
