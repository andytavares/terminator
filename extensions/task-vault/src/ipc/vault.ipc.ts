import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import { ipcMain } from 'electron'
import matter from 'gray-matter'
import { parseFile } from '../vault/parser'
import { completeTask, migrateTask, addTask, writeFileAtomic } from '../vault/writer'
import { buildIndex, readIndex } from '../vault/indexer'
import {
  CaptureRequestSchema,
  GetDailyRequestSchema,
  AddTaskRequestSchema,
  CompleteTaskRequestSchema,
  MigrateTaskRequestSchema,
  QueryRequestSchema,
  ProcessInboxRequestSchema,
  UpdateProjectStatusRequestSchema,
} from '../schemas/vault.schema'
import type { DailyLog } from '../vault/types'

let vaultPath = ''

export function setVaultPath(p: string) {
  vaultPath = p
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

async function getDailyLog(date: string): Promise<DailyLog> {
  const filePath = path.join(vaultPath, 'daily', `${date}.md`)
  let content = ''
  let exists = true
  try {
    content = await fs.readFile(filePath, 'utf-8')
  } catch {
    exists = false
  }
  const { tasks, events, notes } = parseFile(content, filePath)
  return { date, filePath, tasks, events, notes, exists }
}

export function registerVaultIpcHandlers(): () => void {
  const handlers: Array<[string, (...args: unknown[]) => unknown]> = []

  function handle(
    channel: string,
    fn: (event: Electron.IpcMainInvokeEvent, payload: unknown) => Promise<unknown>
  ) {
    ipcMain.handle(channel, fn)
    handlers.push([channel, fn as (...args: unknown[]) => unknown])
  }

  handle('task-vault:vault:capture', async (_event, payload) => {
    const parsed = CaptureRequestSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR: ' + parsed.error.message }
    const { text, hintArea, hintProject } = parsed.data
    const tags: string[] = []
    if (hintProject) tags.push(`+${hintProject}`)
    if (hintArea) tags.push(`#${hintArea}`)
    const fullText = tags.length ? `${text} ${tags.join(' ')}` : text
    const inboxFile = path.join(vaultPath, 'inbox.md')
    await addTask(inboxFile, fullText)
    const _index = await buildIndex(vaultPath)
    const inboxContent = await fs.readFile(inboxFile, 'utf-8').catch(() => '')
    const { tasks } = parseFile(inboxContent, inboxFile)
    const last = tasks[tasks.length - 1]
    return { taskId: last?.id ?? '' }
  })

  handle('task-vault:vault:get-today', async () => {
    if (!vaultPath) return { error: 'Vault path not configured' }
    try {
      return await getDailyLog(today())
    } catch (err) {
      return { error: String(err) }
    }
  })

  handle('task-vault:vault:get-daily', async (_event, payload) => {
    const parsed = GetDailyRequestSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    try {
      return await getDailyLog(parsed.data.date)
    } catch (err) {
      return { error: String(err) }
    }
  })

  handle('task-vault:vault:add-task', async (_event, payload) => {
    const parsed = AddTaskRequestSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { filePath, text, section, dueDate, tags } = parsed.data
    const parts: string[] = [text]
    if (tags?.project) parts.push(`+${tags.project}`)
    if (tags?.context) parts.push(`@${tags.context}`)
    if (tags?.area) parts.push(`#${tags.area}`)
    if (dueDate) parts.push(`due:${dueDate}`)
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(vaultPath, filePath)
    await addTask(fullPath, parts.join(' '), section)
    const _index = await buildIndex(vaultPath)
    const content = await fs.readFile(fullPath, 'utf-8').catch(() => '')
    const { tasks } = parseFile(content, fullPath)
    const last = tasks[tasks.length - 1]
    return { taskId: last?.id ?? '' }
  })

  handle('task-vault:vault:complete-task', async (_event, payload) => {
    const parsed = CompleteTaskRequestSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { taskId } = parsed.data
    const [filePath, lineStr] = taskId.split(':')
    const line = parseInt(lineStr, 10)
    if (!filePath || isNaN(line)) return { error: 'STALE_ID' }
    const result = await completeTask(filePath, line, today())
    if (result && 'error' in result) return result
    await buildIndex(vaultPath)
    return { success: true }
  })

  handle('task-vault:vault:migrate-task', async (_event, payload) => {
    const parsed = MigrateTaskRequestSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { taskId, targetDate } = parsed.data
    const [filePath, lineStr] = taskId.split(':')
    const line = parseInt(lineStr, 10)
    if (!filePath || isNaN(line)) return { error: 'STALE_ID' }
    const result = await migrateTask(filePath, line, targetDate, vaultPath)
    if (result && 'error' in result) return result
    const _index = await buildIndex(vaultPath)
    const targetFile = path.join(vaultPath, 'daily', `${targetDate}.md`)
    const content = await fs.readFile(targetFile, 'utf-8').catch(() => '')
    const { tasks } = parseFile(content, targetFile)
    const last = tasks[tasks.length - 1]
    return { newTaskId: last?.id ?? '' }
  })

  handle('task-vault:vault:query', async (_event, payload) => {
    const parsed = QueryRequestSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { status, context, project, area, dueBefore, filePattern } = parsed.data
    const index = await readIndex(vaultPath)
    if (!index) return { tasks: [] }
    let tasks = index.tasks
    if (status) {
      const statuses = Array.isArray(status) ? status : [status]
      tasks = tasks.filter((t) => statuses.includes(t.status))
    }
    if (context) tasks = tasks.filter((t) => t.context === context)
    if (project) tasks = tasks.filter((t) => t.project === project)
    if (area) tasks = tasks.filter((t) => t.area === area)
    if (dueBefore) tasks = tasks.filter((t) => t.dueDate && t.dueDate < dueBefore)
    if (filePattern) tasks = tasks.filter((t) => t.filePath.includes(filePattern))
    return { tasks }
  })

  handle('task-vault:vault:process-inbox-item', async (_event, payload) => {
    const parsed = ProcessInboxRequestSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { taskId, action, destination, newProjectName } = parsed.data
    const [filePath, lineStr] = taskId.split(':')
    const line = parseInt(lineStr, 10)
    if (!filePath || isNaN(line)) return { error: 'STALE_ID' }

    const content = await fs.readFile(filePath, 'utf-8').catch(() => '')
    const lines = content.split('\n')
    const idx = line - 1
    if (idx < 0 || idx >= lines.length || !/^- \[ \]/.test(lines[idx])) {
      return { error: 'STALE_ID' }
    }
    const taskText = lines[idx].replace(/^- \[ \] /, '')

    if (action === 'trash') {
      lines.splice(idx, 1)
      await writeFileAtomic(filePath, lines.join('\n'))
      await buildIndex(vaultPath)
      return { success: true }
    }

    if (action === 'do-now') {
      lines[idx] = lines[idx].replace('- [ ]', '- [/]')
      await writeFileAtomic(filePath, lines.join('\n'))
      await buildIndex(vaultPath)
      return { success: true }
    }

    // file or someday — remove from inbox and add to destination
    lines.splice(idx, 1)
    await writeFileAtomic(filePath, lines.join('\n'))

    let destFile = ''
    if (action === 'someday') {
      destFile = path.join(vaultPath, 'someday.md')
    } else if (newProjectName) {
      destFile = path.join(vaultPath, 'projects', `${newProjectName}.md`)
      await fs.mkdir(path.dirname(destFile), { recursive: true })
    } else if (destination) {
      destFile = path.isAbsolute(destination) ? destination : path.join(vaultPath, destination)
    } else {
      return { error: 'destination required for action: file' }
    }

    await addTask(destFile, taskText)
    const _index = await buildIndex(vaultPath)
    const destContent = await fs.readFile(destFile, 'utf-8').catch(() => '')
    const { tasks } = parseFile(destContent, destFile)
    const last = tasks[tasks.length - 1]
    return { success: true, newTaskId: last?.id }
  })

  handle('task-vault:vault:update-project-status', async (_event, payload) => {
    const parsed = UpdateProjectStatusRequestSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { projectFilePath, status } = parsed.data
    const fullPath = path.isAbsolute(projectFilePath)
      ? projectFilePath
      : path.join(vaultPath, projectFilePath)
    const content = await fs.readFile(fullPath, 'utf-8').catch(() => '')
    const parsed2 = matter(content)
    parsed2.data.status = status
    const updated = matter.stringify(parsed2.content, parsed2.data)
    await writeFileAtomic(fullPath, updated)
    await buildIndex(vaultPath)
    return { success: true }
  })

  return () => {
    for (const [channel] of handlers) {
      ipcMain.removeHandler(channel)
    }
  }
}
