import { EventEmitter } from 'node:events'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const electron = vi.hoisted(() => ({
  app: { isPackaged: true, getVersion: () => '0.1.163', dock: { bounce: () => {} } },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: {
    shown: [] as Array<{ message: string; detail?: string; type?: string; buttons?: string[] }>,
    response: 0,
    showMessageBox(options: { message: string }) {
      this.shown.push(options)
      return Promise.resolve({ response: this.response })
    },
  },
  Notification: Object.assign(
    function () {
      return { show: () => {}, on: () => {} }
    },
    { isSupported: () => false }
  ),
}))
vi.mock('electron', () => electron)

/** Stands in for electron-updater's MacUpdater: an emitter plus the two calls the module makes. */
class FakeUpdater extends EventEmitter {
  logger: unknown = null
  checks = 0
  installs = 0
  nextCheck: () => Promise<unknown> = () => Promise.resolve({ isUpdateAvailable: false })
  checkForUpdates(): Promise<unknown> {
    this.checks += 1
    return this.nextCheck()
  }
  quitAndInstall(): void {
    this.installs += 1
  }
}
const updater = vi.hoisted(() => ({ current: null as unknown }))
vi.mock('electron-updater', () => ({
  default: {
    get autoUpdater() {
      return updater.current
    },
  },
}))
const recordUse = vi.hoisted(() => vi.fn())
vi.mock('../../../src/main/usage/usage-store', () => ({ getUsageStore: () => ({ recordUse }) }))
vi.mock('electron-store', async () =>
  (await import('../../support/stores')).inMemoryElectronStore()
)
vi.mock('../../../src/main/logger', () => ({
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}))

type Module = typeof import('../../../src/main/app-updater')
type Manager = typeof import('../../../src/main/notifications/notification-manager')

let startAppUpdates: Module['startAppUpdates']
let checkForUpdatesNow: Module['checkForUpdatesNow']
let notificationManager: Manager['notificationManager']
let fake: FakeUpdater
let revealed: number

const reveal = (): void => {
  revealed += 1
}

beforeEach(async () => {
  recordUse.mockClear()
  vi.resetModules()
  vi.useFakeTimers()
  electron.app.isPackaged = true
  electron.dialog.shown = []
  electron.dialog.response = 0
  fake = new FakeUpdater()
  updater.current = fake
  revealed = 0
  ;({ notificationManager } = await import('../../../src/main/notifications/notification-manager'))
  ;({ startAppUpdates, checkForUpdatesNow } = await import('../../../src/main/app-updater'))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

const notificationsWithTitle = (title: string) =>
  notificationManager.list().filter((notification) => notification.title === title)

describe('startAppUpdates', () => {
  it('does nothing in an unpackaged app, so dev and e2e runs never reach GitHub', async () => {
    electron.app.isPackaged = false
    startAppUpdates(reveal)
    await vi.advanceTimersByTimeAsync(5 * 60 * 60 * 1000)
    expect(fake.checks).toBe(0)
  })

  it('checks at launch and again every four hours', async () => {
    startAppUpdates(reveal)
    expect(fake.checks).toBe(1)
    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000 - 1)
    expect(fake.checks).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fake.checks).toBe(2)
  })

  it('keeps a failed background check out of the notifications', async () => {
    fake.nextCheck = () => Promise.reject(new Error('net::ERR_INTERNET_DISCONNECTED'))
    startAppUpdates(reveal)
    fake.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED'))
    await vi.advanceTimersByTimeAsync(0)
    expect(notificationManager.list()).toEqual([])
  })
})

describe('feature usage', () => {
  it('counts an update once per version, though every later check downloads it again', () => {
    startAppUpdates(reveal)
    fake.emit('update-downloaded', { version: '0.1.170' })
    fake.emit('update-downloaded', { version: '0.1.170' })
    expect(recordUse.mock.calls).toEqual([[{ feature: 'core.app.update', via: 'app' }]])
  })
})

