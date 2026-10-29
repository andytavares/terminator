import { app, dialog } from 'electron'
// Default import: electron-updater defines autoUpdater with a getter that ESM named imports miss.
import electronUpdater from 'electron-updater'
import { runsInBackground } from './background-mode'
import { logger } from './logger'
import { notificationManager } from './notifications/notification-manager'
import { getUsageStore } from './usage/usage-store'

/** Releases come about once a day and the app stays open for days. */
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

/** Dev runs are unpackaged; smoke and e2e runs of a packaged build run in the background. */
const checksForUpdates = (): boolean => app.isPackaged && !runsInBackground()

/** Each later check finds the cached download and emits `update-downloaded` again. */
let announcedVersion: string | null = null

/** Checks GitHub Releases at launch and every four hours; an update installs on quit (ADR 128).
 * A click on the notification runs `revealApp`, never a restart, which closes every terminal. */
export function startAppUpdates(revealApp: () => void): void {
  if (!checksForUpdates()) return
  const { autoUpdater } = electronUpdater
  autoUpdater.logger = logger
  autoUpdater.on('error', (error) => logger.warn('update check failed', { error: String(error) }))
  autoUpdater.on('update-downloaded', ({ version }) => announceUpdate(version, revealApp))
  const checkInBackground = (): void => {
    // The 'error' listener above logs it; a background check never interrupts anyone.
    autoUpdater
      .checkForUpdates()
      .then((result) => result?.downloadPromise)
      .catch(() => {})
  }
  checkInBackground()
  setInterval(checkInBackground, CHECK_INTERVAL_MS).unref()
}

function announceUpdate(version: string, revealApp: () => void): void {
  if (version === announcedVersion) return
  announcedVersion = version
  void getUsageStore().recordUse({ feature: 'core.app.update', via: 'app' })
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

/** The "Check for Updates…" menu item. It answers in a dialog: notification settings can silence
 * every notification kind, and a click that shows nothing reads as a broken menu item. */
export async function checkForUpdatesNow(): Promise<void> {
  if (!checksForUpdates()) return
  try {
    const result = await electronUpdater.autoUpdater.checkForUpdates()
    if (!result?.isUpdateAvailable) {
      await dialog.showMessageBox({
        message: 'No update available',
        detail: `Terminator ${app.getVersion()} is the latest version.`,
      })
      return
    }
    // This dialog is the announcement; the Update ready notification would repeat it.
    announcedVersion = result.updateInfo.version
    // A download that fails after the check found an update rejects here.
    await result.downloadPromise
    void getUsageStore().recordUse({ feature: 'core.app.update', via: 'app' })
    await offerRestart(result.updateInfo.version)
  } catch {
    await dialog.showMessageBox({
      type: 'error',
      message: 'Could not check for updates',
      detail: 'Check your connection and try again.',
    })
  }
}

async function offerRestart(version: string): Promise<void> {
  const { response } = await dialog.showMessageBox({
    message: `Terminator ${version} is ready`,
    detail:
      'It installs the next time you quit. Restarting now closes your open terminals and agents.',
    buttons: ['Restart now', 'Later'],
    defaultId: 0,
    cancelId: 1,
  })
  if (response === 0) electronUpdater.autoUpdater.quitAndInstall()
}
