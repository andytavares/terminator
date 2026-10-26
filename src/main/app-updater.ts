import { app } from 'electron'
// Default import: electron-updater defines autoUpdater with a getter that ESM named imports miss.
import electronUpdater from 'electron-updater'
import { logger } from './logger'
import { notificationManager } from './notifications/notification-manager'

/** Releases come about once a day and the app stays open for days. */
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

/** Checks GitHub Releases at launch and every four hours; an update installs on quit (ADR 128).
 * A click on the notification runs `revealApp`, never a restart, which closes every terminal. */
export function startAppUpdates(revealApp: () => void): void {
  if (!app.isPackaged) return
  const { autoUpdater } = electronUpdater
  autoUpdater.logger = logger
  autoUpdater.on('error', (error) => logger.warn('update check failed', { error: String(error) }))
  autoUpdater.on('update-downloaded', ({ version }) => announceUpdate(version, revealApp))
  const checkInBackground = (): void => {
    // The 'error' listener above logs it; a background check never interrupts anyone.
    autoUpdater.checkForUpdates().catch(() => {})
  }
  checkInBackground()
  setInterval(checkInBackground, CHECK_INTERVAL_MS).unref()
}

function announceUpdate(version: string, revealApp: () => void): void {
  notificationManager.create({
    key: 'updateReady',
    type: 'info',
    title: 'Update ready',
    message: `Terminator ${version} installs the next time you quit. Restarting now closes your open terminals and agents.`,
    onClick: revealApp,
    actions: [
      {
        id: 'restart',
        label: 'Restart now',
        handler: () => electronUpdater.autoUpdater.quitAndInstall(),
      },
    ],
  })
}

/** The "Check for Updates…" menu item. An update found announces itself when its download ends. */
export async function checkForUpdatesNow(): Promise<void> {
  if (!app.isPackaged) return
  try {
    const result = await electronUpdater.autoUpdater.checkForUpdates()
    if (result?.isUpdateAvailable) return
    notificationManager.create({
      key: 'updateNotFound',
      type: 'info',
      title: 'No update available',
      message: `Terminator ${app.getVersion()} is the latest version.`,
    })
  } catch {
    notificationManager.create({
      key: 'updateCheckFailed',
      type: 'error',
      title: 'Could not check for updates',
      message: 'Check your connection and try again.',
    })
  }
}
