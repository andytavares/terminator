import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { z } from 'zod'
import { homedir } from 'os'
import type { PtyManager } from '../terminal/pty-manager.js'
import type { BrowserWindow } from 'electron'
import { getGlobalSettings } from '../storage/settings-store.js'

const CreateTerminalSchema = z.object({
  projectId: z.string().uuid(),
  type: z.enum(['human', 'agent']),
  tabTitle: z.string().min(1).max(100),
  scrollbackLimit: z.number().int().min(1000).max(100000).optional(),
  cwd: z.string().min(1),
  shell: z.string().optional(),
})

const TerminalInputSchema = z.object({
  sessionId: z.string(),
  data: z.string(),
})

const TerminalResizeSchema = z.object({
  sessionId: z.string(),
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
})

export function registerTerminalHandlers(
  ptyManager: PtyManager,
  getWindow: () => BrowserWindow | null
): void {
  ipcMain.handle('terminal:create', (_event, payload) => {
    const parsed = CreateTerminalSchema.safeParse(payload)
    if (!parsed.success) {
      return { error: 'VALIDATION_ERROR', message: parsed.error.message }
    }

    const { type, cwd, shell } = parsed.data
    const globalSettings = getGlobalSettings()
    const defaultShell = shell ?? globalSettings.terminal.defaultShell
    const sessionId = randomUUID()
    const resolvedCwd = cwd === '~' ? homedir() : cwd

    ptyManager.spawn(
      sessionId,
      resolvedCwd,
      defaultShell,
      type,
      (data) => {
        const win = getWindow()
        if (win && !win.isDestroyed()) win.webContents.send('terminal:output', { sessionId, data })
      },
      (exitCode) => {
        const win = getWindow()
        if (win && !win.isDestroyed())
          win.webContents.send('terminal:process-exit', { sessionId, exitCode })
      }
    )

    return { sessionId }
  })

  ipcMain.handle('terminal:close', (_event, { sessionId }) => {
    ptyManager.kill(sessionId)
    return { success: true }
  })

  ipcMain.on('terminal:input', (_event, payload) => {
    const parsed = TerminalInputSchema.safeParse(payload)
    if (parsed.success) {
      ptyManager.write(parsed.data.sessionId, parsed.data.data)
    }
  })

  ipcMain.on('terminal:resize', (_event, payload) => {
    const parsed = TerminalResizeSchema.safeParse(payload)
    if (parsed.success) {
      ptyManager.resize(parsed.data.sessionId, parsed.data.cols, parsed.data.rows)
    }
  })

  ipcMain.handle('terminal:close-all', async () => {
    const count = ptyManager.getSessionIds().length
    await ptyManager.killAll()
    return { terminatedCount: count }
  })

  ipcMain.handle('terminal:cleanup-orphans', () => {
    return ptyManager.cleanupOrphans()
  })
}
