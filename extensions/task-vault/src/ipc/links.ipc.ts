import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import { ipcMain } from 'electron'
import { readIndex, buildIndex } from '../vault/indexer'
import {
  LinksCreateRequestSchema,
  LinksRemoveRequestSchema,
  LinksGetForTargetRequestSchema,
} from '../schemas/vault.schema'

let vaultPath = ''

export function setVaultPath(p: string) {
  vaultPath = p
}

async function appendLinkToFile(filePath: string, uuid: string): Promise<void> {
  const content = await fs.readFile(filePath, 'utf-8').catch(() => '')
  // Append UUID as terminator link in first open task line or at end
  const lines = content.split('\n')
  const taskIdx = lines.findIndex((l) => /^- \[ \]/.test(l))
  if (taskIdx >= 0) {
    lines[taskIdx] = lines[taskIdx].trimEnd() + ` terminator:${uuid}`
  } else {
    lines.push(`terminator:${uuid}`)
  }
  const { writeFileAtomic } = await import('../vault/writer.js')
  await writeFileAtomic(filePath, lines.join('\n'))
}

async function removeLinkFromFile(filePath: string, uuid: string): Promise<void> {
  const content = await fs.readFile(filePath, 'utf-8').catch(() => '')
  const updated = content.replace(new RegExp(`\\s*terminator:${uuid}`, 'gi'), '')
  const { writeFileAtomic } = await import('../vault/writer.js')
  await writeFileAtomic(filePath, updated)
}

export function registerLinksIpcHandlers(): () => void {
  const channels: string[] = []

  function handle(
    channel: string,
    fn: (event: Electron.IpcMainInvokeEvent, payload: unknown) => Promise<unknown>
  ) {
    ipcMain.handle(channel, fn)
    channels.push(channel)
  }

  handle('task-vault:links:create', async (_event, payload) => {
    const parsed = LinksCreateRequestSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { taskId, projectFilePath, targetId } = parsed.data
    try {
      if (taskId) {
        const [filePath] = taskId.split(':')
        await appendLinkToFile(filePath, targetId)
      } else if (projectFilePath) {
        const fullPath = path.isAbsolute(projectFilePath)
          ? projectFilePath
          : path.join(vaultPath, projectFilePath)
        await appendLinkToFile(fullPath, targetId)
      }
      await buildIndex(vaultPath)
      return { success: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  handle('task-vault:links:remove', async (_event, payload) => {
    const parsed = LinksRemoveRequestSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { taskId, projectFilePath, targetId } = parsed.data
    try {
      if (taskId) {
        const [filePath] = taskId.split(':')
        await removeLinkFromFile(filePath, targetId)
      } else if (projectFilePath) {
        const fullPath = path.isAbsolute(projectFilePath)
          ? projectFilePath
          : path.join(vaultPath, projectFilePath)
        await removeLinkFromFile(fullPath, targetId)
      }
      await buildIndex(vaultPath)
      return { success: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  handle('task-vault:links:get-for-terminator-target', async (_event, payload) => {
    const parsed = LinksGetForTargetRequestSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { targetId } = parsed.data
    const index = await readIndex(vaultPath)
    if (!index) return { tasks: [], projects: [] }
    const tasks = index.tasks.filter((t) => t.terminatorLinks.includes(targetId))
    const projects = index.projects.filter((p) => p.terminatorLinks.includes(targetId))
    return { tasks, projects }
  })

  return () => {
    for (const channel of channels) {
      ipcMain.removeHandler(channel)
    }
  }
}
