import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import bcryptjs from 'bcryptjs'
import { randomBytes } from 'crypto'

export interface RemoteStatusPayload {
  enabled?: boolean
  port?: number
  publicUrl?: string | null
  lanUrl?: string | null
  ngrokInstalled?: boolean
  ngrokError?: string | null
  error?: string
  message?: string
}

export function sendStatus(win: BrowserWindow | null, payload: RemoteStatusPayload): void {
  win?.webContents.send('remote:status', payload)
}

export function sendLog(
  win: BrowserWindow | null,
  level: 'info' | 'warn' | 'error',
  message: string
): void {
  win?.webContents.send('log:push', { level, message })
}

export async function ensurePasswordHash(
  password: string,
  updateFn: (patch: unknown) => void
): Promise<string> {
  const actual = password || randomBytes(16).toString('base64url')
  const hash = await bcryptjs.hash(actual, 10)
  updateFn({ remoteControl: { password: actual, passwordHash: hash } })
  return actual
}

export interface RemoteHandlerDeps {
  updateGlobalSettings: (patch: unknown) => void
  disconnectAllClients: () => void
}

export function registerRemoteHandlers(
  getWindow: () => BrowserWindow | null,
  onReconnect: () => void,
  deps?: RemoteHandlerDeps
): void {
  ipcMain.on('remote:tunnel-reconnect', () => {
    onReconnect()
  })

  ipcMain.handle('remote:update-password', async (_event, { password }: { password: string }) => {
    try {
      const actual = await ensurePasswordHash(password, deps?.updateGlobalSettings ?? (() => {}))
      deps?.disconnectAllClients()
      sendStatus(getWindow(), { enabled: true })
      return { password: actual }
    } catch (err) {
      return { error: String(err) }
    }
  })
}
