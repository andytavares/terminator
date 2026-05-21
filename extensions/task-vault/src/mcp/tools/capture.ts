import { getDb, randomUUID } from '../../vault/db'
import { extractTags } from '../../vault/tags'
import { getAutoExecuteSetting, makeSuggestion } from '../auto-execute'

interface CaptureInput {
  text: string
  hintArea?: string
  hintProject?: string
  confirmed?: boolean
}

export async function captureTask(
  input: CaptureInput,
  vaultPath: string
): Promise<
  { taskId: string } | { error: string } | { suggestion: string; tool: string; description: string }
> {
  if (!input.text || input.text.trim().length === 0) {
    return { error: 'text must not be empty or whitespace-only' }
  }

  if (!input.confirmed) {
    const autoExecute = await getAutoExecuteSetting('capture', vaultPath)
    if (!autoExecute) {
      return makeSuggestion('capture', `Would capture: "${input.text}" to inbox`)
    }
  }

  const tags: string[] = []
  if (input.hintProject) tags.push(`@${input.hintProject}`)
  if (input.hintArea) tags.push(`#${input.hintArea}`)
  const fullText = tags.length ? `${input.text} ${tags.join(' ')}` : input.text
  const extracted = extractTags(fullText)

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
    'inbox',
    null,
    now,
    now
  )
  return { taskId: id }
}
