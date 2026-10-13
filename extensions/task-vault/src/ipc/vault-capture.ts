import type { z } from 'zod'
import type { ExtensionDB } from '@terminator/extension-sdk'
import { route, type IpcContext } from './register'
import { insertTask } from '../vault/task-repository'
import { randomUUID } from '../vault/db'
import { extractTags } from '../vault/tags'
import {
  AddSubtaskRequestSchema,
  AddTaskRequestSchema,
  CaptureRequestSchema,
  EditTaskRequestSchema,
} from '../schemas/vault.schema'
import {
  indexUpdated,
  nowIso,
  resolveProjectAndAreaIds,
  resolveSource,
  taskExists,
} from './vault-shared'

interface Placement {
  source: string
  sourceRef?: string | null
  todaySince?: string | null
}

/** Inserts an open task from tagged text, resolving its project and area; returns its id. */
async function insertTaggedTask(db: ExtensionDB, fullText: string, place: Placement) {
  const extracted = extractTags(fullText)
  const now = nowIso()
  const id = randomUUID()
  const { projectId, areaId } = await resolveProjectAndAreaIds(db, extracted, now)
  await insertTask(db, {
    id,
    text: extracted.text,
    status: 'open',
    projectId,
    context: extracted.context ?? null,
    areaId,
    dueDate: extracted.dueDate ?? null,
    ...place,
    createdAt: now,
    updatedAt: now,
  })
  indexUpdated()
  return { taskId: id }
}

async function capture({ db }: IpcContext, args: z.infer<typeof CaptureRequestSchema>) {
  const { text, hintArea, hintProject } = args
  const tags: string[] = []
  if (hintProject) tags.push(`@${hintProject}`)
  if (hintArea) tags.push(`#${hintArea}`)
  const fullText = tags.length ? `${text} ${tags.join(' ')}` : text
  return insertTaggedTask(db, fullText, { source: 'inbox' })
}

function taggedText(args: z.infer<typeof AddTaskRequestSchema>): string {
  const { text, dueDate, tags } = args
  const parts: string[] = [text]
  if (tags?.project) parts.push(`@${tags.project}`)
  if (tags?.context) parts.push(`+${tags.context}`)
  if (tags?.area) parts.push(`#${tags.area}`)
  if (dueDate) parts.push(`due:${dueDate}`)
  return parts.join(' ')
}

async function addTask({ db }: IpcContext, args: z.infer<typeof AddTaskRequestSchema>) {
  const { source, sourceRef } = resolveSource(args.filePath)
  const todaySince = source === 'daily' ? (sourceRef ?? null) : null
  return insertTaggedTask(db, taggedText(args), { source, sourceRef, todaySince })
}

async function editTask({ db }: IpcContext, args: z.infer<typeof EditTaskRequestSchema>) {
  const { taskId, text } = args
  const extracted = extractTags(text)
  const now = nowIso()
  const { projectId, areaId } = await resolveProjectAndAreaIds(db, extracted, now)
  if (!(await taskExists(db, taskId))) return { error: 'STALE_ID' }
  await db.run(
    `UPDATE tasks SET text=?,project_id=?,context=?,area_id=?,due_date=?,updated_at=? WHERE id=?`,
    [
      extracted.text,
      projectId,
      extracted.context ?? null,
      areaId,
      extracted.dueDate ?? null,
      now,
      taskId,
    ]
  )
  indexUpdated()
  return { success: true }
}

async function addSubtask({ db }: IpcContext, args: z.infer<typeof AddSubtaskRequestSchema>) {
  const { taskId, text } = args
  const parent = await db.get<{ source: string; source_ref: string | null }>(
    `SELECT source, source_ref FROM tasks WHERE id=?`,
    [taskId]
  )
  if (!parent) return { error: 'STALE_ID' }
  const now = nowIso()
  await insertTask(db, {
    id: randomUUID(),
    text: text.trim(),
    status: 'open',
    source: parent.source,
    sourceRef: parent.source_ref,
    parentId: taskId,
    createdAt: now,
    updatedAt: now,
  })
  indexUpdated()
  return { success: true }
}

/** Channels that put new task text into the vault or rewrite it. */
export const CAPTURE_ROUTES = [
  route('task-vault:vault:capture', CaptureRequestSchema, capture),
  route('task-vault:vault:add-task', AddTaskRequestSchema, addTask),
  route('task-vault:vault:edit-task', EditTaskRequestSchema, editTask),
  route('task-vault:vault:add-subtask', AddSubtaskRequestSchema, addSubtask),
]
