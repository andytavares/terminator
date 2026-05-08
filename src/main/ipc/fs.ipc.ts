import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import { z } from 'zod'
import { fsWatcherService } from '../fs/fs-watcher.js'

const WatchStartSchema = z.object({ projectRoot: z.string().min(1) })

export function registerFsHandlers(getMainWindow: () => BrowserWindow | null): void {
  fsWatcherService.addHandler((event) => {
    getMainWindow()?.webContents.send('fs:changed', event)
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
}
