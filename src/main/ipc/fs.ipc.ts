import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import { z } from 'zod'
import fs from 'node:fs/promises'
import { fsWatcherService } from '../fs/fs-watcher.js'

const WatchStartSchema = z.object({ projectRoot: z.string().min(1) })
const ReadFileSchema = z.object({ filePath: z.string().min(1) })

export function registerFsHandlers(getMainWindow: () => BrowserWindow | null): void {
  fsWatcherService.addHandler((event) => {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) win.webContents.send('fs:changed', event)
  })

  ipcMain.handle('fs:watch-start', (_event, payload) => {
    const parsed = WatchStartSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    fsWatcherService.watchStart(parsed.data.projectRoot)
    return { ok: true }
  })

  ipcMain.handle('fs:watch-stop', () => {
    fsWatcherService.watchStop()
    return { ok: true }
  })

  ipcMain.handle('fs:read-file', async (_event, payload) => {
    const parsed = ReadFileSchema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    try {
      const content = await fs.readFile(parsed.data.filePath, 'utf-8')
      return { content }
    } catch {
      return { error: 'FILE_NOT_FOUND' }
    }
  })
}
