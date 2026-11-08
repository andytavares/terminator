import { app, dialog, type BrowserWindow } from 'electron'
import { defineChannel } from '@terminator/extension-sdk'
import { registerInvokeTable, noPayload } from './invoke-table.js'

export function registerAppInfoHandlers(): void {
  registerInvokeTable([
    defineChannel({
      channel: 'app:get-info',
      schema: noPayload,
      invalid: { error: 'VALIDATION_ERROR' },
      run: () => ({
        appName: app.getName(),
        version: app.getVersion(),
        electronVersion: process.versions.electron,
        nodeVersion: process.versions.node,
        chromeVersion: process.versions.chrome,
        platform: process.platform,
        // Lets the renderer show `~/repos/app` instead of an absolute path that
        // wraps a sidebar row onto two lines.
        homeDir: app.getPath('home'),
      }),
    }),
  ])
}

export function registerDialogHandlers(getMainWindow: () => BrowserWindow | null): void {
  registerInvokeTable([
    defineChannel({
      channel: 'dialog:open-directory',
      schema: noPayload,
      invalid: { error: 'VALIDATION_ERROR' },
      run: async () => {
        const mainWindow = getMainWindow()
        if (!mainWindow) return { cancelled: true }
        const result = await dialog.showOpenDialog(mainWindow, {
          properties: ['openDirectory'],
        })
        if (result.canceled || result.filePaths.length === 0) {
          return { cancelled: true }
        }
        return { filePath: result.filePaths[0] }
      },
    }),
  ])
}
