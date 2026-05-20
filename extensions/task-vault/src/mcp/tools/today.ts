import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import { parseFile } from '../../vault/parser'
import type { DailyLog } from '../../vault/types'

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export async function getTodayLog(vaultPath: string): Promise<DailyLog | { error: string }> {
  const date = today()
  const filePath = path.join(vaultPath, 'daily', `${date}.md`)
  let content = ''
  let exists = true
  try {
    content = await fs.readFile(filePath, 'utf-8')
  } catch {
    exists = false
    // Auto-create
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, `# ${date}\n\n`, 'utf-8')
  }
  const { tasks, events, notes } = parseFile(content, filePath)
  return { date, filePath, tasks, events, notes, exists }
}
