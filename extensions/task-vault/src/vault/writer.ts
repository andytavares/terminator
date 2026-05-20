import * as fs from 'node:fs/promises'
import * as path from 'node:path'
export async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath)
  const tmp = path.join(dir, `.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  await fs.writeFile(tmp, content, 'utf-8')
  await fs.rename(tmp, filePath)
}

async function readLines(filePath: string): Promise<string[]> {
  const content = await fs.readFile(filePath, 'utf-8')
  return content.split('\n')
}

export async function completeTask(
  filePath: string,
  line: number,
  date: string
): Promise<void | { error: 'STALE_ID' }> {
  const lines = await readLines(filePath)
  const idx = line - 1
  if (idx < 0 || idx >= lines.length) return { error: 'STALE_ID' }
  const current = lines[idx]
  if (!/^- \[ \]/.test(current)) return { error: 'STALE_ID' }
  lines[idx] = current.replace('- [ ]', `- [x]`) + ` completed:${date}`
  await writeFileAtomic(filePath, lines.join('\n'))
}

export async function migrateTask(
  filePath: string,
  line: number,
  targetDate: string,
  vaultPath: string
): Promise<void | { error: 'STALE_ID' }> {
  const lines = await readLines(filePath)
  const idx = line - 1
  if (idx < 0 || idx >= lines.length) return { error: 'STALE_ID' }
  const current = lines[idx]
  if (!/^- \[ \]/.test(current)) return { error: 'STALE_ID' }

  const taskText = current.replace(/^- \[ \] /, '')

  // Mark source as migrated
  lines[idx] = current.replace('- [ ]', `- [>]`) + ` →${targetDate}`
  await writeFileAtomic(filePath, lines.join('\n'))

  // Append to target day file
  const targetFile = path.join(vaultPath, 'daily', `${targetDate}.md`)
  await fs.mkdir(path.dirname(targetFile), { recursive: true })
  let targetContent = ''
  try {
    targetContent = await fs.readFile(targetFile, 'utf-8')
  } catch {
    // new file
  }
  const separator = targetContent && !targetContent.endsWith('\n') ? '\n' : ''
  await writeFileAtomic(targetFile, targetContent + separator + `- [ ] ${taskText}`)
}

export async function addTask(filePath: string, text: string, section?: string): Promise<void> {
  let content = ''
  try {
    content = await fs.readFile(filePath, 'utf-8')
  } catch {
    // new file
  }

  const newLine = `- [ ] ${text}`

  if (!section) {
    const separator = content && !content.endsWith('\n') ? '\n' : ''
    await writeFileAtomic(filePath, content + separator + newLine)
    return
  }

  const lines = content.split('\n')
  const headingIdx = lines.findIndex((l) => l.trim() === `## ${section}`)

  if (headingIdx === -1) {
    // Section not found — append it
    const separator = content && !content.endsWith('\n') ? '\n' : ''
    await writeFileAtomic(filePath, content + separator + `## ${section}\n${newLine}`)
    return
  }

  // Insert after heading (and after any existing tasks in that section)
  let insertAt = headingIdx + 1
  while (insertAt < lines.length && lines[insertAt].startsWith('- ')) {
    insertAt++
  }
  lines.splice(insertAt, 0, newLine)
  await writeFileAtomic(filePath, lines.join('\n'))
}
