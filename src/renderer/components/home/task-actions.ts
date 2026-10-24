import { useTaskStore } from '../../stores/task.store'
import { SESSION_ACTIONS } from '../session/session-actions'
import { leadSessionOf } from './thread-actions'
import { sessionsOfLane } from './lane-details'
import type { WorkThread } from '../../home/work-threads'
import type { TaskCreateInput } from '../../../shared/schemas/tasks.schema'

const TICKET_KEY = /^(linear|jira):(.+)$/

/** The ticket a ticket-keyed thread is joined under, so storing it as a task keeps its ticket. */
function ticketOf(thread: WorkThread): TaskCreateInput['ticket'] {
  const [, tracker, key] = TICKET_KEY.exec(thread.key) ?? []
  return tracker ? { tracker: tracker as 'linear' | 'jira', key } : null
}

/** The stored task holding this thread's first lane; a write returns no id, so it is looked up. */
function storedTaskOf(thread: WorkThread): string | null {
  const [first] = thread.lanes
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
  const created = await useTaskStore
    .getState()
    .create({ title: thread.title, lanes, ticket: ticketOf(thread) })
  return created ? storedTaskOf(thread) : null
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
