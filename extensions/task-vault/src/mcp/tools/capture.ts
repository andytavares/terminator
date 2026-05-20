import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import { addTask } from '../../vault/writer'
import { buildIndex } from '../../vault/indexer'
import { parseFile, validateCaptureText } from '../../vault/parser'
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
  if (!validateCaptureText(input.text)) {
    return { error: 'text must not be empty or whitespace-only' }
  }

  if (!input.confirmed) {
    const autoExecute = await getAutoExecuteSetting('capture', vaultPath)
    if (!autoExecute) {
      return makeSuggestion('capture', `Would capture: "${input.text}" to inbox.md`)
    }
  }

  const tags: string[] = []
  if (input.hintProject) tags.push(`+${input.hintProject}`)
  if (input.hintArea) tags.push(`#${input.hintArea}`)
  const fullText = tags.length ? `${input.text} ${tags.join(' ')}` : input.text

  const inboxFile = path.join(vaultPath, 'inbox.md')
  await addTask(inboxFile, fullText)
  await buildIndex(vaultPath)

  const content = await fs.readFile(inboxFile, 'utf-8').catch(() => '')
  const { tasks } = parseFile(content, inboxFile)
  const last = tasks[tasks.length - 1]
  return { taskId: last?.id ?? '' }
}
