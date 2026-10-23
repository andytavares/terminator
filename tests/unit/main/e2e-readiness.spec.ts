import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// A fresh module per test: the announcements it holds are never another test's.
let readiness: typeof import('../../../src/main/e2e-readiness')

async function freshReadiness(): Promise<void> {
  vi.stubEnv('TERMINATOR_E2E', '1')
  vi.resetModules()
  readiness = await import('../../../src/main/e2e-readiness')
}

class FakeWindow extends EventEmitter {
  id = 7
  debuggerCommands: Array<[string, unknown]> = []
  webContents = {
    debugger: {
      isAttached: () => false,
      attach: vi.fn(),
      sendCommand: vi.fn(async (method: string, params: unknown) => {
        this.debuggerCommands.push([method, params])
      }),
    },
  }
}

async function settles(promise: Promise<void>): Promise<boolean> {
  const marker = Symbol('pending')
  const outcome = await Promise.race([promise, Promise.resolve(marker)])
  return outcome !== marker
}

describe('the e2e readiness announcer', () => {
  beforeEach(freshReadiness)

  it('answers a wait that began before the announcement', async () => {
    const waiting = readiness.whenAnnounced('drawn', '7')
    expect(await settles(waiting)).toBe(false)
    readiness.announce('drawn', '7')
    await expect(waiting).resolves.toBeUndefined()
  })

  it('answers a wait that began after the announcement', async () => {
    readiness.announce('ready', 'task-vault:board')
    await expect(readiness.whenAnnounced('ready', 'task-vault:board')).resolves.toBeUndefined()
  })

  it('keeps announcements of other kinds and subjects apart', async () => {
    readiness.announce('drawn', '7')
    expect(await settles(readiness.whenAnnounced('focused', '7'))).toBe(false)
    expect(await settles(readiness.whenAnnounced('drawn', '8'))).toBe(false)
  })
})

describe('the e2e readiness of a window', () => {
  beforeEach(freshReadiness)

  it('announces a window drawn at its first frame and focused once emulation is on', async () => {
    const window = new FakeWindow()
    readiness.announceWindowReadiness(window as never)
    expect(await settles(readiness.whenAnnounced('drawn', '7'))).toBe(false)
    window.emit('ready-to-show')
    await readiness.whenAnnounced('drawn', '7')
    await readiness.whenAnnounced('focused', '7')
    expect(window.debuggerCommands).toEqual([
      ['Emulation.setFocusEmulationEnabled', { enabled: true }],
    ])
  })

  it('is inert, and a wait fails fast, when the variable is unset', async () => {
    vi.stubEnv('TERMINATOR_E2E', undefined)
    const window = new FakeWindow()
    readiness.announceWindowReadiness(window as never)
    window.emit('ready-to-show')
    expect(window.webContents.debugger.attach).not.toHaveBeenCalled()
    await expect(readiness.whenAnnounced('drawn', '7')).rejects.toThrow('TERMINATOR_E2E')
  })
})

describe('the e2e readiness of a window whose focus emulation fails', () => {
  beforeEach(freshReadiness)

  it('fails the wait for focus, with the reason, when focus emulation cannot start', async () => {
    const window = new FakeWindow()
    window.webContents.debugger.attach.mockImplementation(() => {
      throw new Error('Another debugger is already attached')
    })
    readiness.announceWindowReadiness(window as never)
    await expect(readiness.whenAnnounced('focused', '7')).rejects.toThrow('Another debugger')
  })
})
