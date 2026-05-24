import { ipcMain, Notification, app } from 'electron'

export function registerNotificationHandlers(): void {
  ipcMain.on('notification:show', (_event, payload: { title: string; body: string }) => {
    if (Notification.isSupported()) {
      new Notification({ title: payload.title, body: payload.body }).show()
    }
    // Bounce the dock icon as a secondary attention signal on macOS
    if (process.platform === 'darwin' && app.dock) {
      app.dock.bounce('informational')
    }
  })
}
