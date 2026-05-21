import { getDb, randomUUID } from '../../vault/db'
import { extractTags } from '../../vault/tags'
import { getAutoExecuteSetting, makeSuggestion } from '../auto-execute'

interface AddTaskInput {
  filePath: string
  text: string
  section?: string
  dueDate?: string
  tags?: { project?: string; context?: string; area?: string }
  confirmed?: boolean
}

function resolveSource(filePath: string): { source: string; sourceRef: string | null } {
  const normalized = filePath.replace(/\\/g, '/')
  const dailyMatch = /daily\/(\d{4}-\d{2}-\d{2})\.md$/.exec(normalized)
  if (dailyMatch) return { source: 'daily', sourceRef: dailyMatch[1] }
  const projectMatch = /projects\/(.+)\.md$/.exec(normalized)
  if (projectMatch) return { source: 'project', sourceRef: projectMatch[1] }
  const areaMatch = /areas\/(.+)\.md$/.exec(normalized)
  if (areaMatch) return { source: 'area', sourceRef: areaMatch[1] }
  if (normalized.endsWith('someday.md')) return { source: 'someday', sourceRef: null }
  return { source: 'inbox', sourceRef: null }
}

export async function addTaskMcp(
  input: AddTaskInput,
  vaultPath: string
): Promise<
  { taskId: string } | { error: string } | { suggestion: string; tool: string; description: string }
> {
  if (!input.confirmed) {
    const autoExecute = await getAutoExecuteSetting('add_task', vaultPath)
    if (!autoExecute) {
      return makeSuggestion('add_task', `Would add task "${input.text}" to ${input.filePath}`)
    }
  }

  const parts: string[] = [input.text]
  if (input.tags?.project) parts.push(`@${input.tags.project}`)
  if (input.tags?.context) parts.push(`+${input.tags.context}`)
  if (input.tags?.area) parts.push(`#${input.tags.area}`)
  if (input.dueDate) parts.push(`due:${input.dueDate}`)
  const extracted = extractTags(parts.join(' '))

  const { source, sourceRef } = resolveSource(input.filePath)
  const db = getDb()
  const now = new Date().toISOString()
  const id = randomUUID()
  db.prepare(
    `INSERT INTO tasks (id,text,status,project,context,area,due_date,source,source_ref,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id,
    extracted.text,
    'open',
    extracted.project ?? null,
    extracted.context ?? null,
    extracted.area ?? null,
    extracted.dueDate ?? null,
    source,
    sourceRef,
    now,
    now
  )
  return { taskId: id }
}
