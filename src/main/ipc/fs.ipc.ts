import type { BrowserWindow } from 'electron'
import { z } from 'zod'
import fs from 'node:fs/promises'
import { registerInvokeTable, invokeSpec, noPayload } from './invoke-table.js'
import { fsWatcherService } from '../fs/fs-watcher.js'

export function registerFsHandlers(getMainWindow: () => BrowserWindow | null): void {
  fsWatcherService.addHandler((event) => {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) win.webContents.send('fs:changed', event)
  })

  registerInvokeTable([
    invokeSpec({
      channel: 'fs:watch-start',
      schema: z.object({ projectRoot: z.string().min(1) }),
      invalid: { error: 'VALIDATION_ERROR' },
      run: ({ projectRoot }) => {
        fsWatcherService.watchStart(projectRoot)
        return { ok: true }
      },
    }),
    invokeSpec({
      channel: 'fs:watch-stop',
      schema: noPayload,
      invalid: { error: 'VALIDATION_ERROR' },
      run: () => {
        fsWatcherService.watchStop()
        return { ok: true }
      },
    }),
    invokeSpec({
      channel: 'fs:read-file',
      schema: z.object({ filePath: z.string().min(1) }),
      invalid: { error: 'VALIDATION_ERROR' },
      run: async ({ filePath }) => ({ content: await fs.readFile(filePath, 'utf-8') }),
      onError: () => ({ error: 'FILE_NOT_FOUND' }),
    }),
  ])
}