describe('the Update ready notification', () => {
  it('announces a downloaded update by version, with a Restart now button', () => {
    startAppUpdates(reveal)
    fake.emit('update-downloaded', { version: '0.1.170' })
    const [ready] = notificationsWithTitle('Update ready')
    expect(ready.message).toContain('0.1.170')
    expect(ready.message).toContain('closes your open terminals')
    expect(ready.actions).toEqual([{ id: 'restart', label: 'Restart now' }])
  })

  it('restarts into the update only from the Restart now button', () => {
    startAppUpdates(reveal)
    fake.emit('update-downloaded', { version: '0.1.170' })
    const [ready] = notificationsWithTitle('Update ready')
    notificationManager.triggerAction(ready.id, '__open__')
    expect(fake.installs).toBe(0)
    expect(revealed).toBe(1)
    notificationManager.triggerAction(ready.id, 'restart')
    expect(fake.installs).toBe(1)
  })

  it('announces a version once, though every later check downloads it again', () => {
    startAppUpdates(reveal)
    fake.emit('update-downloaded', { version: '0.1.170' })
    fake.emit('update-downloaded', { version: '0.1.170' })
    expect(notificationsWithTitle('Update ready')).toHaveLength(1)
    fake.emit('update-downloaded', { version: '0.1.171' })
    expect(notificationsWithTitle('Update ready')).toHaveLength(2)
  })
})

// A menu click asks a question, so the answer is a dialog: notification settings can silence every kind.
describe('checkForUpdatesNow', () => {
  it('answers in a dialog when no update exists, even with every notification turned off', async () => {
    startAppUpdates(reveal)
    await checkForUpdatesNow()
    expect(electron.dialog.shown).toEqual([
      expect.objectContaining({
        message: 'No update available',
        detail: 'Terminator 0.1.163 is the latest version.',
      }),
    ])
    expect(notificationManager.list()).toEqual([])
  })

  it('reports a failed check in plain words', async () => {
    fake.nextCheck = () => Promise.reject(new Error('HttpError: 504 Gateway Time-out'))
    startAppUpdates(reveal)
    await checkForUpdatesNow()
    expect(electron.dialog.shown).toEqual([
      expect.objectContaining({
        type: 'error',
        message: 'Could not check for updates',
        detail: 'Check your connection and try again.',
      }),
    ])
  })
})

describe('checkForUpdatesNow in an unpackaged app', () => {
  it('does nothing', async () => {
    electron.app.isPackaged = false
    await checkForUpdatesNow()
    expect(fake.checks).toBe(0)
    expect(electron.dialog.shown).toEqual([])
  })
})

// The download ends only after the check returns, as a real download over the network does.
const found = (version: string) => () =>
  Promise.resolve({
    isUpdateAvailable: true,
    updateInfo: { version },
    downloadPromise: {
      then(resolve: () => void) {
        fake.emit('update-downloaded', { version })
        resolve()
      },
    },
  })

describe('checkForUpdatesNow with an update found', () => {
  it('offers a restart once the download ends, and restarts only from Restart now', async () => {
    fake.nextCheck = found('0.1.170')
    startAppUpdates(reveal)
    electron.dialog.response = 1
    await checkForUpdatesNow()
    expect(electron.dialog.shown).toEqual([
      expect.objectContaining({
        message: 'Terminator 0.1.170 is ready',
        buttons: ['Restart now', 'Later'],
      }),
    ])
    expect(fake.installs).toBe(0)
    electron.dialog.response = 0
    await checkForUpdatesNow()
    expect(fake.installs).toBe(1)
  })

  it('answers again for a version a background check already announced', async () => {
    fake.nextCheck = found('0.1.170')
    startAppUpdates(reveal)
    fake.emit('update-downloaded', { version: '0.1.170' })
    electron.dialog.response = 1
    await checkForUpdatesNow()
    expect(electron.dialog.shown).toHaveLength(1)
  })
})

describe('checkForUpdatesNow when the update download ends or fails', () => {
  it('does not also post the Update ready notification for the version it answered', async () => {
    fake.nextCheck = found('0.1.170')
    startAppUpdates(reveal)
    electron.dialog.response = 1
    await checkForUpdatesNow()
    expect(notificationsWithTitle('Update ready')).toEqual([])
  })

  it('reports a download that fails after the check found an update', async () => {
    fake.nextCheck = () =>
      Promise.resolve({
        isUpdateAvailable: true,
        updateInfo: { version: '0.1.170' },
        downloadPromise: Promise.reject(new Error('sha512 checksum mismatch')),
      })
    startAppUpdates(reveal)
    await checkForUpdatesNow()
    expect(electron.dialog.shown).toEqual([
      expect.objectContaining({ message: 'Could not check for updates' }),
    ])
  })
})

describe('a test run of the packaged app', () => {
  it('never checks, so smoke and e2e runs of a packaged build stay off the network', async () => {
    vi.stubEnv('TERMINATOR_RUN_IN_BACKGROUND', '1')
    vi.resetModules()
    const updates = await import('../../../src/main/app-updater')
    updates.startAppUpdates(reveal)
    await updates.checkForUpdatesNow()
    await vi.advanceTimersByTimeAsync(5 * 60 * 60 * 1000)
    expect(fake.checks).toBe(0)
  })
})
