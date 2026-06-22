import { ipcMain } from 'electron'
import { healthCheck } from '../db/index.js'

export function registerDbIpcHandlers(): void {
  ipcMain.handle('db:health', async () => {
    try {
      return await healthCheck()
    } catch (err) {
      return { ok: false, message: String(err) }
    }
  })
}
