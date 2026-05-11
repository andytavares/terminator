import { ipcMain } from 'electron'
import { writeFromRenderer, type LogLevel } from '../logger.js'

export function registerLogHandlers(): void {
  ipcMain.on(
    'log:write',
    (_event, payload: { level: LogLevel; namespace: string; message: string }) => {
      const { level, namespace, message } = payload ?? {}
      if (!level || !namespace || typeof message !== 'string') return
      writeFromRenderer(level, namespace, message)
    }
  )
}
