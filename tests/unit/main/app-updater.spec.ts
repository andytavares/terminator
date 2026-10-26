import { EventEmitter } from 'node:events'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const electron = vi.hoisted(() => ({
  app: { isPackaged: true, getVersion: () => '0.1.163', dock: { bounce: () => {} } },
  BrowserWindow: { getAllWindows: () => [] },
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
  vi.resetModules()
  vi.useFakeTimers()
  electron.app.isPackaged = true
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

describe('checkForUpdatesNow', () => {
  it('says the running version is the latest when no update exists', async () => {
    startAppUpdates(reveal)
    await checkForUpdatesNow()
    const [latest] = notificationsWithTitle('No update available')
    expect(latest.message).toBe('Terminator 0.1.163 is the latest version.')
  })

  it('says nothing extra when an update exists, since the download announces itself', async () => {
    fake.nextCheck = () => Promise.resolve({ isUpdateAvailable: true })
    startAppUpdates(reveal)
    await checkForUpdatesNow()
    expect(notificationManager.list()).toEqual([])
  })

  it('reports a failed check in plain words', async () => {
    fake.nextCheck = () => Promise.reject(new Error('HttpError: 504 Gateway Time-out'))
    startAppUpdates(reveal)
    await checkForUpdatesNow()
    const [failed] = notificationsWithTitle('Could not check for updates')
    expect(failed.type).toBe('error')
    expect(failed.message).toBe('Check your connection and try again.')
  })

  it('does nothing in an unpackaged app', async () => {
    electron.app.isPackaged = false
    await checkForUpdatesNow()
    expect(fake.checks).toBe(0)
    expect(notificationManager.list()).toEqual([])
  })
})

describe('checkForUpdatesNow with an update found', () => {
  it('reports a download that fails after the check found an update', async () => {
    fake.nextCheck = () =>
      Promise.resolve({
        isUpdateAvailable: true,
        downloadPromise: Promise.reject(new Error('sha512 checksum mismatch')),
      })
    startAppUpdates(reveal)
    await checkForUpdatesNow()
    expect(notificationsWithTitle('Could not check for updates')).toHaveLength(1)
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
