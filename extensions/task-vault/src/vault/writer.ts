import * as fs from 'node:fs/promises'
import * as path from 'node:path'
export async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath)
  await fs.mkdir(dir, { recursive: true })
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

export async function editTask(
  filePath: string,
  line: number,
  newText: string
): Promise<void | { error: string }> {
  const lines = await readLines(filePath)
  const idx = line - 1
  if (idx < 0 || idx >= lines.length) return { error: 'STALE_ID' }
  const current = lines[idx]
  const markerMatch = /^(- \[[^\]]\]) /.exec(current)
  if (!markerMatch) return { error: 'STALE_ID' }
  lines[idx] = `${markerMatch[1]} ${newText}`
  await writeFileAtomic(filePath, lines.join('\n'))
}

export async function deleteTask(
  filePath: string,
  line: number
): Promise<void | { error: string }> {
  const lines = await readLines(filePath)
  const idx = line - 1
  if (idx < 0 || idx >= lines.length) return { error: 'STALE_ID' }
  if (!/^- \[/.test(lines[idx])) return { error: 'STALE_ID' }
  let deleteCount = 1
  while (idx + deleteCount < lines.length && /^ {2,}- /.test(lines[idx + deleteCount])) {
    deleteCount++
  }
  lines.splice(idx, deleteCount)
  await writeFileAtomic(filePath, lines.join('\n'))
}

export async function restoreTask(
  filePath: string,
  line: number
): Promise<void | { error: string }> {
  const lines = await readLines(filePath)
  const idx = line - 1
  if (idx < 0 || idx >= lines.length) return { error: 'STALE_ID' }
  const current = lines[idx]
  if (!/^- \[[^\]]\]/.test(current)) return { error: 'STALE_ID' }
  // Replace any non-open marker with open, strip completion metadata
  lines[idx] = current
    .replace(/^(- \[[^\]]\])/, '- [ ]')
    .replace(/ completed:\S+/, '')
    .replace(/ →\S+/, '')
    .trim()
  await writeFileAtomic(filePath, lines.join('\n'))
}

export async function cancelTask(
  filePath: string,
  line: number
): Promise<void | { error: string }> {
  const lines = await readLines(filePath)
  const idx = line - 1
  if (idx < 0 || idx >= lines.length) return { error: 'STALE_ID' }
  const current = lines[idx]
  if (!/^- \[ \]/.test(current)) return { error: 'STALE_ID' }
  lines[idx] = current.replace('- [ ]', '- [-]')
  await writeFileAtomic(filePath, lines.join('\n'))
}

export async function readTaskLines(
  filePath: string,
  line: number
): Promise<string[] | { error: string }> {
  let content = ''
  try {
    content = await fs.readFile(filePath, 'utf-8')
  } catch {
    return { error: 'NOT_FOUND' }
  }
  const lines = content.split('\n')
  const idx = line - 1
  if (idx < 0 || idx >= lines.length) return { error: 'STALE_ID' }
  const result = [lines[idx]]
  let j = idx + 1
  while (j < lines.length && /^ {2,}- /.test(lines[j])) {
    result.push(lines[j])
    j++
  }
  return result
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
